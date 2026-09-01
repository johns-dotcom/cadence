// Upload rules — the machinery that makes a statement rule SAFE TO ACCEPT.
//
// The organizing question for every bank line is: **will it ever have an
// invoice behind it?** The two answers are opposites:
//
//   it will   → a category rule is a TRAP: rule-booked rows carry no document,
//               so the rule quietly converts matchable payments into rematch
//               work. These rows want MATCHING, and no rule is written.
//   it won't  → a category rule is the right answer — but ONLY paired with the
//               no-invoice marker, or it books future rows straight into the
//               needs-invoice queue it looks like it clears.
//
// Ported from the reference app, where this was measured failing at scale
// before it existed: 102 of 120 suggestions were category rules, 6 of the top
// 25 were vendors with invoices already waiting unclaimed, 6 of 10 rules in
// force were unpaired and feeding 137 rows / $26,528 into the queue, and 6 of
// 14 offers could not fire at all ("FACEBOOK" against a descriptor reading
// "PURCHASE 0123 FACEBK *VJ9GAARV92 650-5434800 CA").
//
// Everything here is label-scoped. Cadence's booked predicate is
// `booked OR match_method IN ('created','rule')`; rule-booked rows carry
// match_method='rule', so human decisions (the thing worth learning from) are
// booked rows where match_method IS DISTINCT FROM 'rule'.

const { usdOf } = require('./usd');

const norm = (v) => String(v || '').trim().toLowerCase();

// ── Invoice census ───────────────────────────────────────────────────────────
// How many REAL invoices each ledger payee has ever sent (excluding entries the
// statement pipeline itself invented), and how many of those no bank row has
// claimed yet. The second number makes a "match" suggestion actionable rather
// than a scolding.
async function loadInvoiceCensus(pool, labelId) {
  const [realRows, freeRows] = await Promise.all([
    pool.query(`
      SELECT LOWER(TRIM(payee)) AS p, COUNT(*)::int AS n FROM expenses
       WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
         AND COALESCE(entry_source, '') <> 'bank_statement'
         AND COALESCE(TRIM(invoice_number), '') <> ''
       GROUP BY 1`, [labelId]).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT LOWER(TRIM(e.payee)) AS p, COUNT(*)::int AS n FROM expenses e
       WHERE e.label_id = $1 AND (e.deleted = false OR e.deleted IS NULL)
         AND COALESCE(e.entry_source, '') <> 'bank_statement'
         AND COALESCE(TRIM(e.invoice_number), '') <> ''
         AND e.id NOT IN (SELECT bt.matched_expense_id FROM bank_transactions bt
                           WHERE bt.label_id = $1 AND bt.matched_expense_id IS NOT NULL AND bt.dismissed = false)
       GROUP BY 1`, [labelId]).catch(() => ({ rows: [] })),
  ]);
  return {
    real: new Map(realRows.rows.map((r) => [r.p, r.n])),
    waiting: new Map(freeRows.rows.map((r) => [r.p, r.n])),
  };
}

// Ledger payees that have EVER sent an invoice — the evidence test behind
// whole-category no-invoice candidates.
async function loadEverInvoiced(pool, labelId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(payee)) AS p FROM expenses
      WHERE label_id = $1 AND COALESCE(TRIM(invoice_number), '') <> ''
        AND (deleted = false OR deleted IS NULL)`, [labelId]).catch(() => ({ rows: [] }));
  return new Set(rows.map((r) => r.p));
}

// Rows answered one at a time via the row-level no_invoice flag.
async function loadNoInvoiceRowIds(pool, labelId) {
  const { rows } = await pool.query(
    `SELECT id FROM bank_transactions WHERE label_id = $1 AND no_invoice = TRUE`, [labelId])
    .catch(() => ({ rows: [] }));
  return new Set(rows.map((r) => r.id));
}

// ── Book-pattern derivation ──────────────────────────────────────────────────
// A pattern that will ACTUALLY FIRE, derived from the rows themselves. The
// ingest rule matcher tests `description + payee_guess` by substring, but the
// suggestion tally keys on the resolved LEDGER payee — a name the bank never
// prints. Two candidates, both checked against the population before either is
// offered: (A) the most common payee_guess, (B) the longest distinctive shared
// token. Returns null when neither provably covers enough — a rule that cannot
// be shown to fire is the bug this exists to stop.
const BOOK_PATTERN_MIN_COVERAGE = 0.75;
// The load-bearing guard: a candidate whose extra reach would RELABEL rows
// already booked to a different category is rejected. Mere overlap with the
// same category is disclosed, not rejected.
const BOOK_PATTERN_MAX_CONFLICT_SHARE = 0.25;
// Words the bank prints on everything. A first filter, not the guard.
const DESCRIPTOR_NOISE_BASE = [
  'PURCHASE', 'CHECKCARD', 'CKCD', 'PAYMENT', 'PAYMENTS', 'RECURRING', 'DEBIT', 'CREDIT',
  'CARD', 'ONLINE', 'TRANSFER', 'TRANSFERS', 'WITHDRAWAL', 'DEPOSIT', 'CONFIRMATION',
  'CONF', 'BANK', 'AMERICA', 'ZELLE', 'WIRE', 'DOMESTIC', 'INTERNATIONAL', 'SERVICE',
  'SERVICES', 'FROM', 'WITH', 'THE', 'AND', 'FOR', 'INC', 'LLC', 'LTD', 'LLP', 'CORP',
  'COMPANY', 'PENDING', 'AUTHORIZED', 'MERCHANT', 'REFERENCE', 'ACCOUNT', 'CHECKING',
];

// The label's OWN name appears on every internal Zelle/transfer descriptor, so
// it covers any vendor's rows perfectly and is the worst possible pattern.
// Multi-tenant: derived per label rather than hardcoded.
function descriptorNoiseFor(labelName) {
  const noise = new Set(DESCRIPTOR_NOISE_BASE);
  for (const t of String(labelName || '').toUpperCase().split(/[^A-Z0-9./&'-]+/)) {
    if (t.length >= 3) noise.add(t);
  }
  return noise;
}

// ownRows: the rows this pattern has to cover. corpus: every debit as
// { key, payee, category, hay } so the reach test runs over the population the
// rule actually runs on. category: what the rule would apply.
function bookPatternFor(ownRows, corpus, payeeKey, category, noise) {
  const hay = ownRows.map((r) => `${r.payee_guess || ''} ${r.description || ''}`.toUpperCase());
  if (!hay.length) return null;
  const covers = (p) => {
    const u = p.toUpperCase();
    return hay.filter((h) => h.includes(u)).length;
  };
  const cat = norm(category);
  const reachOf = (p) => {
    const u = p.toUpperCase();
    const hit = (corpus || []).filter((c) => c.key !== payeeKey && c.hay.includes(u));
    // Already booked to a DIFFERENT category — the rows a rule would relabel.
    const conflicting = hit.filter((c) => c.category && c.category !== cat);
    const open = hit.filter((c) => !c.category);
    return {
      conflicting: conflicting.length,
      open: open.length,
      total: hit.length,
      payees: [...new Set(conflicting.map((c) => c.payee))].slice(0, 8),
    };
  };

  // A — most common payee_guess (a literal substring of the descriptor when it
  // doesn't carry varying digits).
  const guesses = new Map();
  for (const r of ownRows) {
    const g = String(r.payee_guess || '').trim();
    if (g.length >= 4) guesses.set(g, (guesses.get(g) || 0) + 1);
  }
  const byFreq = [...guesses.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const a = byFreq.length ? { pattern: byFreq[0][0], hits: covers(byFreq[0][0]) } : null;

  // B — longest distinctive shared token. ONE token: multi-token patterns only
  // help when the tokens are contiguous in every descriptor, and guessing
  // wrong about that is how a pattern silently stops matching.
  const freq = new Map();
  for (const h of hay) {
    // '.' '/' '&' kept inside tokens so APPLE.COM/BILL survives as one thing.
    for (const t of new Set(h.split(/[^A-Z0-9./&'-]+/).filter(Boolean))) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  const usable = (t) => t.length >= 4
    && !noise.has(t)
    && !/^[\d.\-/]+$/.test(t)
    // 2+ digits in a 4+ char token is a reference number, not a name.
    && (t.match(/\d/g) || []).length < 2;
  const bTok = [...freq.entries()]
    .filter(([t]) => usable(t))
    .sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)[0];
  const b = bTok ? { pattern: bTok[0], hits: bTok[1] } : null;

  // Both candidates judged on coverage AND reach; the first that passes both
  // wins. Checking reach only on the winner would silently discard a safe
  // candidate whenever the unsafe one merely covered more rows.
  const ranked = [a, b].filter(Boolean).sort((x, y) => y.hits - x.hits
    || y.pattern.length - x.pattern.length);
  for (const c of ranked) {
    if (c.hits / hay.length < BOOK_PATTERN_MIN_COVERAGE) continue;
    const f = reachOf(c.pattern);
    if (f.conflicting > c.hits * BOOK_PATTERN_MAX_CONFLICT_SHARE) continue;
    return {
      pattern: c.pattern,
      hits: c.hits,
      rows: hay.length,
      conflict_rows: f.conflicting,
      open_rows: f.open,
      reach_rows: f.total,
      conflict_payees: f.payees,
    };
  }
  return null;
}

// ── The suggestion engine ────────────────────────────────────────────────────
// Mines repeated decisions (MIN_TIMES+, with a 60% majority guard for split
// vendors like UBER = Travel 101× AND Meals 32×) and classifies each payee by
// the invoice census into match / category(+pairing) / no-invoice / dismiss /
// artist. Suggests only — a rule books money on every future statement, so the
// call stays human; the disclosures are what make a one-click accept safe.
async function buildRuleSuggestions(pool, labelId, minTimes) {
  const MIN_TIMES = Math.max(parseInt(minTimes, 10) || 3, 2);

  const { rows } = await pool.query(`
    SELECT bt.id, bt.payee_guess, bt.description, bt.amount,
           COALESCE(bt.currency,'USD') AS currency, bt.dismissed, bt.dismissed_reason,
           bt.match_method, bt.matched_expense_id, bt.booked, bt.no_invoice,
           e.payee, e.category, e.artist
      FROM bank_transactions bt
      LEFT JOIN expenses e ON e.id = bt.matched_expense_id
     WHERE bt.label_id = $1 AND bt.direction = 'debit'
       AND (e.id IS NULL OR e.deleted = false OR e.deleted IS NULL)`, [labelId]);

  const [cat, dis, art, labelRow] = await Promise.all([
    pool.query(`SELECT pattern FROM statement_category_rules WHERE label_id = $1`, [labelId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT pattern FROM statement_dismiss_rules WHERE label_id = $1`, [labelId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT pattern FROM statement_artist_rules WHERE label_id = $1`, [labelId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT name FROM labels WHERE id = $1`, [labelId]).catch(() => ({ rows: [] })),
  ]);
  const covered = {
    category: new Set(cat.rows.map((r) => norm(r.pattern))),
    dismiss: new Set(dis.rows.map((r) => norm(r.pattern))),
    artist: new Set(art.rows.map((r) => norm(r.pattern))),
  };
  const noise = descriptorNoiseFor(labelRow.rows[0]?.name);

  const { real: realInv, waiting: freeInv } = await loadInvoiceCensus(pool, labelId);

  // Already answered — by a vendor/category no-invoice rule or row by row.
  const { rows: niRules } = await pool.query(
    `SELECT scope, pattern FROM statement_no_invoice_rules WHERE label_id = $1`, [labelId]).catch(() => ({ rows: [] }));
  const niVendor = new Set(niRules.filter((r) => r.scope === 'vendor').map((r) => norm(r.pattern)));
  const niCategory = new Set(niRules.filter((r) => r.scope === 'category').map((r) => norm(r.pattern)));

  const isBooked = (r) => r.booked || r.match_method === 'created' || r.match_method === 'rule';
  // A human decision — rule-booked rows are rule OUTPUT, not decisions.
  const isHumanBooked = (r) => isBooked(r) && r.match_method !== 'rule';

  // Every distinct payee, for the blast-radius check on dismiss suggestions.
  const vendors = [...new Set(rows.map((r) => (r.payee || r.payee_guess || '').trim()).filter(Boolean))];
  // Every debit as a searchable descriptor — the population a candidate
  // book-pattern is measured against before it is offered.
  const corpus = rows.map((r) => {
    const payee = (r.payee || r.payee_guess || '').trim();
    return {
      key: norm(payee), payee, category: norm(r.category),
      hay: `${r.payee_guess || ''} ${r.description || ''}`.toUpperCase(),
    };
  });

  // Tally each kind of decision per payee.
  const tally = new Map();
  const bump = (payee, kind, value, usd) => {
    if (!payee || !value) return;
    if (!tally.has(payee)) {
      tally.set(payee, { category: new Map(), dismiss: new Map(), artist: new Map(), catRows: [] });
    }
    const m = tally.get(payee)[kind];
    const cur = m.get(value) || { n: 0, usd: 0 };
    cur.n += 1; cur.usd += usd;
    m.set(value, cur);
  };
  for (const r of rows) {
    const payee = (r.payee || r.payee_guess || '').trim();
    const usd = Math.abs(usdOf(r.amount, r.currency, null));
    // 'internal' and 'auto' dismissals are machine output, not decisions.
    if (r.dismissed) {
      if (r.dismissed_reason !== 'internal' && r.dismissed_reason !== 'auto') {
        bump(payee, 'dismiss', String(r.dismissed_reason || '').slice(0, 80) || 'dismissed', usd);
      }
    } else if (isHumanBooked(r) && r.category) {
      bump(payee, 'category', r.category, usd);
      const t = tally.get(payee);
      if (t) t.catRows.push({ payee_guess: r.payee_guess, description: r.description });
    }
    if (!r.dismissed && r.matched_expense_id && r.artist && String(r.artist).trim()) {
      bump(payee, 'artist', String(r.artist).trim(), usd);
    }
  }

  // What a pairing ACTUALLY clears — counted with /completion's own predicate.
  // A vendor no-invoice rule matches the LEDGER payee OR the bank descriptor
  // (both, by equality), so it also clears rows filed under a different ledger
  // name that share the descriptor.
  const queueNow = rows.filter((r) => isBooked(r) && !r.dismissed && !r.no_invoice
    && !niVendor.has(norm(r.payee)) && !niVendor.has(norm(r.payee_guess))
    && !niCategory.has(norm(r.category)));
  const clearedBy = (vendorPattern) => {
    const p = norm(vendorPattern);
    const hit = queueNow.filter((r) => norm(r.payee) === p || norm(r.payee_guess) === p);
    return {
      rows: hit.length,
      usd: Math.round(hit.reduce((s, r) => s + Math.abs(usdOf(r.amount, r.currency, null)), 0) * 100) / 100,
      ids: hit.map((r) => r.id),
    };
  };
  // A UNION — two vendor spellings of one descriptor clear the same rows, and
  // summing per-row numbers would promise more than the queue holds.
  const clearedIds = new Set();

  const out = [];
  for (const [payee, kinds] of tally) {
    for (const kind of ['category', 'dismiss', 'artist']) {
      if (covered[kind].has(norm(payee))) continue;
      const entries = [...kinds[kind].entries()].sort((a, b) => b[1].n - a[1].n);
      if (!entries.length) continue;
      const [value, top] = entries[0];
      if (top.n < MIN_TIMES) continue;
      const total = entries.reduce((s, [, v]) => s + v.n, 0);
      // A genuinely split vendor is a judgement call, not a rule.
      if (top.n / total < 0.6) continue;
      const common = {
        value,
        times: top.n,
        total_usd: Math.round(top.usd * 100) / 100,
        decisions_for_payee: total,
        share: Math.round((top.n / total) * 100),
        conflicts: entries.slice(1).map(([v, x]) => ({ value: v, times: x.n })),
      };

      if (kind === 'category') {
        const real = realInv.get(norm(payee)) || 0;
        if (real > 0) {
          // THIS VENDOR SENDS INVOICES — the row becomes the matching answer,
          // and its action is a link into the queue. No rule is offered.
          out.push({
            kind: 'match', pattern: payee, ...common,
            booked_rows: top.n,
            real_invoices: real,
            waiting_invoices: freeInv.get(norm(payee)) || 0,
          });
          continue;
        }

        // NEVER INVOICES — a category rule is the right answer, if a pattern
        // can be shown to fire.
        const bp = bookPatternFor(kinds.catRows, corpus, norm(payee), value, noise);
        if (!bp) {
          // Nothing distinctive in common. The no-invoice half still works on
          // its own: it clears the queue rows without pretending to book.
          const clears = clearedBy(payee);
          clears.ids.forEach((id) => clearedIds.add(id));
          if (clears.rows > 0) {
            out.push({
              kind: 'no-invoice', pattern: payee, ...common,
              queue_rows: clears.rows, queue_usd: clears.usd,
              also_matches: [], also_matches_count: 0,
            });
          }
          continue;
        }
        // Already in force under the DESCRIPTOR pattern it was stored as.
        if (covered.category.has(norm(bp.pattern))) continue;
        const clearsNow = clearedBy(payee);
        clearsNow.ids.forEach((id) => clearedIds.add(id));
        out.push({
          kind: 'category',
          // What the accepted rule will match on and what the page shows —
          // the same string, or the disclosures describe a different rule.
          pattern: bp.pattern,
          ledger_payee: payee,
          ...common,
          book_pattern_hits: bp.hits,
          book_pattern_rows: bp.rows,
          conflict_rows: bp.conflict_rows,
          open_rows: bp.open_rows,
          reach_rows: bp.reach_rows,
          // The no-invoice half keys on the LEDGER payee — /completion matches
          // that by equality.
          no_invoice_pattern: payee,
          queue_rows: clearsNow.rows,
          queue_usd: clearsNow.usd,
          also_matches: bp.conflict_payees,
          also_matches_count: bp.conflict_payees.length,
        });
        continue;
      }

      // Dismiss and artist write no booking.
      const alsoMatches = kind === 'artist' ? [] : vendors.filter(
        (v) => v !== payee && norm(v).includes(norm(payee)));
      out.push({
        kind, pattern: payee, ...common,
        also_matches: alsoMatches.slice(0, 8),
        also_matches_count: alsoMatches.length,
      });
    }
  }
  // MATCHING FIRST — this feeds a page whose job is tying bank lines to
  // invoices, so the rows with invoices waiting lead.
  const RANK = { match: 0, category: 1, 'no-invoice': 1, dismiss: 2, artist: 3 };
  out.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
    || b.times - a.times || b.total_usd - a.total_usd);
  const of = (k) => out.filter((x) => x.kind === k);
  return {
    suggestions: out,
    counts: {
      match: of('match').length,
      category: of('category').length,
      no_invoice: of('no-invoice').length,
      dismiss: of('dismiss').length,
      artist: of('artist').length,
    },
    clears_queue_rows: clearedIds.size,
    waiting_invoices: of('match').reduce((s, x) => s + (x.waiting_invoices || 0), 0),
    total_rows_covered: out.reduce((s, x) => s + x.times, 0),
    total_usd: Math.round(out.reduce((s, x) => s + x.total_usd, 0) * 100) / 100,
    min_times: MIN_TIMES,
  };
}

// ── The leak report (annotate=1) ─────────────────────────────────────────────
// What each BOOK rule is DOING: how many rows it is putting in the
// needs-invoice queue right now, and which ledger vendors they resolve to —
// split by whether the ledger contradicts a "never invoices" answer. Zero
// means paired or idle; non-zero is a leak, reported where the leak is.
async function annotateCategoryRules(pool, labelId, rules) {
  if (!rules.length) return rules;
  const [{ rows: booked }, { rows: niRules }, rowAnswered, census] = await Promise.all([
    pool.query(`
      SELECT bt.id, bt.payee_guess, bt.description, bt.amount,
             COALESCE(bt.currency, 'USD') AS currency, e.payee, e.category
        FROM bank_transactions bt
        JOIN expenses e ON e.id = bt.matched_expense_id
       WHERE bt.label_id = $1 AND bt.direction = 'debit' AND bt.dismissed = false
         AND (bt.booked = TRUE OR bt.match_method IN ('created', 'rule'))
         AND (e.deleted = false OR e.deleted IS NULL)`, [labelId]),
    pool.query(`SELECT scope, pattern FROM statement_no_invoice_rules WHERE label_id = $1`, [labelId]).catch(() => ({ rows: [] })),
    loadNoInvoiceRowIds(pool, labelId),
    loadInvoiceCensus(pool, labelId),
  ]);
  const niVendor = new Set(niRules.filter((r) => r.scope === 'vendor').map((r) => norm(r.pattern)));
  const niCategory = new Set(niRules.filter((r) => r.scope === 'category').map((r) => norm(r.pattern)));
  const inQueue = booked.filter((r) => !rowAnswered.has(r.id)
    && !niVendor.has(norm(r.payee)) && !niVendor.has(norm(r.payee_guess))
    && !niCategory.has(norm(r.category)));

  const realOf = (name) => census.real.get(norm(name)) || 0;
  return rules.map((rule) => {
    const p = norm(rule.pattern);
    // The same substring test the ingest rule itself runs.
    const mine = inQueue.filter((r) => norm(r.payee_guess).includes(p) || norm(r.description).includes(p));
    const byPayee = new Map();
    for (const r of mine) {
      const name = (r.payee || r.payee_guess || '').trim();
      const g = byPayee.get(norm(name)) || { payee: name, rows: 0, real_invoices: realOf(name) };
      g.rows += 1;
      byPayee.set(norm(name), g);
    }
    // What a vendor no-invoice rule on that name would ACTUALLY clear — it
    // matches e.payee OR bt.payee_guess, so it reaches rows filed under a
    // different ledger name that share the descriptor. Counting only `rows`
    // under-promises: measured, one accept promised 3 and delivered 14.
    for (const g of byPayee.values()) {
      const gp = norm(g.payee);
      g.clears = inQueue.filter((r) => norm(r.payee) === gp || norm(r.payee_guess) === gp).length;
    }
    return {
      ...rule,
      queue_rows: mine.length,
      queue_usd: Math.round(mine.reduce((s, r) => s + Math.abs(usdOf(r.amount, r.currency, null)), 0) * 100) / 100,
      ledger_payees: [...byPayee.values()].sort((a, b) => b.rows - a.rows).slice(0, 6),
    };
  });
}

module.exports = {
  loadInvoiceCensus, loadEverInvoiced, loadNoInvoiceRowIds,
  bookPatternFor, descriptorNoiseFor, buildRuleSuggestions, annotateCategoryRules,
};
