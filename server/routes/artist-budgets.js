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
      `SELECT section, amount::float8 AS amount, note FROM artist_budget_sections WHERE label_id = $1 AND artist_key = $2`,
      [labelId, artistKey]
    )).rows.map((r) => [r.section, r])
  );

  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, {
    key: k, label: SECTION_LABELS[k],
    budget: budgets.get(k)?.amount || 0, note: budgets.get(k)?.note || null,
    verified: 0, awaiting: 0, unverified: 0, unpaid: 0,
    by_category: {}, items: [], open_items: [],
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
      invoice_date: r.invoice_date,
    };
    if (state === 'unpaid') sec.open_items.push(item);
    else {
      sec.items.push(item);
      sec.by_category[r.category || 'Uncategorized'] = round2((sec.by_category[r.category || 'Uncategorized'] || 0) + usd);
    }
  }

  const totals = { budget: 0, spent: 0, open: 0, committed: 0, verified: 0, awaiting: 0, unverified: 0 };
  const out = SECTION_KEYS.map((k) => {
    const s = sections[k];
    // Section figures DERIVED from the states — the partition holds by construction.
    const spent = round2(s.verified + s.awaiting + s.unverified);
    const open = round2(s.unpaid);
    const committed = round2(spent + open);
    s.items.sort((a, b) => (String(b.date) > String(a.date) ? 1 : -1));
    s.open_items.sort((a, b) => (String(a.invoice_date || a.date) > String(b.invoice_date || b.date) ? 1 : -1)); // oldest first — a worklist
    totals.budget += s.budget; totals.spent += spent; totals.open += open; totals.committed += committed;
    totals.verified += s.verified; totals.awaiting += s.awaiting; totals.unverified += s.unverified;
    return {
      ...s,
      verified: round2(s.verified), awaiting: round2(s.awaiting), unverified: round2(s.unverified), unpaid: open,
      spent, open, committed,
      variance: s.budget > 0 ? round2(s.budget - spent) : null, // blank without a budget
      over_committed: s.budget > 0 && committed > s.budget,
      unplanned: s.budget === 0 && committed > 0,
    };
  });
  for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
  return { artist_key: artistKey, artist: display, sections: out, totals };
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
      const e = artists.get(key) || { key, spellings: new Map(), budget: 0, verified: 0, awaiting: 0, unverified: 0, unpaid: 0 };
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
      e[stateOf(r)] += await rowUsd2(r);
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
      };
    }).sort((a, b) => b.committed - a.committed);
    res.json({
      success: true,
      data: {
        artists: data,
        sections: SECTION_KEYS.map((k) => ({ key: k, label: SECTION_LABELS[k] })),
        totals: {
          artists: data.length,
          spent: round2(data.reduce((s, a) => s + a.spent, 0)),
          open: round2(data.reduce((s, a) => s + a.open, 0)),
          budget: round2(data.reduce((s, a) => s + a.budget, 0)),
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
    const ws = wb.addWorksheet('Budget vs spent');
    ws.getColumn(1).width = 30;
    for (let i = 2; i <= 6; i++) ws.getColumn(i).width = 14;
    ws.addRow([`${sheet.artist} — budget vs spent`]).font = { bold: true, size: 13 };
    const head = ws.addRow(['Section', 'Budget', 'Spent', 'Variance', 'Open', 'Committed']);
    head.font = { bold: true };
    for (const s of sheet.sections) {
      if (!s.budget && !s.committed) continue;
      const r = ws.addRow([s.label, s.budget || null, s.spent, s.budget > 0 ? s.variance : null, s.open, s.committed]);
      r.eachCell((c, i) => { if (i >= 2) c.numFmt = MONEY; });
      for (const [cat, v] of Object.entries(s.by_category)) {
        const cr = ws.addRow([`    ${cat}`, null, v]);
        cr.getCell(3).numFmt = MONEY;
        cr.font = { color: { argb: 'FF6B7280' }, size: 9 };
      }
    }
    const tot = ws.addRow(['SPENT / COMMITTED', sheet.totals.budget || null, sheet.totals.spent, sheet.totals.budget > 0 ? round2(sheet.totals.budget - sheet.totals.spent) : null, sheet.totals.open, sheet.totals.committed]);
    tot.font = { bold: true };
    tot.eachCell((c, i) => { if (i >= 2) c.numFmt = MONEY; });
    ws.addRow([]);
    const note = ws.addRow(['Spent is money that has left the bank; open invoices are counted separately and added into the committed total.']);
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
          it.date ? String(it.date).slice(0, 10) : '', it.payee, it.category, s.label, it.song,
          it.amount, it.currency, it.usd, stateWord[it.state], it.recoupable ? 'yes' : 'no',
        ]);
        r.getCell(6).numFmt = '#,##0.00';
        r.getCell(8).numFmt = MONEY;
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="artist-budget-${sheet.artist_key}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) { console.error('budget export error:', e); res.status(500).json({ success: false, error: 'Export failed' }); }
});

module.exports = router;
