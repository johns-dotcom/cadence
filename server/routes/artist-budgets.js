// Artist spend sheets — a budget per artist as SIX SECTION NUMBERS, with
// actuals matched to it. Rules ported from the reference app, each paid for:
//
//  * SPENT and OPEN are separate. An unpaid invoice is not an expenditure —
//    it goes to `open` (its own oldest-first worklist) and the two add into
//    `committed`. (31% of what an earlier page called "spend" was invoices
//    nobody had paid.)
//  * Rounding happens AT THE ROW, once. The sheet slices the same rows two
//    ways (by state and by category) and both must tie to the section total
//    on screen and in the workbook — subtotal rounding broke by a cent in
//    production within a minute.
//  * LEAF ROWS ONLY: a split family's children carry the attribution; the
//    parent carries their sum. Counting both doubles every split invoice.
//  * amount 0 DELETES the budget row; the six blur-saved inputs ARE the
//    creation flow.

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { artistBucketKey } = require('../lib/artistKey');
const { rowUsd2, round2 } = require('../lib/usd');
const bankEvidence = require('../lib/bankEvidence');
const { accountsFor } = require('../lib/bankReconcile');
const { SECTION_KEYS, SECTION_LABELS } = require('../lib/seedCategories');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

async function loadAccounts(labelId) {
  const row = (await pool.query(`SELECT bank_accounts FROM labels WHERE id = $1`, [labelId])).rows[0] || {};
  return accountsFor(row);
}

// category (lower) -> section key, from the per-label vocabulary. Unknown or
// NULL categories land in the LAST section rather than being dropped — a
// sheet that silently omits spend is worse than one that groups it loosely.
async function loadSectionOf(labelId) {
  const map = new Map();
  try {
    const { rows } = await pool.query(
      `SELECT name, ui_group FROM categories WHERE label_id = $1 AND kind = 'expense'`,
      [labelId]
    );
    for (const r of rows) map.set(String(r.name).trim().toLowerCase(), SECTION_KEYS.includes(r.ui_group) ? r.ui_group : 'other');
  } catch { /* fresh label mid-seed — everything lands in 'other' */ }
  return (cat) => map.get(String(cat || '').trim().toLowerCase()) || 'other';
}

async function sheetRows(labelId, accounts) {
  const { rows } = await pool.query(
    `SELECT e.id, e.invoice_date, e.payment_date, e.payee, e.artist, e.song, e.category,
            e.description, e.amount, COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd,
            e.payment_status, e.recoupable, e.entry_source, e.parent_id, e.created_at,
            ${bankEvidence.bankEvidenceCols('e', accounts)}
       FROM expenses e
      WHERE e.label_id = $1
        AND COALESCE(e.status, 'approved') = 'approved'
        AND (e.deleted IS NULL OR e.deleted = FALSE)
        AND (e.voided IS NULL OR e.voided = FALSE)
        AND COALESCE(TRIM(e.artist), '') <> ''
        AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id
                          AND (c.deleted IS NULL OR c.deleted = FALSE)
                          AND (c.voided IS NULL OR c.voided = FALSE))`,
    [labelId]
  );
  return rows;
}

// node-pg hands DATE back as a JS Date, and `String(aDate)` is
// "Sun Jun 01 2025 …" — a WEEKDAY NAME. Sorting on that orders by day-of-week,
// which is how a worklist that promises "oldest first" silently doesn't.
// Everything that compares a date here goes through this.
const isoDay = (d) => {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

const stateOf = (r) => {
  if (r.bank_evidence) return 'verified';
  if (r.payment_status !== 'Paid') return 'unpaid';
  return r.bank_expected ? 'unverified' : 'awaiting';
};

// The one derivation both the JSON endpoint and the Excel export build from.
async function buildSheet(labelId, artistKey) {
  const accounts = await loadAccounts(labelId);
  const sectionOf = await loadSectionOf(labelId);
  const all = await sheetRows(labelId, accounts);
  const rows = all.filter((r) => artistBucketKey(r.artist) === artistKey);

  // Display name = most-used spelling on the artist's own rows.
  const spellings = new Map();
  for (const r of rows) {
    const s = String(r.artist).trim();
    spellings.set(s, (spellings.get(s) || 0) + 1);
  }
  let display = artistKey, n = -1;
  for (const [s, c] of spellings) if (c > n) { display = s; n = c; }

  const budgets = new Map(
    (await pool.query(
      `SELECT section, amount::float8 AS amount, note, updated_at, updated_by
         FROM artist_budget_sections WHERE label_id = $1 AND artist_key = $2`,
      [labelId, artistKey]
    )).rows.map((r) => [r.section, r])
  );

  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, {
    key: k, label: SECTION_LABELS[k],
    budget: budgets.get(k)?.amount || 0, note: budgets.get(k)?.note || null,
    // Provenance: a number six people can type needs to say who typed it.
    // `updated_by` is stored as the actor's NAME, so it is already displayable.
    updated_at: budgets.get(k)?.updated_at || null,
    updated_by_name: budgets.get(k)?.updated_by || null,
    verified: 0, awaiting: 0, unverified: 0, unpaid: 0,
    cat_acc: new Map(), items: [], open_items: [],
  }]));

  for (const r of rows) {
    const usd = await rowUsd2(r); // rounded AT THE ROW — the one rounding site
    const sec = sections[sectionOf(r.category)];
    const state = stateOf(r);
    sec[state] += usd;
    const item = {
      id: r.id, date: r.payment_date || r.invoice_date, payee: r.payee, song: r.song,
      category: r.category, usd, amount: Number(r.amount), currency: r.currency,
      state, recoupable: r.recoupable, entry_source: r.entry_source,
      bank_evidence: r.bank_evidence, bank_expected: r.bank_expected,
      invoice_date: r.invoice_date, section: sec.key, section_label: sec.label,
    };
    if (state === 'unpaid') sec.open_items.push(item);
    else {
      sec.items.push(item);
      // Categories describe SPENT only, so they still sum to the section's
      // spent figure. A count rides along: "$4,200 over 3 invoices" and
      // "$4,200 over 40" are different facts about the same number.
      const cat = r.category || 'Uncategorized';
      const c = sec.cat_acc.get(cat) || { category: cat, actual: 0, count: 0 };
      c.actual = round2(c.actual + usd); c.count += 1;
      sec.cat_acc.set(cat, c);
    }
  }

  const totals = { budget: 0, spent: 0, open: 0, committed: 0, verified: 0, awaiting: 0, unverified: 0, unpaid: 0, count: 0, open_count: 0 };
  const out = SECTION_KEYS.map((k) => {
    const s = sections[k];
    // Section figures DERIVED from the states — the partition holds by construction.
    const spent = round2(s.verified + s.awaiting + s.unverified);
    const open = round2(s.unpaid);
    const committed = round2(spent + open);
    s.items.sort((a, b) => isoDay(b.date).localeCompare(isoDay(a.date)));                        // newest first
    s.open_items.sort((a, b) => isoDay(a.invoice_date || a.date).localeCompare(isoDay(b.invoice_date || b.date))); // oldest first — a worklist
    totals.budget += s.budget; totals.spent += spent; totals.open += open; totals.committed += committed;
    totals.verified += s.verified; totals.awaiting += s.awaiting; totals.unverified += s.unverified; totals.unpaid += open;
    totals.count += s.items.length; totals.open_count += s.open_items.length;
    const { cat_acc, ...rest } = s;
    const categories = [...cat_acc.values()].sort((a, b) => b.actual - a.actual);
    return {
      ...rest,
      categories,
      // Kept as a map too — the by-category chip line and the workbook both read it.
      by_category: Object.fromEntries(categories.map((c) => [c.category, c.actual])),
      verified: round2(s.verified), awaiting: round2(s.awaiting), unverified: round2(s.unverified), unpaid: open,
      spent, open, committed,
      count: s.items.length, open_count: s.open_items.length,
      variance: s.budget > 0 ? round2(s.budget - spent) : null, // blank without a budget
      over_committed: s.budget > 0 && committed > s.budget,
      unplanned: s.budget === 0 && committed > 0,
    };
  });
  for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
  totals.count = out.reduce((t, s) => t + s.count, 0);
  totals.open_count = out.reduce((t, s) => t + s.open_count, 0);
  totals.variance = totals.budget > 0 ? round2(totals.budget - totals.spent) : null;
  totals.over_committed = totals.budget > 0 && totals.committed > totals.budget;
  // Every open invoice across all six sections, GLOBALLY oldest-first. The
  // worklist's whole claim is "the oldest is the one most likely to be a
  // surprise", and a client flatMap over sections orders by section instead.
  const openRows = out.flatMap((s) => s.open_items)
    .sort((a, b) => isoDay(a.invoice_date || a.date).localeCompare(isoDay(b.invoice_date || b.date)));
  return { artist_key: artistKey, artist: display, sections: out, open_rows: openRows, totals };
}

// ── Index — every artist with a budget OR spend (never hidden behind a
// create step; artists with spend and no sheet must LIST). ──────────────────
router.get('/', async (req, res) => {
  try {
    const accounts = await loadAccounts(req.labelId);
    const sectionOf = await loadSectionOf(req.labelId);
    const rows = await sheetRows(req.labelId, accounts);
    const budgets = (await pool.query(
      `SELECT artist_key, section, amount::float8 AS amount FROM artist_budget_sections WHERE label_id = $1`,
      [req.labelId]
    )).rows;

    const artists = new Map();
    const entry = (key) => {
      const e = artists.get(key) || { key, spellings: new Map(), budget: 0, verified: 0, awaiting: 0, unverified: 0, unpaid: 0, count: 0, open_count: 0 };
      artists.set(key, e);
      return e;
    };
    for (const b of budgets) entry(b.artist_key).budget += Number(b.amount);
    for (const r of rows) {
      const key = artistBucketKey(r.artist);
      if (!key) continue; // placeholders roll into nothing here — the sheet is per-artist
      const e = entry(key);
      const s = String(r.artist).trim();
      e.spellings.set(s, (e.spellings.get(s) || 0) + 1);
      const state = stateOf(r);
      e[state] += await rowUsd2(r);
      // Counts alongside the money: "$8,700 over 2 items" and "over 200" are
      // different pictures, and the Open cell's tooltip names its worklist.
      if (state === 'unpaid') e.open_count += 1; else e.count += 1;
    }
    const data = [...artists.values()].map((e) => {
      let name = e.key, n = -1;
      for (const [s, c] of e.spellings) if (c > n) { name = s; n = c; }
      const spent = round2(e.verified + e.awaiting + e.unverified);
      const open = round2(e.unpaid);
      const committed = round2(spent + open);
      return {
        key: e.key, name, budget: round2(e.budget), spent, open, committed,
        verified: round2(e.verified), awaiting: round2(e.awaiting), unverified: round2(e.unverified),
        variance: e.budget > 0 ? round2(e.budget - spent) : null,
        has_budget: e.budget > 0,
        over_committed: e.budget > 0 && committed > e.budget,
        count: e.count, open_count: e.open_count,
      };
    }).sort((a, b) => b.committed - a.committed);
    res.json({
      success: true,
      data: {
        artists: data,
        sections: SECTION_KEYS.map((k) => ({ key: k, label: SECTION_LABELS[k] })),
        totals: {
          artists: data.length,
          // `with_budget` is what makes "N with no budget set yet" sayable, and
          // that count is the page's actual call to action on a fresh workspace.
          with_budget: data.filter((a) => a.has_budget).length,
          spent: round2(data.reduce((s, a) => s + a.spent, 0)),
          open: round2(data.reduce((s, a) => s + a.open, 0)),
          budget: round2(data.reduce((s, a) => s + a.budget, 0)),
          committed: round2(data.reduce((s, a) => s + a.committed, 0)),
          open_count: data.reduce((s, a) => s + a.open_count, 0),
        },
      },
    });
  } catch (e) { console.error('artist-budgets index error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.get('/:artistKey([a-z0-9]+)', async (req, res) => {
  try {
    res.json({ success: true, data: await buildSheet(req.labelId, req.params.artistKey) });
  } catch (e) { console.error('sheet error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// PUT /:artistKey/:section {amount, note} — the six blur-saved inputs ARE the
// creation flow. Zero (with no note) DELETES the row.
router.put('/:artistKey([a-z0-9]+)/:section', async (req, res) => {
  try {
    const { artistKey, section } = req.params;
    if (!SECTION_KEYS.includes(section)) return res.status(400).json({ success: false, error: `section must be one of: ${SECTION_KEYS.join(', ')}` });
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ success: false, error: 'amount must be a number ≥ 0' });
    const note = String(req.body.note || '').trim() || null;
    if (amount === 0 && !note) {
      await pool.query(`DELETE FROM artist_budget_sections WHERE label_id = $1 AND artist_key = $2 AND section = $3`, [req.labelId, artistKey, section]);
    } else {
      await pool.query(
        `INSERT INTO artist_budget_sections (label_id, artist_key, section, amount, note, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (label_id, artist_key, section)
         DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [req.labelId, artistKey, section, amount, note, req.user.name]
      );
    }
    await logActivity(req, 'Set artist budget', `${artistKey}/${section} → ${amount}`);
    res.json({ success: true });
  } catch (e) { console.error('budget set error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// Excel — TWO sheets from the SAME buildSheet as the page: the budget-vs-spent
// summary, and every expense with its state so a recipient outside the
// company can see what the totals are made of.
router.get('/:artistKey([a-z0-9]+)/export', async (req, res) => {
  try {
    const sheet = await buildSheet(req.labelId, req.params.artistKey);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const MONEY = '"$"#,##0.00;[Red]("$"#,##0.00)';
    const t = sheet.totals;
    const ws = wb.addWorksheet('Budget vs spent');
    ws.getColumn(1).width = 34;
    for (let i = 2; i <= 6; i++) ws.getColumn(i).width = 14;
    ws.getColumn(7).width = 44;
    ws.addRow([`${sheet.artist} — budget vs spent`]).font = { bold: true, size: 13 };
    const head = ws.addRow(['Section', 'Budget', 'Spent', 'Variance', 'Open', 'Committed', 'Note']);
    head.font = { bold: true };
    const moneyCells = (r) => r.eachCell((c, i) => { if (i >= 2 && i <= 6) c.numFmt = MONEY; });
    for (const s of sheet.sections) {
      if (!s.budget && !s.committed) continue;
      // The Note column carries the section's own note AND the two conditions
      // that would otherwise only exist as a colour on the screen. Without it
      // the workbook — which is what leaves the company — says nothing about
      // unplanned or over-committed spend.
      const noteText = s.over_committed ? 'over-committed once open invoices are paid'
        : s.unplanned ? 'unplanned — no budget set'
          : (s.note || '');
      const r = ws.addRow([s.label.toUpperCase(), s.budget || null, s.spent, s.budget > 0 ? s.variance : null, s.open, s.committed, noteText]);
      r.font = { bold: true };
      moneyCells(r);
      for (const c of s.categories) {
        const cr = ws.addRow([`    ${c.category}`, null, c.actual, null, null, null, `${c.count} item${c.count === 1 ? '' : 's'}`]);
        cr.getCell(3).numFmt = MONEY;
        cr.font = { color: { argb: 'FF6B7280' }, size: 9 };
      }
    }
    ws.addRow([]);
    const tot = ws.addRow(['SPENT', t.budget || null, t.spent, t.budget > 0 ? t.variance : null, null, null, `${t.count} paid item${t.count === 1 ? '' : 's'}`]);
    tot.font = { bold: true };
    tot.border = { top: { style: 'thin' } };
    moneyCells(tot);
    ws.addRow([]);

    // ── Open, unpaid invoices ─────────────────────────────────────────────
    // NOT in Spent above — an invoice sitting in a drawer is not an
    // expenditure. Its own block, then the two added into COMMITTED.
    if (sheet.open_rows.length) {
      ws.addRow(['OPEN · UNPAID INVOICES']).font = { bold: true };
      for (const o of sheet.open_rows) {
        const r = ws.addRow([`    ${o.payee || '—'}`, null, null, null, o.usd, null,
          [isoDay(o.invoice_date) || null, o.category, o.song].filter(Boolean).join(' · ')]);
        r.getCell(5).numFmt = MONEY;
      }
      const ot = ws.addRow(['STILL TO PAY', null, null, null, t.open, null, `${t.open_count} invoice${t.open_count === 1 ? '' : 's'}`]);
      ot.font = { bold: true };
      ot.border = { top: { style: 'thin' } };
      moneyCells(ot);
      ws.addRow([]);
    }
    const ct = ws.addRow(['COMMITTED (spent + open)', t.budget || null, null, t.budget > 0 ? round2(t.budget - t.committed) : null, null, t.committed,
      t.over_committed ? 'over budget once the open invoices are paid' : '']);
    ct.font = { bold: true };
    ct.border = { top: { style: 'double' } };
    moneyCells(ct);
    ws.addRow([]);

    // The state split, spelled out in words rather than left to a colour — the
    // recipient of this file has no legend and no hover.
    for (const [label, v] of [
      ['Of that spent — confirmed on a bank statement', t.verified],
      ['Of that spent — paid, statement not uploaded yet', t.awaiting],
      ['Of that spent — paid, but no matching bank line', t.unverified],
      ['Open — not paid yet', t.unpaid],
    ]) {
      const r = ws.addRow([label, null, v]);
      r.getCell(3).numFmt = MONEY;
    }
    ws.addRow([]);
    const note = ws.addRow(['Expenses land in a section by their category — nothing is assigned by hand. Spent is money that has left the bank; open invoices are counted separately and added into the committed total.']);
    note.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };

    const ws2 = wb.addWorksheet('Expenses');
    ws2.getColumn(2).width = 26;
    ws2.getColumn(8).width = 24;
    const h2 = ws2.addRow(['Date', 'Payee', 'Category', 'Section', 'Song', 'Amount', 'Cur', 'USD', 'State', 'Recoupable']);
    h2.font = { bold: true };
    const stateWord = { verified: 'confirmed on a statement', awaiting: 'paid, statement not in yet', unverified: 'paid — no bank line', unpaid: 'unpaid' };
    for (const s of sheet.sections) {
      for (const it of [...s.items, ...s.open_items]) {
        const r = ws2.addRow([
          isoDay(it.date), it.payee, it.category, s.label, it.song,
          it.amount, it.currency, it.usd, stateWord[it.state], it.recoupable ? 'yes' : 'no',
        ]);
        r.getCell(6).numFmt = '#,##0.00';
        r.getCell(8).numFmt = MONEY;
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    // The DISPLAY spelling, not the mangled bucket key — this file is opened by
    // people who have never seen an artist_key, and "jerri.xlsx" in a mail
    // thread about Jerri Cole is a file nobody can find again.
    const safe = String(sheet.artist).replace(/[^A-Za-z0-9 _-]/g, '').trim() || sheet.artist_key || 'artist';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safe} - budget vs actual.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) { console.error('budget export error:', e); res.status(500).json({ success: false, error: 'Export failed' }); }
});

module.exports = router;
