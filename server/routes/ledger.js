const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, loadFileBuffer, loadFileBase64, isConfigured: r2Configured } = require('../lib/r2');
const { computeDueDate, PAYMENT_TERMS } = require('../lib/payments');
const { upsertVendor } = require('../lib/vendors');
const claude = require('../lib/claude');
const { sendEmail, vendorDecisionEmail, paymentConfirmationEmail } = require('../lib/email');
const { dispatchSend, loadLabelIdentity } = require('../lib/emailDispatch');
const { stampFxRateAsync } = require('../lib/fxStamp');
const { familyRoot, cascadePaymentFieldsToFamily, recomputeFamilyPaymentStatus } = require('../lib/paymentFamily');
const { toUSD } = require('../lib/fx');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');
const paymentCrypto = require('../lib/paymentCrypto');
const aiScan = require('../lib/aiScan');
const bankEvidence = require('../lib/bankEvidence');
const { excludeBankRows, excludeCreatorRows, BANK_SOURCE, reportingThresholdFor } = require('../lib/ledgerSource');
const w9NameMatch = require('../lib/w9NameMatch');
const { usdOf, rowUsd2, round2 } = require('../lib/usd');
const { namesAnArtist } = require('../lib/artistKey');
const { ADDED_SOURCES, addedExpenseRollup, unifiedRows } = require('../lib/vendorSurfaces');
const { pairKey, ackKey, vendorDupePairs } = require('../lib/vendorDupes');
const { cascadeVendorName, revertVendorCascade } = require('../lib/vendorCascade');
const { aggregateBankVendors, applyVendorOverride } = require('../lib/bankVendors');
const { validateApprovalChecklist, stampChecklist, writeApprovalChecklist } = require('../lib/approvalChecklist');
const activityBot = require('../lib/activityBot');
const { BULK_DEALS_SQL, deriveDeal } = require('../lib/bulkDeals');
const ExcelJS = require('exceljs');
const { buildZip, toCsv } = require('../lib/zip');

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

// Bound spreadsheet import (parsed from an uploaded file). exceljs replaces the
// `xlsx` package (known unpatched prototype-pollution / ReDoS CVEs); the row cap
// bounds a crafted-file DoS.
const MAX_IMPORT_ROWS = 20000;
// Normalize an exceljs cell value to a plain string (rich text / formula /
// hyperlink cells come through as objects).
const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text != null) return v.text;
    if (v.result != null) return v.result;
    return '';
  }
  return v;
};

// Canonical invoice-number key — shared with vendor-submit, bulk-zip, dup-check.
const normInv = normalizeInvoiceNum;
const fileExt = (key) => (/\.pdf$/i.test(key) ? 'pdf' : /\.png$/i.test(key) ? 'png' : /\.jpe?g$/i.test(key) ? 'jpg' : 'bin');
const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);

// Best-effort notify a vendor about a decision/payment on their submission.
async function notifyVendor(labelId, entry, kind, extra = {}) {
  try {
    if (!entry?.vendor_email) return;
    const identity = await loadLabelIdentity(labelId);
    const workspaceName = identity?.name || 'the label';
    const accent = identity?.accent_color || null;
    const common = { vendorName: entry.vendor_name || entry.payee || 'there', workspaceName, accent, invoiceNumber: entry.invoice_number, amount: entry.amount, currency: entry.currency };
    const msg = kind === 'paid'
      ? paymentConfirmationEmail({ ...common, method: extra.method, date: extra.date })
      : vendorDecisionEmail({ ...common, approved: kind === 'approved', reason: extra.reason });
    await sendEmail({ to: entry.vendor_email, subject: msg.subject, html: msg.html, text: msg.text, label: identity });
  } catch (_) { /* best-effort */ }
}

const router = express.Router();
router.use(authMiddleware, withTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// How long a PAID row keeps showing on the Payments list before it drops to the
// ledger. Shared by /payables and /payment-stats so the list and the stat card can
// never disagree about what counts as "recent". A compile-time integer, never user
// input — safe to interpolate into SQL. 14 days = boom parity (was 7 — the
// shorter window hid a just-paid batch before its confirmations went out).
const PAID_GRACE_DAYS = 14;
const fileFields = upload.fields([
  { name: 'invoice_file', maxCount: 1 },
  { name: 'w9_file', maxCount: 1 },
  // A reimbursement can claim several receipts (dinner + ride + parking). The
  // first one lives on the row's receipt_* columns; extras land in entity_files.
  { name: 'receipt_file', maxCount: 10 },
  { name: 'proof_file', maxCount: 1 },
]);

// Creating an entry is open to ANY workspace member (the Add Invoice page):
// approvers create it approved (straight to the ledger); everyone else creates
// it pending so it routes through Approvals. Registered before the gate below.
router.post('/entries', fileFields, createEntry);

// The helpers that page leans on must be reachable by the SAME population that
// can POST /entries — boom gated all of this on the bookkeeping page grant, and
// cadence's equivalent of that grant is "any member" (INT-2). Behind the
// Approver gate these returned a silent 403 to the page's main audience: no AI
// parse, and a dup check that always answered "no duplicate". None of them
// leak ledger data beyond what the caller typed: the parse/validate routes
// only read the caller's own upload, and check-dup/vendor-w9-status answer
// about the payee the caller is already filing against.
router.post('/parse-invoice', upload.single('file'), parseInvoiceRoute);
router.post('/validate-invoice', upload.single('file'), validateInvoiceRoute);
router.post('/validate-w9', upload.single('file'), validateW9Route);
router.post('/parse-proof', upload.single('file'), parseProofRoute);
router.post('/parse-lines', upload.single('file'), parseLinesRoute);
router.get('/check-dup', checkDupRoute);
router.get('/vendor-w9-status', vendorW9StatusRoute);

// Everything else on the ledger handles money out — finance surface, Approver+.
router.use(requireApprover);

// Map a multipart file → R2 and return { filename, r2_key }. Tenant-namespaced.
async function storeFile(labelId, file, kind) {
  const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `label-${labelId}/ledger/${kind}-${Date.now()}-${safe}`;
  await uploadFile(key, file.buffer, file.mimetype);
  return { filename: file.originalname, key };
}

// payment_status vocabulary + its case-insensitive canonicalizer live in
// lib/constants.js so the rule has one home and the fixtures can hold it.
const { PAYMENT_STATUSES, canonicalPaymentStatus } = require('../lib/constants');

const EDITABLE = [
  'invoice_date', 'payee', 'description', 'category', 'artist', 'song',
  'invoice_number', 'amount', 'currency', 'payment_method', 'payment_date',
  'is_reimbursement', 'recoupable', 'rep', 'notes', 'payment_status',
  'payment_terms', 'scheduled_payment_date', 'cobrand', 'is_bulk_deal',
  'vendor_email', 'payment_ref', 'vendor_address', 'vendor_bank',
  // bulk_deal_completed is an INT delivered-COUNT; bulk_deal_archived is the
  // boolean "move it to the Completed section" flag. See lib/bulkDeals.js.
  'bulk_deal_quantity', 'bulk_deal_unit', 'bulk_deal_completed', 'bulk_deal_archived', 'social_handles',
  // Boom-parity vocabulary (LED-6): who paid, UFR + campaign markers, tone
  // labels, catalog link, QuickBooks reconciliation.
  'paid_by', 'ufr', 'artist_campaign', 'recoupment_label', 'release_id',
  'in_quickbooks', 'qb_entry_date',
];

// Auto-link an expense to the catalog by exact artist + song match (boom's
// autoLinkRelease). Fires on song/artist edits when the row has no link yet.
// Returns { id, name } of the linked release, or null. Best-effort — a catalog
// miss must never block the edit.
async function autoLinkRelease(labelId, expenseId) {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses e SET release_id = r.id
         FROM releases r JOIN artists a ON a.id = r.artist_id
        WHERE e.id = $1 AND e.label_id = $2 AND e.release_id IS NULL
          AND r.label_id = e.label_id
          AND LOWER(TRIM(r.project_name)) = LOWER(TRIM(e.song))
          AND LOWER(TRIM(a.name)) = LOWER(TRIM(e.artist))
        RETURNING r.id, r.project_name AS name`,
      [expenseId, labelId]
    );
    return rows[0] || null;
  } catch { return null; }
}

// Server-side comma/slash auto-split (boom parity, LED-16): editing a childless
// root entry's song to "A, B" (or "A / B") splits it evenly per song — even
// cents with the remainder on the FIRST slice, children inheriting the parent's
// approval + payment stamps. Guarded by no_auto_split (set by unsplit, so a
// fixed comma-in-title song stays fixed). Returns the number of slices, or 0.
async function autoSplitOnSong(labelId, row, userName) {
  if (row.parent_id || row.no_auto_split || !(Number(row.amount) > 0)) return 0;
  const songs = String(row.song || '').split(/[,/]/).map(x => x.trim()).filter(Boolean);
  if (songs.length < 2) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kid = await client.query('SELECT 1 FROM expenses WHERE parent_id = $1 LIMIT 1', [row.id]);
    if (kid.rows.length) { await client.query('ROLLBACK'); return 0; }
    const totalC = Math.round(Number(row.amount) * 100);
    const eachC = Math.floor(totalC / songs.length);
    const amounts = songs.map((_, i) => (eachC + (i === 0 ? totalC - eachC * songs.length : 0)) / 100);
    const splits = songs.map((song, i) => ({ artist: row.artist || null, song, amount: amounts[i] }));
    const snapshot = { origin: { amount: Number(row.amount), artist: row.artist || null, song: row.song || null }, splits };
    await client.query(
      `UPDATE expenses SET amount = $1, song = $2, artist_breakdown = $3::jsonb WHERE id = $4 AND label_id = $5`,
      [splits[0].amount, splits[0].song, JSON.stringify(snapshot), row.id, labelId]
    );
    for (const sp of splits.slice(1)) {
      await client.query(
        `INSERT INTO expenses (label_id, parent_id, invoice_date, payee, description, category, artist, song,
           invoice_number, amount, currency, payment_method, status, payment_status, is_reimbursement, recoupable,
           rep, notes, entry_source, cobrand, is_bulk_deal, payment_date, paid_by, payment_ref, fx_rate_to_usd,
           scheduled_payment_date, payment_terms, vendor_email, approved_by, approved_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,NOW())`,
        [labelId, row.id, row.invoice_date, row.payee, row.description, row.category,
         row.artist, sp.song, row.invoice_number, sp.amount, row.currency,
         row.payment_method, row.status, row.payment_status, row.is_reimbursement, row.recoupable,
         row.rep, row.notes, row.entry_source, row.cobrand, row.is_bulk_deal, row.payment_date,
         row.paid_by, row.payment_ref, row.fx_rate_to_usd, row.scheduled_payment_date, row.payment_terms,
         row.vendor_email, row.approved_by, row.approved_at, userName]
      );
    }
    await client.query('COMMIT');
    return splits.length;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Auto-split error:', e.message);
    return 0;
  } finally {
    client.release();
  }
}

// Rep visibility: Admins/Superadmins see all. An Approver with a configured
// visible-rep set sees only those reps (plus unattributed rows); an Approver
// with no set configured is unrestricted. Returns a list of rep names or null
// (null = no restriction).
async function visibleReps(req) {
  if (['Superadmin', 'Admin'].includes(req.user.role)) return null;
  const { rows } = await pool.query('SELECT rep_name FROM user_visible_reps WHERE user_id = $1 AND label_id = $2', [req.user.id, req.labelId]);
  return rows.length ? rows.map(r => r.rep_name) : null;
}

// ── The two halves of the ledger: ?source=bank | ?source=invoices ───────────
//
//   source=bank      only rows booked from a bank statement  (the Bank Ledger)
//   source=invoices  everything else                          (the ledger proper)
//   absent           unchanged — every existing caller keeps its behaviour
//
// OPT-IN, and that matters more than it looks: this endpoint has many callers
// (Ledger, Approvals, drawers, the split fetch, Recoupments). A new DEFAULT
// filter would silently change every one of them.
//
// `invoices` is the COMPLEMENT of `bank`, never a second whitelist — that is
// what guarantees the two halves partition the ledger. A whitelist pair drifts
// and starts losing rows out of both sides, and a row missing from the ledger
// is the one bug here nobody would notice.
//
// The exclusion comes from lib/ledgerSource.js, which uses IS DISTINCT FROM:
// `entry_source` is nullable and most hand-entered rows have it NULL, which a
// plain `<> 'bank_statement'` drops. Inclusion is plain equality — for that
// direction NULL genuinely is "no".
//
// Returns null for an unrecognised value; every caller turns that into a 400
// rather than ignoring it. A typo'd source silently returning everything is the
// same failure as a limit that is accepted and ignored.
function sourceClause(source, alias = 'e') {
  if (source === undefined || source === '' || source === 'all') return '';
  if (source === 'bank') return ` AND ${alias}.entry_source = '${BANK_SOURCE}'`;
  if (source === 'invoices') return ` AND ${excludeBankRows(alias)}`;
  return null;
}
const BAD_SOURCE = { success: false, error: "source must be 'bank' or 'invoices'" };

// GET /api/ledger/entries — list with optional filters (?status=, ?q=)
router.get('/entries', async (req, res) => {
  try {
    const params = [req.labelId];
    // Child rows of a split are hidden from the main list (the parent carries
    // the combined total); pass ?parent=<id> to fetch a split's children.
    let where = 'label_id = $1 AND (deleted = false OR deleted IS NULL)';
    if (req.query.parent) { params.push(parseInt(req.query.parent, 10)); where += ` AND parent_id = $${params.length}`; }
    else where += ' AND parent_id IS NULL';
    // Pending items live only in Approvals — they don't hit the ledger until
    // approved. Callers that explicitly ask for status=pending (the Approvals
    // page) still get them; every other ledger view excludes them.
    if (req.query.status) { params.push(req.query.status); where += ` AND status = $${params.length}`; }
    else where += ` AND status <> 'pending'`;
    if (req.query.payment_status) { params.push(req.query.payment_status); where += ` AND payment_status = $${params.length}`; }
    if (req.query.category) { params.push(req.query.category); where += ` AND category = $${params.length}`; }
    if (req.query.artist) { params.push(`%${req.query.artist}%`); where += ` AND artist ILIKE $${params.length}`; }
    if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND (payee ILIKE $${params.length} OR description ILIKE $${params.length} OR artist ILIKE $${params.length} OR invoice_number ILIKE $${params.length})`; }

    const source = req.query.source;
    const srcSql = sourceClause(source, 'e');
    if (srcSql === null) return res.status(400).json(BAD_SOURCE);
    where += srcSql;

    // ── Bank-mode extras ────────────────────────────────────────────────────
    // Scoped to source=bank rather than added to LEDGER_VIEW_COLS, which four
    // pages read. Each is its own subquery and the invoiced half reads none of
    // them, so the worst case of a mistake here touches one page.
    //
    //   bank_evidence / bank_expected — the matching bank line, resolved
    //     through COALESCE(parent_id, id) so a split child shows its family's
    //     line rather than nothing (lib/bankEvidence.js).
    //   no_invoice_expected — has anyone answered "no invoice is coming for
    //     this"? bool_or over the family root's live transactions, matching how
    //     bank_evidence resolves. The column is `no_invoice`; the derived name
    //     says what it means on a ledger row.
    let bankCols = '';
    if (source === 'bank') {
      const accounts = await bankEvidence.loadAccounts(pool, req.labelId).catch(() => []);
      bankCols = `,
         ${bankEvidence.bankEvidenceCols('e', accounts)},
         (SELECT bool_or(COALESCE(nbt.no_invoice, false))
            FROM bank_transactions nbt
           WHERE nbt.label_id = e.label_id
             AND nbt.matched_expense_id = COALESCE(e.parent_id, e.id)
             AND nbt.dismissed = false) AS no_invoice_expected`;
    }

    const reps = await visibleReps(req);
    if (reps) { params.push(reps); where += ` AND (rep = ANY($${params.length}) OR rep IS NULL)`; }

    // Optional row cap (?limit=). Garbage is a 400, not a silent full scan —
    // boom's 14.5s payload incident is why this exists (LED-28).
    let limitSql = '';
    if (req.query.limit !== undefined) {
      const lim = parseInt(req.query.limit, 10);
      if (!Number.isFinite(lim) || lim <= 0) return res.status(400).json({ success: false, error: 'Bad limit' });
      params.push(lim); limitSql = ` LIMIT $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT ${LEDGER_VIEW_COLS},
         (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)) AS split_count,
         -- Family total: the parent's slice + its live children. Voided children
         -- are excluded — a voided slice is reversed money (LED-27).
         (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
             WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)
               AND (c.voided = false OR c.voided IS NULL)), 0)) AS family_amount,
         (SELECT COUNT(*)::int FROM entity_files f
            WHERE f.label_id = e.label_id AND f.entity_type = 'expense_receipt' AND f.entity_id = e.id) AS receipt_count,
         -- Discrepancy COUNTS only — the full scan JSONB stays off the list
         -- payload (the drawer fetches GET /entries/:id for the detail).
         (CASE WHEN jsonb_typeof(e.ai_scan->'discrepancies') = 'array' THEN jsonb_array_length(e.ai_scan->'discrepancies') ELSE 0 END) AS ai_flags,
         (CASE WHEN jsonb_typeof(e.w9_scan->'discrepancies') = 'array' THEN jsonb_array_length(e.w9_scan->'discrepancies') ELSE 0 END) AS w9_flags,
         (CASE WHEN e.settlement_group_id IS NULL THEN 0 ELSE
           (SELECT COUNT(*)::int FROM expenses g WHERE g.label_id = e.label_id AND g.settlement_group_id = e.settlement_group_id AND (g.deleted = false OR g.deleted IS NULL)) END) AS settlement_group_size,
         -- Alias-aware shared-W9 resolution (boom's w9_entry_id): the row that
         -- HOLDS this vendor's W9, so the W9 cell can offer View-from-sibling.
         (SELECT x.id FROM expenses x
           WHERE x.label_id = e.label_id AND x.w9_r2_key IS NOT NULL
             AND (x.deleted = false OR x.deleted IS NULL) AND x.status <> 'rejected'
             AND (
               LOWER(TRIM(x.payee)) = LOWER(TRIM(e.payee))
               OR LOWER(TRIM(x.payee)) IN (
                 SELECT LOWER(TRIM(va.alias))     FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.canonical)) = LOWER(TRIM(e.payee))
                 UNION
                 SELECT LOWER(TRIM(va.canonical)) FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.alias))     = LOWER(TRIM(e.payee))
               )
             )
           ORDER BY x.id DESC LIMIT 1) AS w9_entry_id${bankCols}
       FROM expenses e WHERE ${where} ORDER BY COALESCE(invoice_date, created_at::date) DESC, id DESC${limitSql}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List ledger error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// The trimmed list column set (LED-28): everything the table renders, none of
// the per-row JSONB blobs (ai_scan / w9_scan / approval_checklist / w9_review)
// that made boom's untrimmed list an 8.67MB payload. artist_breakdown stays —
// the socials column and split-modal prefill read it.
const LEDGER_VIEW_COLS = `e.id, e.label_id, e.parent_id, e.invoice_date, e.payee, e.description, e.category,
  e.artist, e.song, e.invoice_number, e.amount, e.currency, e.fx_rate_to_usd, e.payment_method, e.status,
  e.payment_status, e.payment_date, e.paid_by, e.payment_ref, e.payment_terms, e.scheduled_payment_date,
  e.is_reimbursement, e.recoupable, e.rep, e.notes, e.vendor_email, e.vendor_address, e.vendor_bank,
  e.cobrand, e.is_bulk_deal, e.bulk_deal_quantity, e.bulk_deal_unit, e.bulk_deal_completed,
  e.bulk_deal_archived,
  e.vendor_submitted, e.entry_source, e.campaign_id, e.artist_campaign, e.ufr, e.ufr_marked_at,
  e.recoupment_label, e.release_id, e.social_handles, e.artist_breakdown, e.voided, e.voided_by,
  e.rush, e.on_hold, e.flagged, e.flag_reason, e.flagged_by, e.flagged_at, e.approved_by, e.created_at,
  e.rejected_reason, e.in_quickbooks, e.qb_entry_date, e.no_auto_split, e.settlement_group_id,
  e.invoice_r2_key, e.invoice_filename, e.w9_r2_key, e.w9_filename, e.receipt_r2_key, e.receipt_filename,
  e.proof_r2_key, e.proof_filename, e.deleted`;

// GET /api/ledger/entries/:id — one full row (incl. the scan JSONB the list
// omits). The drawer's detail fetch, and the ?focus fallback for split
// children that aren't in the main list.
router.get('/entries/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
         (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)) AS split_count
       FROM expenses e WHERE e.id = $1 AND e.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Per-entry rep-visibility backstop for mutations (boom's userCanActOnEntry).
// The queue GET filters what a rep-restricted Approver SEES; this stops the
// same Approver from approving/rejecting/rushing a hidden entry by direct API
// call. Admins (and unrestricted Approvers) short-circuit to allowed.
async function canActOnEntry(req, entryId) {
  const reps = await visibleReps(req);
  if (!reps) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM expenses WHERE id = $1 AND label_id = $2 AND (rep = ANY($3) OR rep IS NULL) LIMIT 1',
    [entryId, req.labelId, reps]
  );
  return rows.length > 0;
}

// Bulk pre-check: first id hidden from the caller, or null when all visible.
// Any invisible entry rejects the whole batch — silently skipping would leave
// items pending without the caller knowing.
async function findInvisibleEntry(req, ids) {
  const reps = await visibleReps(req);
  if (!reps || !ids.length) return null;
  const { rows } = await pool.query(
    'SELECT id, rep FROM expenses WHERE id = ANY($1::int[]) AND label_id = $2 AND NOT (rep = ANY($3) OR rep IS NULL) LIMIT 1',
    [ids, req.labelId, reps]
  );
  return rows[0] || null;
}

// ── The annotated approvals queue ───────────────────────────────────────────
// GET /api/ledger/approvals — pending parents plus everything the reviewer
// needs decided AT READ TIME (boom's GET /bk/approvals):
//   · alias silencing of name discrepancies (bidirectional alias graph,
//     whole-word mention matching for the AI's descriptive sentences)
//   · stale-amount silencing (family/breakdown total vs document, ±1¢)
//   · unknown-artist / unknown-song detection with Levenshtein suggestions
//   · possible_duplicates via normalizeInvoiceNum across vendor identities
//   · w9_entry_id — the alias-aware row that HOLDS this vendor's W9
//   · usd_equiv for non-USD rows (client renders the ≈USD suffix)
// Computed per request, never stored: it covers rows that already exist and
// un-flags itself when the cause goes away (alias added, entry deleted).
router.get('/approvals', async (req, res) => {
  try {
    const params = [req.labelId];
    let where = `e.label_id = $1 AND e.status = 'pending'
      AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
      AND e.parent_id IS NULL`;
    const reps = await visibleReps(req);
    if (reps) { params.push(reps); where += ` AND (e.rep = ANY($${params.length}) OR e.rep IS NULL)`; }

    const [pendRes, aliasRes, artistsRes, releasesRes] = await Promise.all([
      pool.query(
        `SELECT e.*,
           (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)) AS split_count,
           (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount,
           (e.invoice_r2_key IS NOT NULL) AS has_invoice,
           (e.w9_r2_key IS NOT NULL) AS has_w9,
           (SELECT x.id FROM expenses x
             WHERE x.label_id = e.label_id AND x.w9_r2_key IS NOT NULL
               AND (x.deleted = false OR x.deleted IS NULL) AND x.status <> 'rejected'
               AND (
                 LOWER(TRIM(x.payee)) = LOWER(TRIM(e.payee))
                 OR LOWER(TRIM(x.payee)) IN (
                   SELECT LOWER(TRIM(va.alias))     FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.canonical)) = LOWER(TRIM(e.payee))
                   UNION
                   SELECT LOWER(TRIM(va.canonical)) FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.alias))     = LOWER(TRIM(e.payee))
                 )
               )
             ORDER BY x.id DESC LIMIT 1) AS w9_entry_id
         FROM expenses e WHERE ${where} ORDER BY e.created_at ASC, e.id ASC`,
        params
      ),
      pool.query('SELECT canonical, alias FROM vendor_aliases WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT id, name FROM artists WHERE label_id = $1', [req.labelId]),
      pool.query(
        `SELECT r.id, r.project_name, a.name AS artist_name FROM releases r
           LEFT JOIN artists a ON a.id = r.artist_id
          WHERE r.label_id = $1 AND r.project_name IS NOT NULL AND TRIM(r.project_name) <> ''`,
        [req.labelId]
      ),
    ]);

    // ── Alias graph (bidirectional) for read-time name-discrepancy silencing ─
    const norm = (s) => String(s || '').toLowerCase().trim();
    const aliasesOf = new Map();
    for (const { canonical, alias } of aliasRes.rows) {
      const p = norm(canonical), a = norm(alias);
      if (!p || !a) continue;
      if (!aliasesOf.has(p)) aliasesOf.set(p, new Set());
      if (!aliasesOf.has(a)) aliasesOf.set(a, new Set());
      aliasesOf.get(p).add(a);
      aliasesOf.get(a).add(p);
    }
    const namesForPayee = (payee) => {
      const p = norm(payee);
      const set = new Set();
      if (p) set.add(p);
      for (const n of (aliasesOf.get(p) || [])) set.add(n);
      return set;
    };
    const isAliasedName = (field) => {
      const f = String(field || '').toLowerCase();
      return f.includes('vendor') || f.includes('payee') || f.includes('name');
    };
    // Whole-word match so a short alias like "Bob" doesn't match "Bobby" —
    // \W boundaries handle the punctuation the AI wraps names in.
    const mentions = (value, name) => {
      const v = String(value || '');
      if (!v || !name) return false;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(v);
    };
    const explained = (value, names) => {
      const v = norm(value);
      if (!v) return false;
      for (const n of names) if (n && (v === n || mentions(value, n))) return true;
      return false;
    };
    const parseAmount = (v) => {
      if (v == null) return null;
      const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const isAmountField = (field) => /amount|total|sum/i.test(String(field || ''));

    // ── Unknown-artist / unknown-song (normalized + Levenshtein 1–3) ────────
    const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const levDist = (a, b) => {
      if (a === b) return 0;
      if (!a.length) return b.length;
      if (!b.length) return a.length;
      const v = new Array(b.length + 1);
      for (let j = 0; j <= b.length; j++) v[j] = j;
      for (let i = 1; i <= a.length; i++) {
        let prev = v[0]; v[0] = i;
        for (let j = 1; j <= b.length; j++) {
          const tmp = v[j];
          v[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, v[j], v[j - 1]);
          prev = tmp;
        }
      }
      return v[b.length];
    };
    const indexByNorm = (rows, key) => {
      const m = new Map();
      for (const r of rows) { const k = normName(r[key]); if (k && !m.has(k)) m.set(k, r); }
      return m;
    };
    const rosterByNorm = indexByNorm(artistsRes.rows, 'name');
    const releasesByNorm = indexByNorm(releasesRes.rows, 'project_name');
    const findClosest = (query, byNorm) => {
      const qk = normName(query);
      if (!qk || qk.length < 2) return { known: false, suggestion: null };
      if (byNorm.has(qk)) return { known: true, suggestion: null };
      let best = null;
      for (const [k, v] of byNorm) {
        if (Math.abs(k.length - qk.length) > 3) continue;
        const d = levDist(qk, k);
        const longer = Math.max(k.length, qk.length);
        const threshold = longer <= 6 ? 1 : longer <= 12 ? 2 : 3;
        if (d > 0 && d <= threshold && (!best || d < best.d)) { best = { d, v }; if (d === 1) break; }
      }
      return { known: false, suggestion: best?.v || null };
    };

    for (const row of pendRes.rows) {
      const names = namesForPayee(row.payee);
      let familyTotal = parseAmount(row.family_amount);
      if (familyTotal == null && Array.isArray(row.artist_breakdown)) {
        const sum = row.artist_breakdown.reduce((s, b) => s + (parseAmount(b?.amount) || 0), 0);
        if (sum > 0) familyTotal = sum;
      }
      for (const col of ['ai_scan', 'w9_scan']) {
        const scan = row[col];
        if (!scan || !Array.isArray(scan.discrepancies)) continue;
        const before = scan.discrepancies.length;
        scan.discrepancies = scan.discrepancies.filter(d => {
          // Stale-amount silencer (invoice scans only — W9s carry no amount):
          // scan ran pre-split, the family total now matches the document.
          if (col === 'ai_scan' && isAmountField(d.field) && familyTotal != null) {
            const docVal = parseAmount(d.document_value);
            if (docVal != null && Math.abs(docVal - familyTotal) < 0.01) return false;
          }
          if (!isAliasedName(d.field)) return true;
          // Invoice scans put the document side in document_value; W9 scans
          // sometimes use w9_value.
          const other = d.document_value != null ? d.document_value : d.w9_value;
          return !(explained(d.form_value, names) && explained(other, names));
        });
        if (before > 0 && scan.discrepancies.length === 0) {
          scan.summary = 'All form fields match — discrepancies resolved by alias or split totals.';
        }
      }
      if (row.artist && row.artist.trim()) {
        const { known, suggestion } = findClosest(row.artist, rosterByNorm);
        if (!known) {
          row.unknown_artist = true;
          if (suggestion) { row.suggested_artist_id = suggestion.id; row.suggested_artist_name = suggestion.name; }
        }
      }
      if (row.song && row.song.trim()) {
        const { known, suggestion } = findClosest(row.song, releasesByNorm);
        if (!known) {
          row.unknown_song = true;
          if (suggestion) {
            row.suggested_release_id = suggestion.id;
            row.suggested_song_name = suggestion.project_name;
            row.suggested_release_artist = suggestion.artist_name;
          }
        }
      }
      // ≈USD for the amount suffix — non-USD only, live conversion (pending
      // rows have no locked rate yet). Uses the family total the card shows.
      if (row.currency && row.currency !== 'USD') {
        const usd = toUSD(familyTotal ?? row.amount, row.currency, row.invoice_date);
        if (Number.isFinite(usd)) row.usd_equiv = Math.round(usd * 100) / 100;
      }
    }

    // ── Possible duplicates — normalized invoice-number collisions across the
    // vendor's identities (email / vendor_name / payee). JS-side normInv, never
    // re-expressed in SQL: lib/normalizeInvoiceNum is the one definition.
    const needDup = pendRes.rows.filter(r => String(r.invoice_number || '').trim());
    if (needDup.length) {
      const idents = [...new Set(needDup.flatMap(r => [r.vendor_email, r.vendor_name, r.payee]
        .map(x => String(x || '').trim().toLowerCase()).filter(Boolean)))];
      const { rows: cands } = await pool.query(
        `SELECT id, invoice_number, amount, invoice_date, status, payee, vendor_name, vendor_email
           FROM expenses
          WHERE label_id = $1 AND invoice_number IS NOT NULL AND TRIM(invoice_number) <> ''
            AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
            AND status <> 'rejected'
            AND (LOWER(TRIM(vendor_email)) = ANY($2) OR LOWER(TRIM(vendor_name)) = ANY($2) OR LOWER(TRIM(payee)) = ANY($2))`,
        [req.labelId, idents]
      ).catch(() => ({ rows: [] }));
      const identsOf = (r) => [r.vendor_email, r.vendor_name, r.payee]
        .map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
      for (const row of needDup) {
        const mine = identsOf(row);
        const key = normInv(row.invoice_number);
        const hits = cands.filter(c => c.id !== row.id
          && normInv(c.invoice_number) === key
          && identsOf(c).some(x => mine.includes(x)));
        if (hits.length) {
          row.possible_duplicates = hits.map(c => ({
            id: c.id, invoice_number: c.invoice_number, amount: c.amount,
            invoice_date: c.invoice_date, status: c.status,
          }));
        }
      }
    }

    res.json({ success: true, data: pendRes.rows });
  } catch (error) {
    console.error('Approvals queue error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/approval-history — the last 50 cross-queue approval actions
// (approve / split / reject / restore) from bk_audit_log, with the payee joined
// on so the panel can name the row without a fetch per line.
router.get('/approval-history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.action, b.detail, b.actor, b.created_at, b.expense_id, e.payee
         FROM bk_audit_log b LEFT JOIN expenses e ON e.id = b.expense_id AND e.label_id = b.label_id
        WHERE b.label_id = $1 AND b.action IN ('approved', 'rejected', 'split', 'restored', 'w9_review')
        ORDER BY b.created_at DESC, b.id DESC LIMIT 50`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Approval history error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/pending-count — for the nav badge
router.get('/pending-count', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM expenses WHERE label_id = $1 AND status = 'pending' AND (deleted = false OR deleted IS NULL)`,
      [req.labelId]
    );
    res.json({ success: true, data: { count: rows[0].n } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create an entry (optionally with files). Approvers create approved (into the
// ledger); other members create pending → Approvals. Vendor submissions come
// in as pending through the public route.
async function createEntry(req, res) {
  try {
    const b = req.body;
    if (!b.payee || !b.amount) {
      return res.status(400).json({ success: false, error: 'Payee and amount are required' });
    }
    const canApprove = ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

    // ── The approval checklist, answered at CREATE time by Add Invoice ────
    // An approver's add is written `status = 'approved'` below, so it never
    // reaches the Approvals queue — the same review has to happen here or
    // "approved" means two things. Optional (the vendor form, CSV import and
    // internal add-expense modals send none and are unaffected), but a
    // checklist that ARRIVES must be valid BEFORE the insert: a 400 later
    // would leave behind exactly the row this exists to prevent — approved,
    // filed, and never asked. Multipart bodies carry it as a JSON string.
    let checklistAnswered = null;
    if (b.checklist !== undefined && b.checklist !== null && b.checklist !== '') {
      let rawChecklist = b.checklist;
      if (typeof rawChecklist === 'string') { try { rawChecklist = JSON.parse(rawChecklist); } catch { rawChecklist = null; } }
      const check = validateApprovalChecklist(rawChecklist);
      if (!check.ok) return res.status(400).json({ success: false, error: check.error });
      checklistAnswered = check.value;
    }

    // ── Duplicate gate (boom parity) — BEFORE anything touches R2 ─────────
    // Same normalized number for the same vendor (alias- and email-aware) is a
    // 409 with the existing invoice attached, unless the caller has already
    // acknowledged it ("Add anyway" sends force_duplicate).
    if (b.invoice_number && !(b.force_duplicate === true || b.force_duplicate === 'true')) {
      const dup = await findDuplicateInvoice(req.labelId, { payee: b.payee, vendor_email: b.vendor_email, invoice_number: b.invoice_number });
      if (dup) {
        return res.status(409).json({
          success: false,
          error: `Invoice #${b.invoice_number} looks like a duplicate of entry #${dup.id} for ${dup.payee || b.payee}. Set force_duplicate to add it anyway.`,
          duplicate: dup,
        });
      }
    }

    const files = {};
    for (const [field, kind] of [['invoice_file', 'invoice'], ['w9_file', 'w9']]) {
      const f = req.files?.[field]?.[0];
      if (f) files[kind] = await storeFile(req.labelId, f, kind);
    }
    // Receipts: the first one lives on the row's receipt_* columns; extras are
    // stored below (entity_files) once the row exists to attach them to.
    const receiptFiles = req.files?.receipt_file || [];
    if (receiptFiles[0]) files.receipt = await storeFile(req.labelId, receiptFiles[0], 'receipt');
    // Proof of payment → its OWN columns, never the receipt slot: on a
    // reimbursement receipt_r2_key holds the expense receipt being claimed, and
    // a proof landing there would displace the document that justifies the
    // claim. Auto-marks paid — but only approvers can mark paid on creation.
    const proofF = req.files?.proof_file?.[0];
    if (proofF) files.proof = await storeFile(req.labelId, proofF, 'proof');
    const status = canApprove ? (b.status || 'approved') : 'pending';
    // Only approvers may mark an entry paid on creation — via a proof upload OR
    // the "mark as paid" form toggle (payment_status). Non-approvers always
    // create Unpaid, no matter what the body claims.
    const proofPaid = !!proofF && canApprove;
    const wantStatus = canonicalPaymentStatus(b.payment_status);
    if (wantStatus === false) {
      return res.status(400).json({ success: false, error: `payment_status must be one of ${PAYMENT_STATUSES.join(', ')}` });
    }
    const togglePaid = canApprove && (wantStatus === 'Paid' || wantStatus === 'Partial');
    const paid = proofPaid || togglePaid;
    const paymentStatus = proofPaid ? 'Paid' : (togglePaid ? wantStatus : 'Unpaid');
    const paymentDate = paid ? (b.payment_date || new Date().toISOString().slice(0, 10)) : null;

    // Urgency at create (boom parity): rush = "expedite this", hold = "pause
    // this". Mutually exclusive, and dropped entirely when the row is born
    // Paid — there is nothing left to expedite or pause.
    const rushBool = b.urgency === 'rush' || b.rush_requested === true || b.rush_requested === 'true';
    const holdBool = b.urgency === 'hold' || b.on_hold === true || b.on_hold === 'true';
    if (rushBool && holdBool) {
      return res.status(400).json({ success: false, error: 'rush and hold are mutually exclusive — send only one' });
    }
    const rushOn = rushBool && !paid;
    const holdOn = holdBool && !paid;
    const urgencyReason = String(b.urgency_reason || b.rush_reason || b.hold_reason || '').trim().slice(0, 500) || null;

    // Terms → due date. Anchored to SUBMISSION (now), not invoice_date, so a
    // stale invoice still gets a fresh payment window from when it arrived. An
    // explicit scheduled_payment_date from the caller still wins.
    const terms = PAYMENT_TERMS.includes(b.payment_terms) ? b.payment_terms : 'Net 30';
    const dueDate = b.scheduled_payment_date || computeDueDate(new Date(), terms);

    // Bulk deal. An answered checklist owns the flag; quantity/unit are only
    // meaningful when it's on, so they're dropped when it's off rather than
    // left as orphan values a later toggle would resurrect.
    const bulkFlag = checklistAnswered ? checklistAnswered.bulk_deal : (b.is_bulk_deal === true || b.is_bulk_deal === 'true');
    const bulkQty = bulkFlag ? (parseInt(b.bulk_deal_quantity, 10) || null) : null;
    const bulkUnit = bulkFlag ? (String(b.bulk_deal_unit || '').trim().slice(0, 40) || null) : null;

    // Social handles → JSONB. Kept even without amounts (amount-ed ones ALSO
    // become split lines) — this is what the Flags page's missing_socials
    // check reads, so discarding them meant this page created its own flags.
    let socialHandles = null;
    try {
      const arr = typeof b.social_handles === 'string' ? JSON.parse(b.social_handles) : b.social_handles;
      if (Array.isArray(arr)) {
        const clean = arr
          .map(s => ({
            platform: String(s?.platform || '').trim() || null,
            handle: String(s?.handle || '').trim(),
            artist: String(s?.artist || '').trim() || null,
            amount: parseFloat(s?.amount) > 0 ? parseFloat(s.amount) : null,
          }))
          .filter(s => s.handle);
        if (clean.length) socialHandles = JSON.stringify(clean);
      }
    } catch { /* malformed socials — row stands without them */ }

    // Collapse registered multi-artist strings ("Ezra feat. Kendrick" → "Ezra")
    // before the row lands; unmapped names stay raw.
    const artist = await normalizeArtist(req.labelId, b.artist);

    const { rows } = await pool.query(
      `INSERT INTO expenses (
        label_id, invoice_date, payee, description, category, artist, song, invoice_number,
        amount, currency, payment_method, payment_date, status, payment_status,
        is_reimbursement, recoupable, rep, notes,
        vendor_name, vendor_email, vendor_address, vendor_bank,
        payment_ref, paid_by, paid_marked_at, payment_terms, scheduled_payment_date,
        rush, rush_reason, rush_needed_by, rush_by, rush_at,
        on_hold, hold_reason, hold_by, hold_at,
        is_bulk_deal, bulk_deal_quantity, bulk_deal_unit, social_handles,
        invoice_filename, invoice_r2_key, w9_filename, w9_r2_key, receipt_filename, receipt_r2_key,
        proof_filename, proof_r2_key,
        created_by, entry_source, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'USD'),$11,$12,
        COALESCE($13,'approved'),COALESCE($14,'Unpaid'),$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,
        $28,$29,$30,$31,$32,$33,$34,$35,$36,
        $37,$38,$39,$40::jsonb,
        $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,NOW()
      ) RETURNING *`,
      [
        req.labelId, b.invoice_date || null, b.payee, b.description || null, b.category || null,
        artist, b.song || null, b.invoice_number || null, b.amount, b.currency,
        b.payment_method || null, paymentDate, status, paymentStatus,
        b.is_reimbursement === 'true' || b.is_reimbursement === true,
        b.recoupable === undefined ? true : (b.recoupable === 'true' || b.recoupable === true),
        b.rep || null, b.notes || null,
        b.vendor_name || b.payee, b.vendor_email || null, b.vendor_address || null, b.vendor_bank || null,
        paid ? (b.payment_ref || null) : null, paid ? req.user.name : null, paid ? new Date() : null,
        terms, dueDate,
        rushOn, rushOn ? urgencyReason : null, rushOn ? (b.rush_needed_by || null) : null,
        rushOn ? req.user.name : null, rushOn ? new Date() : null,
        holdOn, holdOn ? urgencyReason : null, holdOn ? req.user.name : null, holdOn ? new Date() : null,
        bulkFlag, bulkQty, bulkUnit, socialHandles,
        files.invoice?.filename || null, files.invoice?.key || null,
        files.w9?.filename || null, files.w9?.key || null,
        files.receipt?.filename || null, files.receipt?.key || null,
        files.proof?.filename || null, files.proof?.key || null,
        req.user.name,
        ['expense', 'invoice', 'reimbursement', 'artist_campaigns'].includes(b.entry_source) ? b.entry_source : null,
      ]
    );
    // Extra receipts (2nd..nth) → entity_files, now that there's a row to own
    // them. Best-effort per file: one bad upload must not lose the entry.
    for (const f of receiptFiles.slice(1)) {
      try {
        const stored = await storeFile(req.labelId, f, 'receipt');
        await pool.query(
          `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, uploaded_by, file_size)
           VALUES ($1,'expense_receipt',$2,$3,$4,$5,$6,$7,$8)`,
          [req.labelId, rows[0].id, stored.key.split('/').pop(), f.originalname, f.mimetype, stored.key, req.user.id || null, f.size || null]
        );
      } catch (e) { console.error('Extra receipt store failed:', e.message); }
    }
    // Lock the FX rate if it was created already-paid (matches the pay flows).
    if (paid) stampFxRateAsync(rows[0].id);
    // Keep the vendor record current (contact + W9 if one was attached).
    await upsertVendor(pool, req.labelId, {
      name: b.vendor_name || b.payee,
      email: b.vendor_email, address: b.vendor_address, bank: b.vendor_bank,
      w9_r2_key: files.w9?.key || null, w9_filename: files.w9?.filename || null,
    }).catch(() => {});

    // ── The checklist, stored on the row it describes ─────────────────────
    // Only when the row was created APPROVED. A pending row's checklist belongs
    // to the approver who will see it in the queue, not to the submitter —
    // storing one here would let a submitter pre-answer their own approval.
    // Runs BEFORE the splits below so applyBreakdownSplits' children inherit the
    // DECIDED category / recoupable / cobrand, not the submitted ones.
    let checklistStored = false;
    if (checklistAnswered && rows[0].status === 'approved') {
      const stamped = stampChecklist(checklistAnswered, req.user);
      await writeApprovalChecklist(pool, req.labelId, rows[0].id, stamped);
      Object.assign(rows[0], {
        approval_checklist: stamped,
        is_bulk_deal: stamped.bulk_deal,
        cobrand: stamped.cobrand,
        recoupable: stamped.recoupable,
        artist_campaign: stamped.campaign,
        category: stamped.cobrand ? 'Marketing' : rows[0].category,
      });
      bkAudit(req, rows[0].id, 'approved', `created approved on Add Invoice · checklist ${JSON.stringify(stamped)}`);
      checklistStored = true;
    }

    // Multi-artist / social allocation → store it, and apply as splits NOW only
    // if this entry is already approved. Pending entries get split on approval.
    let splitParts = 0;
    try {
      const arr = JSON.parse(b.splits || '[]');
      if (Array.isArray(arr) && arr.length) {
        // Split lines get the same normalization pass as the top-level artist.
        for (const l of arr) if (l && l.artist) l.artist = await normalizeArtist(req.labelId, l.artist);
        await pool.query('UPDATE expenses SET artist_breakdown = $1::jsonb WHERE id = $2 AND label_id = $3', [JSON.stringify(arr), rows[0].id, req.labelId]);
        rows[0].artist_breakdown = arr;
        if (rows[0].status === 'approved') splitParts = await applyBreakdownSplits(req.labelId, rows[0], req.user.name);
        // Children born Paid need their own FX stamp (one per row, matching the
        // family-flip behavior in PATCH /entries/:id).
        if (paid && splitParts > 0) {
          const kids = await pool.query('SELECT id FROM expenses WHERE parent_id = $1 AND label_id = $2', [rows[0].id, req.labelId]);
          kids.rows.forEach(r => stampFxRateAsync(r.id));
        }
      }
    } catch { /* no/invalid split — single entry stands */ }

    await logActivity(req, status === 'approved' ? 'Added ledger entry' : 'Submitted invoice for approval', `${b.payee} — ${b.amount}`, { entryPayee: b.payee });
    res.status(201).json({ success: true, data: { ...rows[0], split_parts: splitParts, pending: status !== 'approved' }, checklist_stored: checklistStored });
  } catch (error) {
    console.error('Create ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// PATCH /api/ledger/entries/:id — update + record field-level history.
router.patch('/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const keys = Object.keys(req.body).filter(k => EDITABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    // A cleared amount field must not PATCH '' (which would coerce to 0).
    if (keys.includes('amount') && !(parseFloat(req.body.amount) > 0)) {
      return res.status(400).json({ success: false, error: 'Amount must be greater than zero' });
    }
    // Same rule as create, and it matters MORE here: an unvalidated
    // payment_status went straight into the UPDATE and was then cascaded to the
    // whole split family by the block below, so one lowercase 'paid' could put
    // a family into a state no query in the app can see.
    if (keys.includes('payment_status')) {
      const st = canonicalPaymentStatus(req.body.payment_status);
      if (!st) return res.status(400).json({ success: false, error: `payment_status must be one of ${PAYMENT_STATUSES.join(', ')}` });
      req.body.payment_status = st;
    }
    // social_handles is JSONB — node-postgres would send a JS array as a
    // Postgres ARRAY literal, so serialize it here.
    if (keys.includes('social_handles') && req.body.social_handles != null && typeof req.body.social_handles !== 'string') {
      req.body.social_handles = JSON.stringify(req.body.social_handles);
    }
    // A client-supplied release link must point inside this workspace.
    if (keys.includes('release_id') && req.body.release_id != null) {
      const rid = parseInt(req.body.release_id, 10);
      if (!Number.isFinite(rid)) return res.status(400).json({ success: false, error: 'Bad release_id' });
      const rel = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [rid, req.labelId]);
      if (!rel.rows.length) return res.status(400).json({ success: false, error: 'Release not found' });
      req.body.release_id = rid;
    }
    // Cobrand spend is Marketing by definition (boom rule, APR-7/LED-7): turning
    // cobrand ON forces the category. The client mirrors this locally.
    if (keys.includes('cobrand') && (req.body.cobrand === true || req.body.cobrand === 'true')) {
      req.body.category = 'Marketing';
      if (!keys.includes('category')) keys.push('category');
    }

    // Snapshot current values so we can diff for the audit trail.
    const before = await pool.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!before.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const prev = before.rows[0];

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    // UFR marking drives the recoupment statement month — stamp/clear the
    // timestamp whenever the flag itself flips (LED-6).
    if (keys.includes('ufr')) {
      const on = req.body.ufr === true || req.body.ufr === 'true';
      setClauses.push(on ? 'ufr_marked_at = COALESCE(ufr_marked_at, NOW())' : 'ufr_marked_at = NULL');
    }
    values.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE expenses SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );

    // Log each changed field (best-effort; never blocks the response).
    const norm = (v) => (v === null || v === undefined ? '' : String(v));
    for (const k of keys) {
      if (norm(prev[k]) !== norm(rows[0][k])) {
        pool.query(
          `INSERT INTO ledger_history (label_id, expense_id, field, old_value, new_value, changed_by, changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          [req.labelId, id, k, norm(prev[k]) || null, norm(rows[0][k]) || null, req.user.name]
        ).catch(() => {});
      }
    }

    // A manual payment_status change must move the WHOLE split family together.
    if (keys.includes('payment_status')) {
      const root = await familyRoot(pool, id, req.labelId);
      const st = rows[0].payment_status;
      if (st === 'Unpaid') {
        // Reverting to Unpaid clears every payment stamp across the family.
        await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
          payment_status: 'Unpaid', payment_date: null, paid_by: null, payment_ref: null, fx_rate_to_usd: null, paid_marked_at: null,
        });
      } else if (st === 'Paid') {
        await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
          payment_status: 'Paid',
          payment_date: rows[0].payment_date || new Date().toISOString().slice(0, 10),
          paid_by: rows[0].paid_by || req.user.name, paid_marked_at: new Date(),
        });
        const fam = await pool.query('SELECT id FROM expenses WHERE (id = $1 OR parent_id = $1) AND label_id = $2', [root, req.labelId]);
        fam.rows.forEach(r => stampFxRateAsync(r.id));  // one rate per family flip
      } else {
        await cascadePaymentFieldsToFamily(pool, root, req.labelId, { payment_status: st });
      }
    }

    // Comma/slash song → server-side auto-split (works for inline edits, the
    // edit modal, and raw API writes alike — boom did this in PUT).
    let splitParts = 0;
    if (keys.includes('song') && norm(prev.song) !== norm(rows[0].song)) {
      splitParts = await autoSplitOnSong(req.labelId, rows[0], req.user.name);
      if (splitParts) bkAudit(req, id, 'split', `auto-split into ${splitParts} songs on edit`);
    }
    // Artist/song edits retry the catalog link; surfaced in the client toast.
    let linkedRelease = null;
    if ((keys.includes('song') || keys.includes('artist')) && !rows[0].release_id && rows[0].artist && rows[0].song && !splitParts) {
      linkedRelease = await autoLinkRelease(req.labelId, id);
    }
    res.json({ success: true, data: rows[0], split_parts: splitParts || undefined, linked_release: linkedRelease || undefined });
  } catch (error) {
    console.error('Update ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/bulk — one field across many rows (boom's
// BULK_FIELDS whitelist). Amount / payment_status / status / payee are
// deliberately refused: money moves and approval state have their own routes
// with their own side effects. Returns previous:[{id,value}] as a one-action
// undo payload, and honest accounting (changed / already / skipped).
const BULK_FIELDS = {
  artist: 'text', song: 'text', category: 'text',
  payment_method: 'text', in_quickbooks: 'bool', recoupable: 'bool',
};
router.post('/entries/bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite))] : [];
    const field = String(req.body.field || '');
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    if (!BULK_FIELDS[field]) return res.status(400).json({ success: false, error: `Field not bulk-editable: ${field}` });
    let value = req.body.value;
    if (BULK_FIELDS[field] === 'bool') value = value === true || value === 'true';
    else value = value == null || value === '' ? null : String(value);
    // A comma in a bulk song would auto-split EVERY row — that stays a
    // deliberate per-row edit (boom rule).
    if (field === 'song' && value && /[,/]/.test(value)) {
      return res.status(400).json({ success: false, error: 'One song. A comma splits an entry per song, which stays a per-row edit.' });
    }
    // Rep-restricted Approvers can't bulk-write rows they can't see.
    const hidden = await findInvisibleEntry(req, ids);
    if (hidden) return res.status(403).json({ success: false, error: `Entry #${hidden.id} is outside your rep visibility` });

    const beforeQ = await pool.query(
      `SELECT id, ${field} AS value FROM expenses
        WHERE id = ANY($1::int[]) AND label_id = $2 AND (deleted = false OR deleted IS NULL)`,
      [ids, req.labelId]
    );
    const previous = beforeQ.rows.map(r => ({ id: r.id, value: r.value }));
    const norm = (v) => (v === null || v === undefined ? '' : String(v));
    const toChange = previous.filter(r => norm(r.value) !== norm(value)).map(r => r.id);
    const already = previous.length - toChange.length;
    const skipped = ids.length - previous.length; // deleted / out-of-tenant ids

    let relinked = 0;
    if (toChange.length) {
      await pool.query(
        `UPDATE expenses SET ${field} = $1 WHERE id = ANY($2::int[]) AND label_id = $3`,
        [value, toChange, req.labelId]
      );
      for (const cid of toChange) {
        pool.query(
          `INSERT INTO ledger_history (label_id, expense_id, field, old_value, new_value, changed_by, changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          [req.labelId, cid, field, norm(previous.find(r => r.id === cid)?.value) || null, norm(value) || null, req.user.name]
        ).catch(() => {});
      }
      if (field === 'artist' || field === 'song') {
        for (const cid of toChange) { if (await autoLinkRelease(req.labelId, cid)) relinked++; }
      }
      await logActivity(req, 'Bulk ledger edit', `${field} → "${norm(value)}" on ${toChange.length} entries`);
    }
    res.json({ success: true, data: { requested: ids.length, changed: toChange.length, already, skipped, relinked, previous } });
  } catch (error) {
    console.error('Bulk ledger edit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Settlement groups ("ONE PAYMENT · N INVOICES") ──────────────────────────
// Declares that a set of a vendor's invoices settles as one bank payment.
// Group id = the smallest member id. Ungrouping does NOT touch bank matches —
// the group is a declaration about payment intent, not a reconciliation.
router.post('/settlement-groups', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite))] : [];
    if (ids.length < 2) return res.status(400).json({ success: false, error: 'Select at least two invoices' });
    const { rows } = await pool.query(
      `SELECT id, payee, parent_id, settlement_group_id FROM expenses
        WHERE id = ANY($1::int[]) AND label_id = $2 AND (deleted = false OR deleted IS NULL)`,
      [ids, req.labelId]
    );
    if (rows.length !== ids.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    if (rows.some(r => r.parent_id)) return res.status(400).json({ success: false, error: 'Split slices settle with their family — group the parent rows' });
    const payees = new Set(rows.map(r => String(r.payee || '').trim().toLowerCase()));
    if (payees.size > 1) return res.status(400).json({ success: false, error: 'One payment settles one vendor — the selection spans several payees' });
    if (rows.some(r => r.settlement_group_id != null)) return res.status(409).json({ success: false, error: 'An invoice in the selection is already in a payment group — ungroup it first' });
    const gid = Math.min(...ids);
    await pool.query('UPDATE expenses SET settlement_group_id = $1 WHERE id = ANY($2::int[]) AND label_id = $3', [gid, ids, req.labelId]);
    bkAudit(req, gid, 'settlement-group', `grouped ${ids.length} invoices as one payment`);
    res.json({ success: true, data: { group_id: gid, size: ids.length } });
  } catch (error) {
    console.error('Settlement group error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/settlement-groups/:gid(\\d+)', async (req, res) => {
  try {
    const gid = parseInt(req.params.gid, 10);
    const { rowCount } = await pool.query(
      'UPDATE expenses SET settlement_group_id = NULL WHERE settlement_group_id = $1 AND label_id = $2',
      [gid, req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Group not found' });
    bkAudit(req, gid, 'settlement-ungroup', `ungrouped ${rowCount} invoices`);
    res.json({ success: true, data: { ungrouped: rowCount } });
  } catch (error) {
    console.error('Settlement ungroup error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


// ── Bulk Upload (boom /bk/bulk-upload port) ─────────────────────────────────
// POST /api/ledger/entries/batch — create N invoice entries in one multipart
// request. The page AI-parses files client-side via /parse-invoice +
// /parse-proof, auto-matches proofs, then submits its review grid here in
// chunks (≤ BATCH_MAX entries per request, ONE request at a time — the
// sequential chunking is what keeps a 40-file batch inside index.js's
// MAX_CONCURRENT_UPLOADS multipart guard). Body: `entries` = JSON array;
// documents ride in the `files` array field, each entry pointing at its own
// by PER-REQUEST index (invoice_file_index / proof_file_index).
//
// Divergences from boom's /bk/entries/batch (deliberate):
// - Rows are created status='pending' → the Approvals deck reviews them with
//   its checklist (RC-7: boom created them approved, but a cadence row born
//   approved needs a validated per-row checklist, and twenty checklists in a
//   grid is noise, not review). Proof-matched rows still land Paid — the
//   route sits behind requireApprover, the same population createEntry lets
//   mark paid at create.
// - Files upload BEFORE the INSERT (boom inserted, uploaded, then DELETEd the
//   row on upload failure). Same invariant — no ledger row whose invoice
//   can't be viewed — but the failure residue is an orphan R2 object (swept
//   by nothing, harmless) instead of a transient phantom ledger row; an
//   insert failure after upload still best-effort deletes the objects.
// - "One payment" letters are NOT resolved here: the client maps them onto
//   POST /ledger/settlement-groups with the created ids — one grouping
//   mechanism (settlement_group_id), not boom's parallel string column.
const BATCH_MAX = 20;
router.post('/entries/batch', upload.array('files', BATCH_MAX * 2), async (req, res) => {
  try {
    let entries = null;
    try { entries = JSON.parse(req.body.entries || ''); } catch { /* falls through to the 400 */ }
    if (!Array.isArray(entries) || !entries.length) {
      return res.status(400).json({ success: false, error: 'entries must be a non-empty JSON array' });
    }
    if (entries.length > BATCH_MAX) {
      return res.status(400).json({ success: false, error: `At most ${BATCH_MAX} entries per request — submit in chunks` });
    }
    const files = req.files || [];
    const fileAt = (i) => (Number.isInteger(i) && i >= 0 && i < files.length ? files[i] : null);
    const created = [];
    const failed = [];
    for (const e of entries) {
      // `ref` is the client's row id, echoed back so the page can map results
      // (and settlement letters) onto grid rows across chunked requests.
      const ref = e?.ref ?? null;
      const fail = (msg, filename) => failed.push({
        ref, payee: e?.payee || null,
        filename: filename || fileAt(e?.invoice_file_index)?.originalname || null,
        error: msg,
      });
      try {
        const payee = String(e?.payee || '').trim();
        const amount = Number(e?.amount);
        if (!payee || !Number.isFinite(amount) || amount <= 0) { fail('Payee and a positive amount are required'); continue; }
        // Dup gate — the same normalized-number, alias-aware lookup as the
        // single create. Per-row skippable: "Add anyway" sends force_duplicate.
        if (e.invoice_number && e.force_duplicate !== true) {
          const dup = await findDuplicateInvoice(req.labelId, { payee, invoice_number: e.invoice_number });
          if (dup) { fail(`Invoice #${e.invoice_number} looks like a duplicate of entry #${dup.id} — tick "Add anyway" to force it`); continue; }
        }
        const invF = fileAt(e.invoice_file_index);
        const proofF = fileAt(e.proof_file_index);
        // Files first: a storage failure (R2 down / unconfigured) means NO row.
        let inv = null; let proof = null;
        try {
          if (invF) inv = await storeFile(req.labelId, invF, 'invoice');
          if (proofF) proof = await storeFile(req.labelId, proofF, 'proof');
        } catch (upErr) {
          if (inv) deleteFile(inv.key).catch(() => {});
          fail(`File upload failed — ${upErr.message}`, (inv ? proofF : invF)?.originalname);
          continue;
        }
        const paid = e.payment_status === 'Paid';
        const paymentDate = paid ? (String(e.payment_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)) : null;
        const dueDate = e.scheduled_payment_date || computeDueDate(new Date(), 'Net 30');
        const artist = await normalizeArtist(req.labelId, e.artist);
        let row;
        try {
          const { rows } = await pool.query(
            `INSERT INTO expenses (
               label_id, invoice_date, payee, description, category, artist, song,
               invoice_number, amount, currency, payment_method,
               status, payment_status, payment_date, payment_ref, paid_by, paid_marked_at,
               payment_terms, scheduled_payment_date, recoupable, vendor_name,
               invoice_filename, invoice_r2_key, proof_filename, proof_r2_key,
               created_by, entry_source, created_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'USD'),$11,
               'pending',$12,$13,$14,$15,$16,
               'Net 30',$17,true,$3,
               $18,$19,$20,$21,
               $22,'bulk_upload',NOW()
             ) RETURNING id, payee, amount, currency, payment_status`,
            [
              req.labelId, e.invoice_date || null, payee, e.description || null, e.category || null,
              artist, e.song || null, e.invoice_number || null, amount, e.currency || null,
              e.payment_method || null,
              paid ? 'Paid' : 'Unpaid', paymentDate, paid ? (e.payment_ref || null) : null,
              paid ? req.user.name : null, paid ? new Date() : null,
              dueDate,
              inv?.filename || null, inv?.key || null, proof?.filename || null, proof?.key || null,
              req.user.name,
            ]
          );
          row = rows[0];
        } catch (insErr) {
          if (inv) deleteFile(inv.key).catch(() => {});
          if (proof) deleteFile(proof.key).catch(() => {});
          throw insErr;
        }
        // Same post-create passes as the single flow: FX lock on paid rows,
        // vendor record, catalog auto-link, audit trail.
        if (paid) stampFxRateAsync(row.id);
        upsertVendor(pool, req.labelId, { name: payee }).catch(() => {});
        if (artist && e.song) await autoLinkRelease(req.labelId, row.id);
        bkAudit(req, row.id, 'bulk-upload', `created pending via Bulk Upload${paid ? ' · proof matched, marked Paid' : ''}`);
        created.push({ ref, ...row });
      } catch (err) {
        console.error('Bulk upload entry error:', err);
        fail('Internal error — the entry was not created');
      }
    }
    if (created.length) {
      await logActivity(req, 'Bulk upload', `${created.length} invoice${created.length === 1 ? '' : 's'} added for approval`);
      activityBot.postEvent(req.labelId, {
        text: `📥 Bulk upload: *${created.length} invoice${created.length === 1 ? '' : 's'}* added to Approvals by ${req.user.name}`,
        icon: 'inbox', link: '/approvals',
      });
    }
    res.json({ success: true, data: created, count: created.length, failed, failedCount: failed.length });
  } catch (error) {
    console.error('Bulk upload batch error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/receipts — the extra receipts on a reimbursement
// (the first receipt lives on the row's receipt_* columns; 2nd..nth land in
// entity_files at create). Served through /uploads/:filename like every other
// entity file.
router.get('/entries/:id/receipts', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'Bad id' });
    const { rows } = await pool.query(
      `SELECT id, filename, original_name, file_size, created_at
         FROM entity_files
        WHERE label_id = $1 AND entity_type = 'expense_receipt' AND entity_id = $2
        ORDER BY id`,
      [req.labelId, id]
    );
    res.json({ success: true, data: rows.map(r => ({ ...r, url: `/uploads/${encodeURIComponent(r.filename)}` })) });
  } catch (error) {
    console.error('List receipts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/history — field-level change log for one entry.
router.get('/entries/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT field, old_value, new_value, changed_by, changed_at FROM ledger_history
       WHERE label_id = $1 AND expense_id = $2 ORDER BY changed_at DESC, id DESC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Ledger history error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Bookkeeping audit trail (best-effort; never blocks the response).
function bkAudit(req, expenseId, action, detail) {
  pool.query(
    `INSERT INTO bk_audit_log (label_id, expense_id, action, detail, actor) VALUES ($1,$2,$3,$4,$5)`,
    [req.labelId, expenseId || null, action, detail || null, req.user?.name || null]
  ).catch(() => {});
}

// Collapse an artist string through the label's normalization map (the same
// map the Flags page maintains) — "Ezra feat. Kendrick" → "Ezra" when an
// operator registered that mapping. Unmapped names come back unchanged.
async function normalizeArtist(labelId, name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  try {
    const { rows } = await pool.query(
      'SELECT base_artist FROM artist_normalization_map WHERE label_id = $1 AND LOWER(pattern) = LOWER($2) LIMIT 1',
      [labelId, raw]
    );
    return rows.length ? rows[0].base_artist : raw;
  } catch { return raw; }
}

// The alias-aware "is this the same vendor" SQL fragment, parameterized on the
// payee's placeholder. Matches payee or vendor_name directly, or through the
// vendor_aliases table in either direction — otherwise a DBA re-submission
// bypasses the dedup gate. `p` is e.g. '$2'.
const vendorMatchSql = (p) => `(
  LOWER(TRIM(e.payee)) = LOWER(TRIM(${p}))
  OR LOWER(TRIM(e.vendor_name)) = LOWER(TRIM(${p}))
  OR LOWER(TRIM(e.payee)) IN (
    SELECT LOWER(TRIM(va.alias))     FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.canonical)) = LOWER(TRIM(${p}))
    UNION
    SELECT LOWER(TRIM(va.canonical)) FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.alias))     = LOWER(TRIM(${p}))
  )
  OR LOWER(TRIM(e.vendor_name)) IN (
    SELECT LOWER(TRIM(va.alias))     FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.canonical)) = LOWER(TRIM(${p}))
    UNION
    SELECT LOWER(TRIM(va.canonical)) FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.alias))     = LOWER(TRIM(${p}))
  )
)`;

// ── The duplicate answers with the INVOICE, not whichever row matched ───────
// A split invoice is a family — the parent keeps its share in e.amount, the
// rest live on children, and EVERY row carries the same invoice number. So the
// lookup resolves through COALESCE(parent_id, id) to the family root and
// reports what the family is WORTH (the same family_amount shape the list
// endpoints use), never one child's slice.
const DUP_FAMILY_SELECT = `
  SELECT r.id, r.payee, r.invoice_number, r.invoice_date, r.currency, r.payment_status, r.status,
         e.invoice_number AS matched_invoice_number,
         (r.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
             WHERE c.parent_id = r.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS amount,
         (SELECT COUNT(*)::int FROM expenses c
             WHERE c.parent_id = r.id AND (c.deleted = false OR c.deleted IS NULL)) AS child_rows
    FROM expenses e
    JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)`;

// Shared duplicate-invoice lookup: same NORMALIZED invoice number ("INV-38468"
// vs "38468", "#003" vs "003") for the same vendor identity — payee OR
// vendor_email, alias-aware. Used by createEntry's 409 gate; check-dup uses
// the same shapes for its live warning. Returns the family-root invoice or null.
async function findDuplicateInvoice(labelId, { payee, vendor_email, invoice_number }) {
  const key = normInv(invoice_number);
  if (!key) return null;
  const params = [labelId];
  const orParts = [];
  if (payee && String(payee).trim()) {
    params.push(String(payee).trim());
    orParts.push(vendorMatchSql(`$${params.length}`));
  }
  if (vendor_email && String(vendor_email).trim()) {
    params.push(String(vendor_email).trim());
    orParts.push(`LOWER(e.vendor_email) = LOWER($${params.length})`);
  }
  if (!orParts.length) return null;
  const { rows } = await pool.query(
    `${DUP_FAMILY_SELECT}
      WHERE e.label_id = $1 AND (${orParts.join(' OR ')})
        AND e.invoice_number IS NOT NULL AND e.invoice_number <> ''
        AND (e.deleted = false OR e.deleted IS NULL)
        AND (r.deleted = false OR r.deleted IS NULL)
        AND e.status <> 'rejected'`,
    params
  );
  // Compare on the number of the row that MATCHED (children carry the parent's
  // number, so either resolves to the same root).
  const hit = rows.find(r => normInv(r.matched_invoice_number) === key);
  if (!hit) return null;
  const { matched_invoice_number, ...invoice } = hit;
  return invoice;
}

// Expand a vendor allocation (artist_breakdown) into concrete child lines.
// Each artist line becomes one child; socials WITH amounts become their own
// child lines (honoring the vendor's per-social allocation), with any
// unallocated remainder kept as the artist's own line so children always
// reconcile to the artist amount (and thus the invoice total). Socials without
// amounts are folded into the artist line's notes.
function breakdownChildLines(bd) {
  const out = [];
  for (const line of (Array.isArray(bd) ? bd : [])) {
    const lineAmt = parseFloat(line.amount) || 0;
    // Per-line overrides from the line-item editor (boom's parse-lines flow):
    // a slice may carry its own category/description/recoupable; null means
    // "inherit from the parent" (COALESCE at insert time).
    const extra = {
      category: String(line.category || '').trim() || null,
      description: String(line.description || '').trim() || null,
      recoupable: (line.recoupable === undefined || line.recoupable === null) ? null : !!line.recoupable,
    };
    const socials = Array.isArray(line.socials) ? line.socials.filter(s => s && s.handle) : [];
    const withAmt = socials.filter(s => (parseFloat(s.amount) || 0) > 0);
    const socialSum = withAmt.reduce((a, s) => a + (parseFloat(s.amount) || 0), 0);
    if (withAmt.length && socialSum > 0) {
      for (const s of withAmt) out.push({ ...extra, artist: line.artist, song: line.song, amount: parseFloat(s.amount), social: s.handle });
      const remainder = Math.round((lineAmt - socialSum) * 100) / 100;
      if (remainder > 0.01) out.push({ ...extra, artist: line.artist, song: line.song, amount: remainder, socialsNote: socials.filter(x => !(parseFloat(x.amount) > 0)).map(x => x.handle) });
    } else if (lineAmt > 0) {
      out.push({ ...extra, artist: line.artist, song: line.song, amount: lineAmt, socialsNote: socials.map(s => s.handle) });
    }
  }
  return out;
}

// Turn a vendor allocation into real ledger child splits on approval. No-op when
// it resolves to <2 lines, there's no breakdown, or the parent is already split.
//
// The PARENT TAKES THE FIRST SLICE, matching POST /entries/:id/split. That is the
// model the rest of the app assumes — `family_amount` is computed as
// `e.amount + SUM(children)` and the /payables comment spells it out as
// "parent slice + children".
//
// This function used to leave the parent's amount untouched while creating children
// that summed to the FULL invoice, so a $900 split reported family_amount = $1800 on
// the Payments page, and unsplit restored $1800 too (its legacy fallback is also
// `parent.amount + SUM(kids)`). No production data hit it — there were no split
// families yet — but the first split on the Add Invoice page would have.
async function applyBreakdownSplits(labelId, parent, actorName) {
  if (parent.parent_id) return 0;
  const children = breakdownChildLines(parent.artist_breakdown);
  if (children.length < 2) return 0;
  const existing = await pool.query('SELECT 1 FROM expenses WHERE parent_id = $1 LIMIT 1', [parent.id]);
  if (existing.rows.length) return 0; // already split
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const [head, ...rest] = children;
    // Per-slice note tag, shared by the parent slice and the children.
    const tagFor = (c) => (c.social ? `Social: ${c.social}` : (c.socialsNote && c.socialsNote.length ? `Socials: ${c.socialsNote.join(', ')}` : ''));

    // Snapshot the pre-split parent so DELETE /entries/:id/splits restores it
    // exactly instead of falling back to summing live rows.
    const snapshot = { origin: { amount: Number(parent.amount), artist: parent.artist || null, song: parent.song || null }, splits: children };

    // Parent takes slice 1. Category is deliberately NOT flipped to 'Marketing' for
    // a social head line the way a child would be — the container keeps the
    // invoice's own category; the social is recorded in notes instead. A per-line
    // category/description/recoupable from the line-item editor DOES apply.
    const headTag = tagFor(head);
    await client.query(
      `UPDATE expenses SET amount = $1, artist = COALESCE($2, artist), song = $3, notes = $4, artist_breakdown = $5::jsonb,
              category = COALESCE($8, category), description = COALESCE($9, description), recoupable = COALESCE($10, recoupable)
         WHERE id = $6 AND label_id = $7`,
      [head.amount, head.artist || null, (head.song || parent.song) || null,
       [parent.notes, headTag].filter(Boolean).join(' · ') || null,
       JSON.stringify(snapshot), parent.id, labelId,
       head.social ? null : (head.category || null), head.description || null,
       head.recoupable === undefined || head.recoupable === null ? null : head.recoupable]
    );

    // Children inherit the parent's vendor identity, payment state and terms —
    // a child that loses vendor_email drops out of the dup gate and the
    // confirmation emails, and one that loses payment_date/terms disagrees
    // with its own family on the Payments views.
    for (const c of rest) {
      const notes = [parent.notes, tagFor(c)].filter(Boolean).join(' · ') || null;
      await client.query(
        `INSERT INTO expenses (label_id, parent_id, invoice_date, payee, description, category, artist, song,
           invoice_number, amount, currency, payment_method, status, payment_status, is_reimbursement, recoupable, rep, notes,
           vendor_name, vendor_email, vendor_address, vendor_bank,
           payment_date, paid_by, paid_marked_at, payment_terms, scheduled_payment_date, payment_ref,
           cobrand, artist_campaign, rush, rush_reason, on_hold, hold_reason, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'approved',$13,$14,$15,$16,$17,
           $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW())`,
        [labelId, parent.id, parent.invoice_date, parent.payee,
         c.description || parent.description,
         c.social ? 'Marketing' : (c.category || parent.category),
         c.artist || parent.artist, (c.song || parent.song) || null, parent.invoice_number, c.amount, parent.currency,
         parent.payment_method, parent.payment_status || 'Unpaid', parent.is_reimbursement,
         (c.recoupable === undefined || c.recoupable === null) ? parent.recoupable : c.recoupable,
         parent.rep, notes,
         parent.vendor_name || null, parent.vendor_email || null, parent.vendor_address || null, parent.vendor_bank || null,
         parent.payment_date || null, parent.paid_by || null, parent.paid_marked_at || null,
         parent.payment_terms || null, parent.scheduled_payment_date || null, parent.payment_ref || null,
         parent.cobrand || false, parent.artist_campaign ?? null,
         parent.rush || false, parent.rush_reason || null, parent.on_hold || false, parent.hold_reason || null,
         actorName]
      );
    }
    await client.query('COMMIT');
    // Total slices in the family (parent + children) — callers report this as
    // "split across N lines", so it must not be just the inserted-child count.
    return children.length;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Auto-split on approve failed:', e.message);
    return 0;
  } finally { client.release(); }
}

// POST /api/ledger/entries/:id/approve
// Body: { checklist, notify?, notes?, artist_breakdown? }
//   notes — a rider appended at approve time (kept alongside, never replacing).
//   artist_breakdown — the reviewer's corrected split; replaces the vendor's.
//   notify — emails are OPT-IN (boom parity): only an explicit true auto-sends;
//   the Approvals page always sends notify:false and previews via
//   EmailPreviewModal instead.
router.post('/entries/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Rep-visibility backstop: the queue GET filters what a rep-restricted
    // Approver sees; this stops the same Approver approving a hidden entry by
    // direct API call.
    if (!(await canActOnEntry(req, id))) {
      return res.status(403).json({ success: false, error: 'You do not have visibility into this entry' });
    }
    // THE GATE — after authorization, before every write below. Approving is an
    // attestation, not a status flip: the eight-question checklist must arrive
    // complete or nothing changes. A 400 here leaves the invoice exactly as it
    // was. (Boom parity: validateApprovalChecklist in bookkeeping.js.)
    const check = validateApprovalChecklist(req.body.checklist);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    const stamped = stampChecklist(check.value, req.user);

    // ── Reviewer-corrected split (split-before-approve) ────────────────────
    // An explicit artist_breakdown in the payload REPLACES the vendor's stored
    // allocation. Guards run before any write:
    //   · slices must be positive and there must be ≥2 (one slice = no split)
    //   · an existing child carrying its own file refuses the replace — that
    //     file's row would be deleted below and the key orphaned (boom's
    //     receipt-child guard).
    let overrideBreakdown = null;
    if (Array.isArray(req.body.artist_breakdown) && req.body.artist_breakdown.length > 1) {
      overrideBreakdown = req.body.artist_breakdown
        .map(s => ({
          artist: String(s.artist || '').trim(), song: String(s.song || '').trim() || null,
          amount: parseFloat(s.amount) || 0,
          socials: Array.isArray(s.socials) ? s.socials : undefined,
        }))
        .filter(s => s.amount > 0);
      if (overrideBreakdown.length < 2) overrideBreakdown = null;
    }
    if (overrideBreakdown) {
      const { rows: fileKids } = await pool.query(
        `SELECT 1 FROM expenses WHERE parent_id = $1 AND label_id = $2
           AND (invoice_r2_key IS NOT NULL OR receipt_r2_key IS NOT NULL OR w9_r2_key IS NOT NULL OR proof_r2_key IS NOT NULL) LIMIT 1`,
        [id, req.labelId]
      );
      if (fileKids.length) {
        return res.status(409).json({ success: false, error: 'A split child has its own file attached — approving with a new split would orphan it. Unsplit first.' });
      }
      await pool.query('DELETE FROM expenses WHERE parent_id = $1 AND label_id = $2', [id, req.labelId]);
      await pool.query('UPDATE expenses SET artist_breakdown = $1::jsonb WHERE id = $2 AND label_id = $3',
        [JSON.stringify(overrideBreakdown), id, req.labelId]);
    }

    // The checklist's answers land FIRST (cobrand ⇒ category='Marketing',
    // recoupable, artist_campaign, is_bulk_deal) so the RETURNING row below —
    // which feeds applyBreakdownSplits' child inheritance — already carries the
    // decided values instead of the submitted ones.
    await writeApprovalChecklist(pool, req.labelId, id, stamped);

    const notesRider = String(req.body.notes || '').trim();
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = NOW(),
         notes = CASE WHEN $4 = '' THEN notes WHEN notes IS NULL THEN $4 ELSE notes || ' | ' || $4 END
       WHERE id = $2 AND label_id = $3 RETURNING *`,
      [req.user.name, id, req.labelId, notesRider]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    await logActivity(req, 'Approved ledger entry', `${rows[0].payee} — ${rows[0].amount}`, { entryPayee: rows[0].payee });
    bkAudit(req, rows[0].id, 'approved', `${rows[0].payee} — ${rows[0].currency} ${rows[0].amount} · checklist ${JSON.stringify(stamped)}`);
    const parts = await applyBreakdownSplits(req.labelId, rows[0], req.user.name);
    if (parts) { await logActivity(req, 'Applied vendor split on approve', `${rows[0].payee} → ${parts} artists`); bkAudit(req, rows[0].id, 'split', `auto-split into ${parts} artists on approve`); }
    // Cascade approval to any pre-existing pending children (they are hidden
    // from the queue, so leaving them pending orphans them).
    await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = NOW()
        WHERE parent_id = $2 AND label_id = $3 AND status = 'pending' AND (deleted = false OR deleted IS NULL)`,
      [req.user.name, id, req.labelId]
    );
    // Auto-link to the catalog by artist + song (best-effort, non-blocking).
    if (rows[0].artist && rows[0].song) {
      pool.query(
        `UPDATE expenses e SET release_id = r.id
           FROM releases r JOIN artists a ON a.id = r.artist_id
          WHERE e.id = $1 AND e.label_id = $2 AND e.release_id IS NULL
            AND r.label_id = e.label_id
            AND LOWER(TRIM(r.project_name)) = LOWER(TRIM(e.song))
            AND LOWER(TRIM(a.name)) = LOWER(TRIM(e.artist))`,
        [id, req.labelId]
      ).catch(() => {});
    }
    if (req.body.notify === true && rows[0].vendor_submitted) notifyVendor(req.labelId, rows[0], 'approved');
    activityBot.postEvent(req.labelId, {
      text: `✅ Invoice approved: *${rows[0].payee}* · ${money(rows[0].amount, rows[0].currency)} — by ${req.user.name}`,
      icon: 'check', link: '/ledger',
    });
    res.json({ success: true, data: { ...rows[0], split_parts: parts } });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/reject — reason required. Emails are OPT-IN
// (notify:true); the Approvals page previews via EmailPreviewModal instead.
// The reason lands in BOTH rejected_reason (the queryable column) and the
// notes trail (' | Rejected: …') so it survives a later restore; the rejecter
// stamps rejected_by/rejected_at, never approved_by (that would claim the
// opposite of what happened).
router.post('/entries/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await canActOnEntry(req, id))) {
      return res.status(403).json({ success: false, error: 'You do not have visibility into this entry' });
    }
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, error: 'A rejection reason is required' });
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'rejected', rejected_reason = $1, rejected_by = $2, rejected_at = NOW(),
         notes = CASE WHEN notes IS NULL THEN 'Rejected: ' || $1 ELSE notes || ' | Rejected: ' || $1 END
       WHERE id = $3 AND label_id = $4 RETURNING *`,
      [reason, req.user.name, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    // Cascade to pending children — they are hidden from the queue, so leaving
    // them pending would orphan them invisibly.
    await pool.query(
      `UPDATE expenses SET status = 'rejected', rejected_by = $1, rejected_at = NOW()
        WHERE parent_id = $2 AND label_id = $3 AND status = 'pending' AND (deleted = false OR deleted IS NULL)`,
      [req.user.name, id, req.labelId]
    );
    await logActivity(req, 'Rejected ledger entry', rows[0].payee, { entryPayee: rows[0].payee });
    bkAudit(req, rows[0].id, 'rejected', reason);
    if (req.body.notify === true && rows[0].vendor_submitted) notifyVendor(req.labelId, rows[0], 'rejected', { reason });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Reject error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── W9 reviews — the SECOND review on Approvals ────────────────────────────
// One card per W9 DOCUMENT, not per invoice: the answer is written onto the
// entry that HOLDS the file (alias-aware most-recent, the same resolution as
// the queue's w9_entry_id), so reviewing once covers every pending invoice
// from that vendor. A NEW upload is a new entry and comes back unreviewed.
// The answer is recorded — it does NOT gate approval: an approver blocked by
// a document problem the VENDOR must fix is an approver who clicks "yes" to
// get unblocked.
router.get('/w9-reviews', async (req, res) => {
  try {
    const { rows: pending } = await pool.query(
      `SELECT e.id, e.payee, e.amount, e.currency, e.invoice_number, e.invoice_date, e.rep,
         (SELECT x.id FROM expenses x
           WHERE x.label_id = e.label_id AND x.w9_r2_key IS NOT NULL
             AND (x.deleted = false OR x.deleted IS NULL) AND x.status <> 'rejected'
             AND (
               LOWER(TRIM(x.payee)) = LOWER(TRIM(e.payee))
               OR LOWER(TRIM(x.payee)) IN (
                 SELECT LOWER(TRIM(va.alias))     FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.canonical)) = LOWER(TRIM(e.payee))
                 UNION
                 SELECT LOWER(TRIM(va.canonical)) FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.alias))     = LOWER(TRIM(e.payee))
               )
             )
           ORDER BY x.id DESC LIMIT 1) AS w9_entry_id
         FROM expenses e
        WHERE e.label_id = $1 AND e.status = 'pending'
          AND (e.deleted = false OR e.deleted IS NULL) AND e.parent_id IS NULL
        ORDER BY e.id DESC`,
      [req.labelId]
    );
    // Group the pending invoices under the document that covers them.
    const ownerIds = [...new Set(pending.map(p => p.w9_entry_id).filter(Boolean))];
    const owners = ownerIds.length
      ? (await pool.query(
          `SELECT id, payee, w9_filename, w9_r2_key, w9_scan, w9_review FROM expenses WHERE label_id = $1 AND id = ANY($2::int[])`,
          [req.labelId, ownerIds]
        )).rows
      : [];
    const ownerById = new Map(owners.map(o => [o.id, { ...o, invoices: [] }]));
    const noW9 = [];
    for (const inv of pending) {
      const owner = inv.w9_entry_id ? ownerById.get(inv.w9_entry_id) : null;
      if (!owner) { noW9.push(inv); continue; }
      owner.invoices.push({ id: inv.id, payee: inv.payee, amount: inv.amount, currency: inv.currency, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date });
    }
    const cards = [...ownerById.values()].filter(o => o.invoices.length).map(o => {
      const scan = o.w9_scan || null;
      return {
        entry_id: o.id,
        payee: o.payee,
        w9_filename: o.w9_filename,
        // What the AI already read. The deck PRE-FILLS the answer from this
        // and records whether the reviewer kept it — see POST below.
        scan: scan ? {
          signed: scan.w9_signed === true,
          dated: scan.w9_dated === true,
          form_type: scan.form_type || null,
          name: scan.w9_name || null,
          discrepancies: Array.isArray(scan.discrepancies) ? scan.discrepancies : [],
        } : null,
        review: o.w9_review || null,
        invoices: o.invoices,
      };
    });
    res.json({
      success: true,
      data: {
        // Only unreviewed documents are work; reviewed ones return for the count.
        queue: cards.filter(c => !c.review),
        reviewed: cards.filter(c => c.review),
        // Vendors with NO W9 anywhere — a vendor problem, surfaced rather than
        // silently counted as reviewed.
        no_w9: noW9,
      },
    });
  } catch (error) {
    console.error('W9 reviews error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/w9-reviews/:id — record the answer on the document's entry.
router.post('/w9-reviews/:id(\\d+)', async (req, res) => {
  try {
    const { signed_and_dated, prefilled, accepted_prefill } = req.body || {};
    if (typeof signed_and_dated !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Answer yes or no — leaving it blank is what makes "no" and "nobody looked" the same thing.' });
    }
    const { rows: [target] } = await pool.query(
      'SELECT id, payee, w9_scan FROM expenses WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!target) return res.status(404).json({ success: false, error: 'Entry not found' });
    const scan = target.w9_scan || null;
    const review = {
      signed_and_dated,
      // Whether the reviewer ACCEPTED the pre-filled answer or changed it —
      // "confirmed what the scan said" and "looked and decided" are different
      // claims, and a tax attestation should be able to tell them apart.
      prefilled: prefilled === true,
      accepted_prefill: prefilled === true && accepted_prefill === true,
      scan_said: scan ? { signed: scan.w9_signed === true, dated: scan.w9_dated === true, form_type: scan.form_type || null } : null,
      by: req.user?.name || null,
      at: new Date().toISOString(),
    };
    await pool.query('UPDATE expenses SET w9_review = $1 WHERE id = $2 AND label_id = $3',
      [JSON.stringify(review), target.id, req.labelId]);
    bkAudit(req, target.id, 'w9_review', `signed and dated = ${signed_and_dated ? 'yes' : 'no'}${review.prefilled ? (review.accepted_prefill ? ' (accepted pre-fill)' : ' (changed pre-fill)') : ''}`);
    res.json({ success: true, data: { entry_id: target.id, review } });
  } catch (error) {
    console.error('W9 review write error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/flag { flagged, flag_reason? } — per-expense
// flag-for-review chip. flagged=false clears everything including the reason.
router.post('/entries/:id/flag', async (req, res) => {
  try {
    const flagged = !!req.body?.flagged;
    const reasonRaw = req.body?.flag_reason;
    const reason = reasonRaw == null ? null : String(reasonRaw).slice(0, 500).trim() || null;
    const { rows } = await pool.query(
      `UPDATE expenses
          SET flagged = $1::bool,
              flagged_at = CASE WHEN $1::bool THEN NOW() ELSE NULL END,
              flagged_by = CASE WHEN $1::bool THEN $2::text ELSE NULL END,
              flag_reason = CASE WHEN $1::bool THEN $3::text ELSE NULL END
        WHERE id = $4 AND label_id = $5
        RETURNING id, flagged, flagged_at, flagged_by, flag_reason`,
      [flagged, req.user.name, reason, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    bkAudit(req, rows[0].id, flagged ? 'flagged' : 'unflagged', reason ? reason.slice(0, 120) : null);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Flag error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/bk-audit — bookkeeping audit trail for one entry.
router.get('/entries/:id/bk-audit', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT action, detail, actor, created_at FROM bk_audit_log
        WHERE label_id = $1 AND expense_id = $2 ORDER BY created_at DESC, id DESC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('bk-audit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/mark-paid
router.post('/entries/:id/mark-paid', async (req, res) => {
  try {
    // Split-family cascade: paying any row in a split family pays the whole
    // family in one transactional write (never a half-paid family).
    const { rows } = await pool.query(
      `UPDATE expenses SET payment_status = 'Paid', payment_date = COALESCE($1, CURRENT_DATE),
         payment_method = COALESCE($2, payment_method), payment_ref = COALESCE($3, payment_ref),
         paid_by = $4,
         -- Edge-only: re-marking an already-Paid row must not move its
         -- paid_marked_at (that timestamp anchors the linger window + audits).
         paid_marked_at = CASE WHEN payment_status = 'Paid' THEN paid_marked_at ELSE NOW() END,
         -- A paid row has nothing left to expedite or pause (boom parity) —
         -- stale RUSH/HOLD badges otherwise follow the row onto the ledger.
         rush = false, rush_reason = NULL, rush_needed_by = NULL, rush_by = NULL, rush_at = NULL,
         on_hold = false, hold_reason = NULL, hold_by = NULL, hold_at = NULL
       WHERE label_id = $6 AND status = 'approved'
         AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $5 AND label_id = $6)
       RETURNING *`,
      [req.body.payment_date || null, req.body.payment_method || null, req.body.payment_ref || null,
       req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found or not approved' });
    rows.forEach(r => stampFxRateAsync(r.id));
    const head = rows.find(r => String(r.id) === req.params.id) || rows[0];
    await logActivity(req, 'Marked paid', `${head.payee} — ${head.amount}${rows.length > 1 ? ` (+${rows.length - 1} in family)` : ''}`, { entryPayee: head.payee });
    // Family total, never the head's slice — a split invoice's vendor billed ONE
    // number and the auto-notification must state that number (DEF-PAY-02).
    const famTotal = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
    if (head.vendor_email) notifyVendor(req.labelId, { ...head, amount: famTotal }, 'paid', { method: head.payment_method, date: head.payment_date });
    res.json({ success: true, data: head });
  } catch (error) {
    console.error('Mark paid error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Payments / scheduling ───────────────────────────────────────────────

// GET /api/ledger/payables — approved & unpaid (the payment queue). Sorted by
// scheduled (due) date so the most urgent rises to the top.
router.get('/payables', async (req, res) => {
  try {
    const params = [req.labelId];
    // Only family HEADS (parent_id IS NULL). Split families collapse into their
    // parent row here; `family_amount` sums the whole family (parent slice +
    // children) since paying any member pays them all (item 1 cascade).
    // Recently-paid rows linger here for PAID_GRACE_DAYS instead of vanishing the
    // moment they're paid, so you can see what you just did (and undo a mistake)
    // before it drops to the ledger.
    //
    // COALESCE because paid_marked_at is NULL on rows created already-paid, on
    // imports, on split children and on artist-campaign writes — keying on it alone
    // would silently hide those. payment_date is the fallback rather than the
    // primary because it's user-editable and can be backdated.
    // Rows born on statements / recoupments / campaigns are records of money
    // that ALREADY left the account — boom measured 90% of its queue as
    // statement-born noise before excluding them. creator_payment rows have
    // their own directory.
    let where = `e.label_id = $1 AND e.status = 'approved'
       AND (
         e.payment_status IN ('Unpaid', 'Partial')
         OR (e.payment_status = 'Paid'
             AND COALESCE(e.paid_marked_at, e.payment_date::timestamp, e.created_at) >= NOW() - INTERVAL '${PAID_GRACE_DAYS} days')
       )
       AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
       AND e.parent_id IS NULL
       AND (e.entry_source IS NULL OR e.entry_source NOT IN ('creator_payment', 'bank_statement', 'recoupments', 'artist_campaigns'))`;
    const reps = await visibleReps(req);
    if (reps) { params.push(reps); where += ` AND (e.rep = ANY($${params.length}) OR e.rep IS NULL)`; }
    // Bank-evidence columns feed the per-row dot (verified / unverified);
    // installment sums feed the "paid/total" partial-payment progress line.
    const accounts = await bankEvidence.loadAccounts(pool, req.labelId).catch(() => []);
    const { rows } = await pool.query(
      `SELECT e.*,
         (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)) AS split_count,
         (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount,
         (SELECT COALESCE(SUM(pi.amount), 0) FROM payment_installments pi
           WHERE pi.label_id = e.label_id AND pi.expense_id IN (SELECT x.id FROM expenses x WHERE x.id = e.id OR x.parent_id = e.id)) AS inst_paid,
         (SELECT COUNT(*)::int FROM payment_installments pi
           WHERE pi.label_id = e.label_id AND pi.expense_id IN (SELECT x.id FROM expenses x WHERE x.id = e.id OR x.parent_id = e.id)) AS inst_count,
         ${bankEvidence.bankEvidenceCols('e', accounts)}
       FROM expenses e WHERE ${where}
       ORDER BY (e.payment_status = 'Paid'), e.scheduled_payment_date ASC NULLS LAST, e.invoice_date ASC NULLS LAST, e.id ASC`,
      params
    );
    // ≈USD per row (family total) — locked rate wins, else live conversion.
    for (const r of rows) {
      if ((r.currency || 'USD') === 'USD') continue;
      const fam = Number(r.family_amount ?? r.amount ?? 0);
      const u = r.fx_rate_to_usd ? fam / Number(r.fx_rate_to_usd) : await toUSD(fam, r.currency, r.payment_date || r.invoice_date);
      if (Number.isFinite(u)) r.usd_equiv = Math.round(u * 100) / 100;
    }
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Payables error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/schedule — set terms and/or a due date. If only
// terms are given, the due date is derived from the invoice date.
router.post('/entries/:id/schedule', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { payment_terms } = req.body;
    let scheduled = req.body.scheduled_payment_date || null;

    if (!scheduled && payment_terms) {
      const { rows: e } = await pool.query('SELECT invoice_date FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
      if (e.length) scheduled = computeDueDate(e[0].invoice_date, payment_terms);
    }

    const { rows } = await pool.query(
      `UPDATE expenses SET
         payment_terms = COALESCE($1, payment_terms),
         scheduled_payment_date = COALESCE($2, scheduled_payment_date)
       WHERE id = $3 AND label_id = $4 RETURNING *`,
      [payment_terms || null, scheduled, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Schedule error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/batch-pay — mark many approved entries paid in one go.
// Multipart-tolerant: ONE wire confirmation routinely covers a whole batch, so
// an attached `proof` file is stored once and linked onto every selected head
// row (boom's proof-to-all). `ids` arrives as an array (JSON) or a JSON string
// (multipart).
router.post('/batch-pay', upload.single('proof'), async (req, res) => {
  try {
    let rawIds = req.body.ids;
    if (typeof rawIds === 'string') { try { rawIds = JSON.parse(rawIds); } catch { rawIds = []; } }
    const ids = Array.isArray(rawIds) ? rawIds.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });

    // Expand each selected id to its whole split family, then pay all in one go.
    // paid_marked_at edge-only + rush/hold cleared — same rules as mark-paid.
    const { rows } = await pool.query(
      `UPDATE expenses SET payment_status = 'Paid',
         payment_date = COALESCE($1, CURRENT_DATE),
         payment_method = COALESCE($2, payment_method),
         payment_ref = COALESCE($6, payment_ref),
         paid_by = $3,
         paid_marked_at = CASE WHEN payment_status = 'Paid' THEN paid_marked_at ELSE NOW() END,
         rush = false, rush_reason = NULL, rush_needed_by = NULL, rush_by = NULL, rush_at = NULL,
         on_hold = false, hold_reason = NULL, hold_by = NULL, hold_at = NULL
       WHERE label_id = $4 AND status = 'approved' AND payment_status IN ('Unpaid','Partial')
         AND COALESCE(parent_id, id) IN (SELECT COALESCE(parent_id, id) FROM expenses WHERE label_id = $4 AND id = ANY($5::int[]))
       RETURNING id, parent_id`,
      [req.body.payment_date || null, req.body.payment_method || null, req.user.name, req.labelId, ids,
       String(req.body.payment_ref || '').trim() || null]
    );
    // One proof for the whole batch → stored once, linked on each family head.
    if (req.file && rows.length) {
      const proof = await storeFile(req.labelId, req.file, 'proof');
      const headIds = rows.filter(r => !r.parent_id).map(r => r.id);
      if (headIds.length) {
        await pool.query(
          'UPDATE expenses SET proof_r2_key = $1, proof_filename = $2 WHERE label_id = $3 AND id = ANY($4::int[])',
          [proof.key, proof.filename, req.labelId, headIds]
        );
      }
    }
    rows.forEach(r => stampFxRateAsync(r.id));
    await logActivity(req, 'Batch paid', `${rows.length} entries`);
    res.json({ success: true, data: { paid: rows.length } });
  } catch (error) {
    console.error('Batch pay error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const PROOF_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { payment_date: { type: ['string', 'null'] }, reference: { type: ['string', 'null'] }, method: { type: ['string', 'null'] } },
  required: ['payment_date', 'reference', 'method'],
};

// POST /api/ledger/entries/:id/pay-with-proof — upload a proof-of-payment; AI
// extracts date/ref (fails open), the file is kept as an installment, and the
// whole split family is marked Paid.
router.post('/entries/:id/pay-with-proof', upload.single('proof'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exp = await pool.query('SELECT amount, currency FROM expenses WHERE id = $1 AND label_id = $2 AND status = $3', [id, req.labelId, 'approved']);
    if (!exp.rows.length) return res.status(404).json({ success: false, error: 'Approved entry not found' });

    let date = req.body.payment_date || null, ref = req.body.payment_ref || null, method = req.body.payment_method || null;
    if (req.file && claude.isEnabled()) {
      const r = await claude.extractFromFile({ buffer: req.file.buffer, mimeType: req.file.mimetype, schema: PROOF_SCHEMA, maxTokens: 512,
        instruction: 'This is a proof of payment (bank confirmation, wire receipt, or screenshot). Extract payment_date (YYYY-MM-DD), reference (confirmation/reference number), and method (ACH, Wire, Check, PayPal, etc.). Use null for anything not present.' }).catch(() => null);
      // Validate the shape before trusting it: PROOF_SCHEMA only constrains the type,
      // so a model answering "N/A" or "Aug-2026" would reach a DATE column and 500.
      if (r?.ok) {
        if (!date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.data.payment_date || ''))) date = r.data.payment_date;
        ref = ref || r.data.reference;
        method = method || r.data.method;
      }
    }
    let proof = { key: null, filename: null };
    if (req.file) proof = await storeFile(req.labelId, req.file, 'proof');
    // Record the proof as a full installment for the audit trail.
    await pool.query(
      `INSERT INTO payment_installments (label_id, expense_id, amount, paid_date, method, reference, proof_r2_key, proof_filename, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9)`,
      [req.labelId, id, exp.rows[0].amount, date, method, ref, proof.key, proof.filename, req.user.name]
    );
    // Cascade-pay the whole family.
    const { rows } = await pool.query(
      `UPDATE expenses SET payment_status = 'Paid', payment_date = COALESCE($1, CURRENT_DATE),
         payment_method = COALESCE($2, payment_method), payment_ref = COALESCE($3, payment_ref),
         paid_by = $4,
         paid_marked_at = CASE WHEN payment_status = 'Paid' THEN paid_marked_at ELSE NOW() END,
         rush = false, rush_reason = NULL, rush_needed_by = NULL, rush_by = NULL, rush_at = NULL,
         on_hold = false, hold_reason = NULL, hold_by = NULL, hold_at = NULL
       WHERE label_id = $5 AND status = 'approved'
         AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $6 AND label_id = $5)
       RETURNING *`,
      [date, method, ref, req.user.name, req.labelId, id]
    );
    // Surface the proof on the ENTRY too, not just the installment row above —
    // otherwise paying with proof leaves the Payments row's Proof link grey, the
    // mirror image of an inline upload turning it green without marking paid.
    //
    // Deliberately LAST: these statements are separate autocommits, so recording the
    // proof before the pay could leave a row with a Proof link, still Unpaid, and no
    // drop zone left to retry from. Written to `id` alone, not the family — the proof
    // documents the row it was dropped on, always the family head on this page.
    if (proof.key) {
      await pool.query(
        'UPDATE expenses SET proof_r2_key = $1, proof_filename = $2 WHERE id = $3 AND label_id = $4',
        [proof.key, proof.filename, id, req.labelId]
      );
    }
    rows.forEach(r => stampFxRateAsync(r.id));
    await logActivity(req, 'Paid via proof', `${rows[0]?.payee} — ${rows[0]?.amount}`, { entryPayee: rows[0]?.payee });
    res.json({ success: true, data: { paid: rows.length, payment_date: date, reference: ref } });
  } catch (error) {
    console.error('Pay with proof error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/send-for-approval { ids:[], to, note } — email named
// approvers an Excel summary + the invoice PDFs for the selected entries.
router.post('/send-for-approval', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const to = req.body.to;
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    if (!to || (Array.isArray(to) && !to.length)) return res.status(400).json({ success: false, error: 'At least one approver email is required' });

    const { rows } = await pool.query(
      `SELECT id, parent_id, payee, artist, invoice_number, amount, currency, category,
              invoice_date, scheduled_payment_date, payment_method, rep, is_reimbursement,
              invoice_r2_key, invoice_filename
         FROM expenses
        WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
          AND COALESCE(parent_id, id) IN (SELECT COALESCE(parent_id, id) FROM expenses WHERE label_id = $1 AND id = ANY($2::int[]))
        ORDER BY payee, id`,
      [req.labelId, ids]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entries not found' });
    // Selections expand to whole families, but the approver is buying INVOICES,
    // not slices — the count, subject and body all speak in families.
    const familyCount = new Set(rows.map(r => r.parent_id || r.id)).size;

    // Excel summary — the sheet the approver actually reads, so it carries the
    // columns a decision needs (due date, method, rep, reimbursement) plus a
    // bold per-currency TOTAL block (boom parity).
    const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Invoices for approval');
    ws.columns = [
      { header: 'Date', key: 'invoice_date', width: 12 },
      { header: 'Payee', key: 'payee', width: 28 }, { header: 'Artist', key: 'artist', width: 20 },
      { header: 'Invoice #', key: 'invoice_number', width: 16 }, { header: 'Category', key: 'category', width: 18 },
      { header: 'Method', key: 'payment_method', width: 12 }, { header: 'Due date', key: 'due', width: 12 },
      { header: 'Rep', key: 'rep', width: 14 }, { header: 'Reimb', key: 'reimb', width: 8 },
      { header: 'Amount', key: 'amount', width: 14 }, { header: 'Currency', key: 'currency', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    const byCur = {};
    rows.forEach(r => {
      ws.addRow({ ...r, invoice_date: day(r.invoice_date), due: day(r.scheduled_payment_date), reimb: r.is_reimbursement ? 'Yes' : '' });
      byCur[r.currency || 'USD'] = (byCur[r.currency || 'USD'] || 0) + Number(r.amount || 0);
    });
    ws.addRow({});
    for (const [c, a] of Object.entries(byCur)) {
      const tr = ws.addRow({ payee: `TOTAL (${c})`, amount: Math.round(a * 100) / 100, currency: c });
      tr.font = { bold: true };
    }
    const fmtMoney = (a) => Number(a).toLocaleString(undefined, { minimumFractionDigits: 2 });
    const totalLine = Object.entries(byCur).map(([c, a]) => `${c} ${fmtMoney(a)}`).join(' · ');
    const xlsxBuf = await wb.xlsx.writeBuffer();

    // Totals-by-Artist + per-invoice detail tables for the email body (boom
    // parity — the approver can answer from the email alone).
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const byArtist = {};
    rows.forEach(r => {
      const k = `${(r.artist || 'Unattributed').trim() || 'Unattributed'}|${r.currency || 'USD'}`;
      byArtist[k] = (byArtist[k] || 0) + Number(r.amount || 0);
    });
    const td = 'padding:5px 10px;border-bottom:1px solid #eee;font-size:13px;color:#333';
    const th = 'padding:5px 10px;border-bottom:2px solid #ddd;font-size:11px;color:#888;text-transform:uppercase;text-align:left';
    const artistRows = Object.entries(byArtist).sort((a, b) => b[1] - a[1])
      .map(([k, a]) => { const [artist, cur] = k.split('|'); return `<tr><td style="${td}">${esc(artist)}</td><td style="${td};text-align:right">${esc(cur)} ${fmtMoney(a)}</td></tr>`; }).join('');
    const detailRows = rows.map(r =>
      `<tr><td style="${td}">${esc(r.payee)}</td><td style="${td}">${esc(r.artist || '')}</td><td style="${td}">${esc(r.invoice_number || '')}</td><td style="${td};text-align:right">${esc(r.currency || 'USD')} ${fmtMoney(r.amount || 0)}</td></tr>`).join('');
    const tablesHtml = `
      <p style="color:#888;font-size:12px;margin:18px 0 4px;text-transform:uppercase;letter-spacing:.04em">Totals by artist</p>
      <table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Artist</th><th style="${th};text-align:right">Total</th></tr>${artistRows}</table>
      <p style="color:#888;font-size:12px;margin:18px 0 4px;text-transform:uppercase;letter-spacing:.04em">Invoices</p>
      <table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Payee</th><th style="${th}">Artist</th><th style="${th}">Inv #</th><th style="${th};text-align:right">Amount</th></tr>${detailRows}</table>`;

    const attachments = [{ filename: 'invoices-summary.xlsx', content: Buffer.from(xlsxBuf).toString('base64'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }];
    const seen = new Set();
    for (const r of rows) {
      if (!r.invoice_r2_key || seen.has(r.invoice_r2_key)) continue;
      seen.add(r.invoice_r2_key);
      const b64 = await loadFileBase64(r.invoice_r2_key, null).catch(() => null);
      if (b64) attachments.push({ filename: r.invoice_filename || `invoice-${r.id}.pdf`, content: b64 });
    }

    const lab = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const result = await dispatchSend('approval_request',
      { labelId: req.labelId, to: Array.isArray(to) ? to[0] : to, cc: Array.isArray(to) ? to.slice(1) : [], workspaceName: lab.rows[0]?.name || 'the label', count: familyCount, totalLine, note: req.body.note, tablesHtml, attachments },
      { subject: req.body.subject || undefined });
    if (!result.sent) return res.status(502).json({ success: false, error: result.reason || 'Send failed' });
    rows.forEach(r => bkAudit(req, r.id, 'sent for approval', `to ${Array.isArray(to) ? to.join(', ') : to}`));
    await logActivity(req, 'Sent invoices for approval', `${familyCount} invoices → ${Array.isArray(to) ? to.join(', ') : to}`);
    res.json({ success: true, data: { sent: familyCount } });
  } catch (error) {
    console.error('Send for approval error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Vendors ─────────────────────────────────────────────────────────────

// GET /api/ledger/vendors — spend aggregated by payee, joined to the vendors
// table for W9-on-file + contact. W9 is "on file" if any approved invoice
// carries one OR the vendor record has one.
router.get('/vendors', async (req, res) => {
  try {
    // GROUP BY LOWER(payee): grouping by the raw string listed "Acme" and
    // "ACME" as two vendors while every mutation route below matches LOWER(),
    // so the drawer for either one showed BOTH sets of invoices. The display
    // name is the spelling with the most rows behind it.
    //
    // Voided rows are excluded here as they are in every other aggregate —
    // a voided invoice is money that never moved, and leaving it in makes a
    // vendor's spend disagree with the ledger's own totals.
    const { rows } = await pool.query(
      `SELECT
         agg.name,
         agg.spellings,
         agg.invoice_count,
         agg.total_spent,
         agg.money,
         agg.currency_count,
         agg.paid_amount,
         agg.last_invoice,
         (agg.entry_has_w9 OR v.w9_r2_key IS NOT NULL) AS w9_on_file,
         COALESCE(v.email, agg.vendor_email) AS email,
         v.address,
         agg.w9_names,
         agg.alias_count
       FROM (
         SELECT
           (ARRAY_AGG(payee ORDER BY n DESC, payee))[1] AS name,
           ARRAY_AGG(DISTINCT payee) AS spellings,
           SUM(invoice_count)::int AS invoice_count,
           SUM(total_spent) AS total_spent,
           JSONB_AGG(JSONB_BUILD_OBJECT('cur', cur, 'rate', rate, 'amt', total_spent, 'paid', paid_amount)) AS money,
           COUNT(DISTINCT cur) FILTER (WHERE cur IS NOT NULL)::int AS currency_count,
           SUM(paid_amount) AS paid_amount,
           MAX(last_invoice) AS last_invoice,
           BOOL_OR(entry_has_w9) AS entry_has_w9,
           MAX(vendor_email) AS vendor_email,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT w9_name), NULL) AS w9_names,
           (SELECT COUNT(*) FROM vendor_aliases va
             WHERE va.label_id = $1 AND LOWER(va.canonical) = LOWER((ARRAY_AGG(payee ORDER BY n DESC, payee))[1]))::int AS alias_count
         FROM (
           SELECT
             payee,
             LOWER(payee) AS pkey,
             COUNT(*)::int AS n,
             -- Families, not slices: a split invoice is ONE invoice the vendor
             -- sent, however many artists it was carved across.
             COUNT(*) FILTER (WHERE parent_id IS NULL)::int AS invoice_count,
             COALESCE(SUM(amount), 0) AS total_spent,
             COALESCE(currency, 'USD') AS cur,
             fx_rate_to_usd AS rate,
             COALESCE(SUM(amount) FILTER (WHERE payment_status = 'Paid'), 0) AS paid_amount,
             MAX(invoice_date) AS last_invoice,
             BOOL_OR(w9_r2_key IS NOT NULL) AS entry_has_w9,
             MAX(vendor_email) AS vendor_email,
             MAX(w9_scan->>'w9_name') AS w9_name
           FROM expenses
           WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
             AND (voided = false OR voided IS NULL)
             AND payee IS NOT NULL AND payee != '' AND status = 'approved'
             AND entry_source IS DISTINCT FROM 'creator_payment'
           -- Grouped by the LOCKED RATE as well as the currency, so each bucket
           -- converts with one rate and lib/usd.js can be trusted with it. The
           -- old amount / COALESCE(fx_rate_to_usd, 1) silently treated an
           -- unstamped foreign invoice as 1:1 — the one thing lib/usd.js exists
           -- to prevent — and made this page disagree with every other USD
           -- figure in the app about the same vendor.
           GROUP BY payee, COALESCE(currency, 'USD'), fx_rate_to_usd
         ) per_spelling
         GROUP BY pkey
       ) agg
       LEFT JOIN vendors v ON v.label_id = $1 AND LOWER(v.name) = LOWER(agg.name)
       ORDER BY agg.total_spent DESC`,
      [req.labelId]
    );
    // Name-mismatch flag from the PERSISTED W9 scan (expenses.w9_scan) — the
    // batch scanner writes it, so the signal survives the results panel being
    // closed instead of dying with it.
    const data = rows.map((r) => {
      const w9Name = (r.w9_names || []).find((n) => n && n.trim()) || null;
      // Only claim a mismatch when there is a W9 to look at. A scan result
      // outliving its file (replaced, deleted) would otherwise badge a vendor
      // who has no W9 at all — two different problems, one of which is louder.
      const mismatch = w9Name && r.w9_on_file ? w9NameMatch.mismatchOf(r.name, w9Name) : null;
      // USD through lib/usd.js, per (currency, locked rate) bucket: the locked
      // rate always wins, and a currency with no locked rate converts at the
      // cached live rate rather than passing through at face value.
      const buckets = Array.isArray(r.money) ? r.money : [];
      const totalUsd = round2(buckets.reduce((sum, m) => sum + usdOf(m.amt, m.cur, m.rate), 0));
      const paidUsd = round2(buckets.reduce((sum, m) => sum + usdOf(m.paid, m.cur, m.rate), 0));
      return {
        ...r,
        money: undefined,
        w9_names: undefined,
        w9_name: r.w9_on_file ? w9Name : null,
        w9_mismatch: !!mismatch,
        total_spent: Number(r.total_spent),
        total_spent_usd: totalUsd,
        paid_amount: Number(r.paid_amount),
        paid_amount_usd: paidUsd,
        // OBBBA: the 1099 reporting floor is $600 through 2025 and $2,000 from
        // 2026. Same rule the ledger's 1099 report already adopted.
        qualifies_1099: totalUsd >= reportingThresholdFor(new Date().getFullYear()),
      };
    });
    data.sort((a, b) => b.total_spent_usd - a.total_spent_usd);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Vendors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Added-expense vendors ───────────────────────────────────────────────────
// The invoice-less side of the vendor world: payees that exist only because
// somebody added an expense on Recoupments or Artist Campaigns. Those rows
// carry no invoice number, so the ledger's duplicate-invoice gate — the thing
// that stops the same bill being paid twice — has nothing to key on. This is
// the surface that answers "did we pay this creator twice", by amount and
// date instead of by document.
//
// MUST be declared before `/vendors/:name`, or Express matches the literal
// path as a vendor called "added-expenses".
router.get('/vendors/added-expenses', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.amount, e.currency, e.fx_rate_to_usd, e.artist, e.song,
              e.payment_date, e.invoice_date, e.created_at,
              -- ::text, not a Date object: pg hands back a JS Date for DATE
              -- columns and every string slice of one reads "Tue Sep 01".
              COALESCE(e.invoice_date, e.created_at::date)::text AS spent_date
         FROM expenses e
        WHERE e.label_id = $1
          AND e.entry_source = ANY($2)
          AND (e.deleted = false OR e.deleted IS NULL)
          AND (e.voided = false OR e.voided IS NULL)
          AND e.payee IS NOT NULL AND TRIM(e.payee) <> ''
        ORDER BY COALESCE(e.invoice_date, e.created_at::date) DESC
        LIMIT 5000`,
      [req.labelId, ADDED_SOURCES]
    );
    // USD through the shared rule (locked fx_rate_to_usd always wins), rounded
    // AT THE ROW so the per-vendor totals and the page total tie.
    for (const r of rows) r.usd = await rowUsd2(r);
    const data = addedExpenseRollup(rows);
    res.json({ success: true, data: { ...data, sources: ADDED_SOURCES, row_count: rows.length } });
  } catch (error) {
    console.error('Added-expense vendors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Vendor duplicates: the review deck's data ──────────────────────────────
// Scored PAIRS, not clusters. Pairs already linked through vendor_aliases and
// pairs somebody marked "not duplicates" never come back — a deck that
// re-offers a decision is a deck people stop trusting.
router.get('/vendors/duplicates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TRIM(e.payee) AS payee,
              COUNT(*) FILTER (WHERE e.parent_id IS NULL)::int AS invoice_count,
              MIN(e.invoice_date)::text AS first_invoice,
              MAX(e.invoice_date)::text AS last_invoice,
              BOOL_OR(e.w9_r2_key IS NOT NULL) AS has_w9,
              SUM(COALESCE(e.amount, 0))::numeric AS total_amount,
              MAX(e.currency) AS currency,
              MAX(e.vendor_email) AS email
         FROM expenses e
        WHERE e.label_id = $1
          AND (e.deleted = false OR e.deleted IS NULL)
          AND (e.voided = false OR e.voided IS NULL)
          AND ${excludeCreatorRows('e')}
          AND e.payee IS NOT NULL AND TRIM(e.payee) <> ''
        GROUP BY TRIM(e.payee)`,
      [req.labelId]
    );
    const vendors = rows.map((r) => ({
      payee: r.payee,
      invoice_count: r.invoice_count || 0,
      first_invoice: r.first_invoice,
      last_invoice: r.last_invoice,
      has_w9: !!r.has_w9,
      email: r.email || null,
      total_usd: round2(usdOf(r.total_amount, r.currency, null)),
    }));
    const { rows: aliasRows } = await pool.query(
      'SELECT canonical, alias FROM vendor_aliases WHERE label_id = $1', [req.labelId]);
    const aliased = new Set(aliasRows.map((r) => pairKey(r.canonical, r.alias)));
    const { rows: ackRows } = await pool.query(
      `SELECT flag_key, note, dismissed_by, dismissed_at FROM data_quality_dismissals
        WHERE label_id = $1 AND flag_key LIKE 'vdup:%' ORDER BY dismissed_at DESC`, [req.labelId]);
    const acked = new Set(ackRows.map((r) => String(r.flag_key).slice(5)));
    const pairs = vendorDupePairs(vendors, { aliased, acked });
    res.json({
      success: true,
      data: {
        pairs,
        vendor_count: vendors.length,
        acked: ackRows.map((r) => ({
          pair_key: String(r.flag_key).slice(5),
          names: String(r.flag_key).slice(5).split('|'),
          note: r.note, by: r.dismissed_by, at: r.dismissed_at,
        })),
      },
    });
  } catch (error) {
    console.error('Vendor duplicates error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// "These two are NOT the same vendor" — persisted so the pair stops coming
// back, and reversible, because the only thing worse than re-offering a
// decision is burying a wrong one. Stored in the same dismissals table every
// other data-quality "no" lives in.
router.post('/vendors/duplicates/ack', requireAdmin, async (req, res) => {
  try {
    const a = String(req.body.a || '').trim();
    const b = String(req.body.b || '').trim();
    if (!a || !b) return res.status(400).json({ success: false, error: 'Name both vendors' });
    const key = ackKey(a, b);
    await pool.query(
      `INSERT INTO data_quality_dismissals (label_id, flag_key, kind, note, summary, dismissed_by)
       VALUES ($1,$2,'vendor_dupe',$3,$4,$5)
       ON CONFLICT (label_id, flag_key) DO UPDATE SET note = EXCLUDED.note, dismissed_by = EXCLUDED.dismissed_by, dismissed_at = NOW()`,
      [req.labelId, key, String(req.body.note || '').trim() || null, `"${a}" and "${b}" are different vendors`, req.user.name]
    );
    await logActivity(req, 'Marked vendors as not duplicates', `${a} ≠ ${b}`);
    res.json({ success: true, data: { pair_key: pairKey(a, b) } });
  } catch (error) {
    console.error('Vendor dupe ack error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
router.delete('/vendors/duplicates/ack', requireAdmin, async (req, res) => {
  try {
    const a = String(req.query.a || '').trim();
    const b = String(req.query.b || '').trim();
    if (!a || !b) return res.status(400).json({ success: false, error: 'Name both vendors' });
    const r = await pool.query('DELETE FROM data_quality_dismissals WHERE label_id = $1 AND flag_key = $2',
      [req.labelId, ackKey(a, b)]);
    res.json({ success: true, data: { removed: r.rowCount } });
  } catch (error) {
    console.error('Vendor dupe unack error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Unified view: one row per COMPANY, ledger joined to the bank ───────────
// The Vendors table is ledger-only, which means the question a bookkeeper
// actually asks — "we invoiced 12k, what left the bank?" — cannot be asked on
// the vendor page even though the statements are loaded. Three worklists ride
// along, counted per vendor from the SAME rows the totals come from, so a
// chip count can never disagree with the row it filters to.
router.get('/vendors/unified', async (req, res) => {
  try {
    const accounts = await bankEvidence.loadAccounts(pool, req.labelId);
    const { rows } = await pool.query(
      `SELECT e.payee, (e.parent_id IS NULL) AS is_root, e.amount, e.currency, e.fx_rate_to_usd,
              e.artist, e.category, e.payment_status, e.entry_source,
              (e.invoice_r2_key IS NOT NULL OR e.vendor_submitted = TRUE) AS has_invoice,
              (e.w9_r2_key IS NOT NULL) AS w9_on_file,
              COALESCE(e.payment_date, e.invoice_date, e.created_at::date)::text AS last_activity,
              ${bankEvidence.bankEvidenceCols('e', accounts)}
         FROM expenses e
        WHERE e.label_id = $1 AND e.status = 'approved'
          AND (e.deleted = false OR e.deleted IS NULL)
          AND (e.voided = false OR e.voided IS NULL)
          AND ${excludeCreatorRows('e')}
          AND e.payee IS NOT NULL AND TRIM(e.payee) <> ''
        LIMIT 20000`,
      [req.labelId]
    );
    for (const r of rows) r.usd = round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd));

    // What the bank says, grouped by descriptor (lib/bankVendors.js is the one
    // definition). A descriptor names a vendor through a person's override, a
    // learned lesson, or its own past matches — in that confidence order.
    const groups = await aggregateBankVendors(req.labelId).catch(() => []);
    const shaped = groups.map((g) => ({
      ...g,
      resolved_vendor: g.override_vendor || g.linked_vendor
        || (g.ledger_vendors && g.ledger_vendors.length === 1 ? g.ledger_vendors[0] : null),
      resolved_by: g.override_vendor ? 'override' : g.linked_vendor ? 'learned' : (g.ledger_vendors || []).length === 1 ? 'history' : null,
    }));
    const { rows: aliasRows } = await pool.query(
      'SELECT canonical, alias FROM vendor_aliases WHERE label_id = $1', [req.labelId]);
    const data = unifiedRows(rows, shaped);
    res.json({
      success: true,
      data: {
        ...data,
        aliases: aliasRows,
        bank_groups: shaped.length,
        // A workspace with no ready statements has no bank column to show;
        // saying so beats rendering a table of zeroes that reads as "nothing
        // ever left the bank".
        has_bank_data: shaped.length > 0,
      },
    });
  } catch (error) {
    console.error('Vendors unified error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Link an unlinked bank descriptor to a ledger vendor. Writes the decision
// (vendor_override on those lines) AND the lesson (statement_payee_map) —
// lib/bankVendors.applyVendorOverride, the same call Bank Matching makes.
router.post('/vendors/link-bank-payee', requireAdmin, async (req, res) => {
  try {
    const vendor = String(req.body.vendor || '').trim().slice(0, 200);
    const ids = (req.body.txn_ids || []).map(Number).filter(Number.isFinite).slice(0, 500);
    if (!vendor || !ids.length) return res.status(400).json({ success: false, error: 'Name the vendor and pick some lines' });
    // A typo here mints a vendor in the directory that no invoice supports.
    const known = (await pool.query(
      `SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(TRIM(payee)) = LOWER($2) AND (deleted IS NULL OR deleted = FALSE) LIMIT 1`,
      [req.labelId, vendor]
    )).rows.length > 0;
    if (!known && req.body.confirm_new !== true) {
      return res.status(409).json({
        success: false, unknown_vendor: true,
        error: `No ledger entry is filed under "${vendor}". Confirm to use it anyway — a misspelling here becomes a second vendor in the directory.`,
      });
    }
    const n = await applyVendorOverride(req.labelId, ids, vendor, req.user.name);
    await logActivity(req, 'Linked a bank payee to a vendor', `${n} bank line${n === 1 ? '' : 's'} → ${vendor}`);
    res.json({ success: true, data: { updated: n, new_vendor: !known } });
  } catch (error) {
    console.error('Link bank payee error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Move ONE invoice to another vendor ─────────────────────────────────────
// Explicitly not a merge: a single invoice was filed under the wrong payee,
// and merging would drag every other invoice with it. The whole SPLIT FAMILY
// moves — the vendor billed one invoice, and leaving the slices behind puts
// half the money under a vendor that never sent anything.
router.post('/vendors/move-invoice', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.body.entry_id);
    const to = String(req.body.to || '').trim();
    if (!Number.isFinite(id) || !to) return res.status(400).json({ success: false, error: 'entry_id and to are required' });
    const { rows: er } = await client.query(
      `SELECT id, parent_id, payee, vendor_name, amount, currency, fx_rate_to_usd
         FROM expenses WHERE id = $1 AND label_id = $2 AND (deleted = false OR deleted IS NULL)`,
      [id, req.labelId]);
    if (!er.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const rootId = er[0].parent_id || er[0].id;
    const from = er[0].payee;
    if (String(from || '').toLowerCase() === to.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'That invoice is already filed under that vendor' });
    }
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE expenses SET payee = $1 WHERE label_id = $2 AND (id = $3 OR parent_id = $3) RETURNING id, amount, currency, fx_rate_to_usd`,
      [to, req.labelId, rootId]);
    // vendor_name is the public form's copy of who submitted. Move it only
    // where it agreed with the payee — a submission under a different trading
    // name is a fact about the document, not a mis-filing.
    await client.query(
      `UPDATE expenses SET vendor_name = $1
        WHERE label_id = $2 AND (id = $3 OR parent_id = $3) AND LOWER(TRIM(COALESCE(vendor_name,''))) = LOWER(TRIM($4))`,
      [to, req.labelId, rootId, from || '']);
    await client.query('COMMIT');
    await upsertVendor(pool, req.labelId, { name: to }).catch(() => {});
    const moved_usd = round2(upd.rows.reduce((s, r) => s + usdOf(r.amount, r.currency, r.fx_rate_to_usd), 0));
    await logActivity(req, 'Moved an invoice to another vendor', `#${rootId}: ${from} → ${to}`);
    bkAudit(req, rootId, 'payee', `moved from "${from}" to "${to}" (${upd.rowCount} row${upd.rowCount === 1 ? '' : 's'})`);
    res.json({ success: true, data: { moved: upd.rowCount, root_id: rootId, from, to, moved_usd } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Move invoice error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/ledger/vendors/:name — vendor record + their ledger entries
router.get('/vendors/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const { rows: vrows } = await pool.query(
      'SELECT id, name, email, address, w9_filename, w9_r2_key, notes FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)',
      [req.labelId, name]
    );
    const vendor = vrows[0] || { name };
    if (!vendor.w9_r2_key) {
      // Fall back to the most recent W9 on any of this vendor's ledger rows,
      // under any spelling it answers to — an alias's W9 is this vendor's W9.
      const alt = await vendorNameSet(req.labelId, name);
      const { rows: wr } = await pool.query(
        `SELECT w9_r2_key, w9_filename FROM expenses
          WHERE label_id = $1 AND LOWER(payee) = ANY($2) AND w9_r2_key IS NOT NULL
            AND (deleted = false OR deleted IS NULL) ORDER BY id DESC LIMIT 1`, [req.labelId, alt]);
      if (wr[0]) { vendor.w9_r2_key = wr[0].w9_r2_key; vendor.w9_filename = wr[0].w9_filename; vendor.w9_from_entry = true; }
    }
    if (vendor.w9_r2_key) { vendor.w9_url = await getSignedFileUrl(vendor.w9_r2_key, 3600).catch(() => null); }
    delete vendor.w9_r2_key;

    // Masked payment-details summary (method + ••••last4) from the encrypted
    // vault, keyed by the vendor's email — the record email first, else the
    // most recent email seen on this payee's invoices. Never a decrypted value;
    // the reveal is a separate Admin-only endpoint that audits per read.
    try {
      let email = vendor.email;
      if (!email) {
        const { rows: er } = await pool.query(
          `SELECT vendor_email FROM expenses
            WHERE label_id = $1 AND LOWER(payee) = LOWER($2) AND vendor_email IS NOT NULL AND vendor_email <> ''
            ORDER BY created_at DESC LIMIT 1`, [req.labelId, name]);
        email = er[0]?.vendor_email || null;
      }
      if (email) {
        const { rows: pr } = await pool.query(
          `SELECT method, account_last4, encrypted, updated_at FROM vendor_payment_details
            WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2)`, [req.labelId, email]);
        if (pr[0]) {
          vendor.payment_summary = {
            method: pr[0].method, last4: pr[0].account_last4,
            encrypted: pr[0].encrypted, updated_at: pr[0].updated_at,
            key_missing: !paymentCrypto.isConfigured(),
          };
        }
      }
    } catch { /* summary is decoration; the drawer degrades to "nothing on file" */ }

    // Alias-aware, family-grouped. The canonical W9 rule is `w9_entry_id || id`:
    // an entry that names another entry's W9 is covered by it, so the drawer
    // must not report the vendor as missing a W9 because THIS row has no file.
    const names = await vendorNameSet(req.labelId, name);
    const { rows: entries } = await pool.query(
      `SELECT e.id, e.parent_id, e.payee, e.invoice_date, e.invoice_number, e.amount, e.currency, e.category,
              e.artist, e.status, e.payment_status, e.payment_date, e.scheduled_payment_date, e.voided,
              -- The canonical-W9 rule (the reference app's w9_entry_id || id): the row that
              -- HOLDS this vendor's W9, alias-aware. A row without its own file
              -- is still covered by a sibling's, so "no W9" here must mean the
              -- VENDOR has none — not that this particular invoice lacked one.
              COALESCE(
                (SELECT x.id FROM expenses x
                  WHERE x.label_id = e.label_id AND x.w9_r2_key IS NOT NULL
                    AND (x.deleted = false OR x.deleted IS NULL) AND x.status <> 'rejected'
                    AND LOWER(TRIM(x.payee)) = ANY($2)
                  ORDER BY x.id DESC LIMIT 1),
                CASE WHEN e.w9_r2_key IS NOT NULL THEN e.id END) AS w9_entry_id,
              (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
                 WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount
       FROM expenses e
       WHERE e.label_id = $1 AND LOWER(e.payee) = ANY($2) AND (e.deleted = false OR e.deleted IS NULL)
       ORDER BY COALESCE(e.invoice_date, e.created_at::date) DESC, e.id DESC`,
      [req.labelId, names]
    );
    const byParent = new Map();
    for (const e of entries) if (e.parent_id) {
      if (!byParent.has(e.parent_id)) byParent.set(e.parent_id, []);
      byParent.get(e.parent_id).push(e);
    }
    // Per-currency stat strip. The invariant the reference app enforces is
    // Total === Paid + Outstanding BY CONSTRUCTION — computed from one pass
    // over the same families the list renders, never from a second query.
    const stats = {};
    const shaped = entries.filter((e) => !e.parent_id).map((e) => {
      const cur = e.currency || 'USD';
      const fam = Number(e.family_amount) || 0;
      const st = stats[cur] || (stats[cur] = { total: 0, paid: 0, outstanding: 0, count: 0 });
      if (e.status === 'approved' && !e.voided) {
        st.total += fam; st.count += 1;
        if (e.payment_status === 'Paid') st.paid += fam; else st.outstanding += fam;
      }
      return {
        ...e, family_amount: fam, has_w9: !!e.w9_entry_id, w9_entry_id: undefined,
        children: (byParent.get(e.id) || []).map((c) => ({ ...c, has_w9: !!c.w9_entry_id, w9_entry_id: undefined, family_amount: undefined })),
      };
    });
    const round2s = (n) => Math.round(n * 100) / 100;
    for (const c of Object.keys(stats)) {
      stats[c] = { total: round2s(stats[c].total), paid: round2s(stats[c].paid), outstanding: round2s(stats[c].outstanding), count: stats[c].count };
    }
    res.json({ success: true, data: { vendor, entries: shaped, stats, alias_names: names.filter((n) => n !== String(name).toLowerCase()) } });
  } catch (error) {
    console.error('Vendor detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/vendors/:name/payment-details — the ONLY place a stored
// account number is ever decrypted. Admin-gated, and it writes an audit row PER
// READ — not per change: access to payment details is itself the sensitive
// event (a change is visible in the data afterwards; a read leaves no trace
// unless one is made deliberately). Looked up by the vendor's email, which is
// how the details were keyed on the way in.
router.get('/vendors/:name/payment-details', requireAdmin, async (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Vendor name required' });

    let email = null;
    const { rows: vr } = await pool.query(
      'SELECT email FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, name]);
    email = vr[0]?.email || null;
    if (!email) {
      const { rows: er } = await pool.query(
        `SELECT vendor_email FROM expenses
          WHERE label_id = $1 AND LOWER(payee) = LOWER($2) AND vendor_email IS NOT NULL AND vendor_email <> ''
          ORDER BY created_at DESC LIMIT 1`, [req.labelId, name]);
      email = er[0]?.vendor_email || null;
    }
    if (!email) return res.json({ success: true, data: { on_file: false, key_missing: !paymentCrypto.isConfigured() } });

    const { rows } = await pool.query(
      `SELECT * FROM vendor_payment_details WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2)`,
      [req.labelId, email]
    );
    const r = rows[0];
    if (!r) return res.json({ success: true, data: { on_file: false, key_missing: !paymentCrypto.isConfigured() } });

    bkAudit(req, null, 'payment details viewed', `${name} (${r.method || '?'}, ••••${r.account_last4 || '?'})`);
    await logActivity(req, 'Viewed vendor payment details', `${name} — ${r.method || '?'} ••••${r.account_last4 || '?'}`);

    // The query is SELECT *, but this response is a WHITELIST — a column added
    // to the table and not added here is collected, stored, and invisible.
    res.json({ success: true, data: {
      on_file: true,
      method: r.method,
      holder_name: r.holder_name,
      bank_name: r.bank_name,
      bank_address: r.bank_address,
      account_type: r.account_type,
      beneficiary_address: r.beneficiary_address,
      intermediary_bank: r.intermediary_bank,
      wire_scope: r.wire_scope,
      paypal_handle: r.paypal_handle,
      account_number: paymentCrypto.decrypt(r.account_enc),
      routing_number: paymentCrypto.decrypt(r.routing_enc),
      iban_swift: paymentCrypto.decrypt(r.iban_enc),
      last4: r.account_last4,
      updated_at: r.updated_at,
      // encrypted=false rows were captured while the vault key was unset —
      // only method + last4 were kept (never plaintext numbers). readable=false
      // with encrypted=true means the key is missing/changed NOW — say so,
      // rather than letting an empty field read as "the vendor gave nothing".
      encrypted: r.encrypted,
      readable: paymentCrypto.isConfigured(),
      key_missing: !paymentCrypto.isConfigured(),
    } });
  } catch (error) {
    console.error('Vendor payment-details error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/ledger/vendors/:name — edit contact details / notes.
// `bank` is deliberately NOT accepted any more: bank/payment details live in
// the encrypted vendor_payment_details vault (Admin-gated, audited on read),
// not in a plain-text column any Approver can write.
router.patch('/vendors/:name', async (req, res) => {
  try {
    const id = await upsertVendor(pool, req.labelId, {
      name: req.params.name, email: req.body.email, address: req.body.address,
    });
    if (req.body.notes !== undefined) {
      await pool.query('UPDATE vendors SET notes = $1, updated_at = NOW() WHERE id = $2', [req.body.notes, id]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Vendor update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/vendors/:name/w9 — upload/replace the vendor's W9 on file
router.post('/vendors/:name/w9', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const { filename, key } = await storeFile(req.labelId, req.file, 'w9');
    await upsertVendor(pool, req.labelId, { name: req.params.name, w9_r2_key: key, w9_filename: filename });
    await logActivity(req, 'Uploaded vendor W9', req.params.name);
    res.json({ success: true, data: { w9_filename: filename } });
  } catch (error) {
    console.error('Vendor W9 upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// ── Vendor management: rename, merge, aliases, suggest, batch W9 scan ───────

// GET /api/ledger/vendor-suggest?q= — typeahead of payees with W9-on-file flag.
// Resolves aliases so a known alias surfaces its canonical vendor.
router.get('/vendor-suggest', async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    // email/address/bank ride along so the Add Invoice page can autofill its
    // blank contact fields on an exact match (boom's suggest-vendor contract).
    const { rows } = await pool.query(
      `SELECT payee AS name,
              BOOL_OR(w9_r2_key IS NOT NULL) AS w9_on_file,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS invoices,
              MAX(vendor_email) AS email,
              MAX(vendor_address) AS address,
              MAX(vendor_bank) AS bank
         FROM expenses
        WHERE label_id = $1 AND payee IS NOT NULL AND payee <> '' AND LOWER(payee) LIKE $2
          AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
          AND entry_source IS DISTINCT FROM 'creator_payment'
        GROUP BY payee ORDER BY invoices DESC LIMIT 12`,
      [req.labelId, q]
    );
    // The vendors table is the fresher contact source (upserted on every
    // create); overlay it where the ledger aggregate came back empty.
    if (rows.length) {
      const { rows: vrows } = await pool.query(
        `SELECT name, email, address, bank FROM vendors WHERE label_id = $1 AND LOWER(name) = ANY($2)`,
        [req.labelId, rows.map(r => r.name.toLowerCase())]
      );
      const byName = new Map(vrows.map(v => [v.name.toLowerCase(), v]));
      for (const r of rows) {
        const v = byName.get(r.name.toLowerCase());
        if (v) { r.email = v.email || r.email; r.address = v.address || r.address; r.bank = v.bank || r.bank; }
      }
    }
    const { rows: aliases } = await pool.query(
      `SELECT canonical, alias FROM vendor_aliases WHERE label_id = $1 AND LOWER(alias) LIKE $2 LIMIT 12`,
      [req.labelId, q]
    );
    res.json({ success: true, data: { vendors: rows, aliases } });
  } catch (error) {
    console.error('Vendor suggest error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Every name that resolves to this vendor: the canonical name, its aliases,
// and (walking the other direction) the canonical of an alias it is itself.
// Saved emails and the W9 were keyed to whichever spelling was current when
// they were captured, so an exact-name read silently loses them.
async function vendorNameSet(labelId, name) {
  const out = new Set([String(name || '').trim().toLowerCase()]);
  try {
    const { rows } = await pool.query(
      `SELECT canonical, alias FROM vendor_aliases
        WHERE label_id = $1 AND (LOWER(canonical) = LOWER($2) OR LOWER(alias) = LOWER($2))`,
      [labelId, name]);
    for (const r of rows) { out.add(String(r.canonical).toLowerCase()); out.add(String(r.alias).toLowerCase()); }
  } catch { /* the exact name alone is still a correct, narrower answer */ }
  return [...out].filter(Boolean);
}

// Move saved emails onto a new canonical name. A single UPDATE aborts on the
// FIRST collision with the unique index and — because the old code swallowed
// the error — left EVERY address stranded under the dead name. Delete the
// would-collide rows first, then move the rest.
async function carryVendorEmails(labelId, from, into) {
  const { rows: dropped } = await pool.query(
    `DELETE FROM vendor_emails a
      WHERE a.label_id = $1 AND LOWER(a.vendor) = LOWER($2)
        AND EXISTS (SELECT 1 FROM vendor_emails b
                     WHERE b.label_id = $1 AND LOWER(b.vendor) = LOWER($3) AND LOWER(b.email) = LOWER(a.email))
      RETURNING id`, [labelId, from, into]);
  const { rows: moved } = await pool.query(
    `UPDATE vendor_emails SET vendor = $1 WHERE label_id = $2 AND LOWER(vendor) = LOWER($3) RETURNING id`,
    [into, labelId, from]);
  return { moved: moved.map((r) => r.id), dropped: dropped.length };
}

// Fold the source vendor RECORD into the target instead of deleting it. The
// old code dropped the source row outright, discarding its W9 file, contact
// details and notes even when the target had none of them — the merge threw
// away the very information it was supposed to consolidate.
async function foldVendorRecord(labelId, from, into) {
  const { rows: src } = await pool.query(
    'SELECT * FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [labelId, from]);
  if (!src.length) return null;
  const { rows: dst } = await pool.query(
    'SELECT id FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [labelId, into]);
  if (!dst.length) {
    await pool.query('UPDATE vendors SET name = $1, updated_at = NOW() WHERE id = $2', [into, src[0].id]);
    return { moved_record: true };
  }
  // COALESCE keeps whatever the target already has and fills its gaps from the
  // source; the target's own values always win.
  await pool.query(
    `UPDATE vendors t SET
       email = COALESCE(NULLIF(t.email, ''), $1), address = COALESCE(NULLIF(t.address, ''), $2),
       w9_r2_key = COALESCE(t.w9_r2_key, $3), w9_filename = COALESCE(t.w9_filename, $4),
       notes = CASE WHEN COALESCE(NULLIF(t.notes, ''), '') = '' THEN $5
                    WHEN COALESCE(NULLIF($5::text, ''), '') = '' THEN t.notes
                    ELSE t.notes || E'\n' || $5 END,
       updated_at = NOW()
     WHERE t.id = $6`,
    [src[0].email, src[0].address, src[0].w9_r2_key, src[0].w9_filename, src[0].notes, dst[0].id]);
  await pool.query('DELETE FROM vendors WHERE id = $1', [src[0].id]);
  return { folded_record: true };
}

// How many name-keyed references the cascade moved — reported so the toast can
// say what actually happened rather than "done".
const cascadeCount = (c) => Object.values((c && c.ids) || {}).reduce((n, list) => n + list.length, 0);

// Rename a vendor everywhere (expenses.payee + expenses.vendor_name + the
// vendor record + every name-keyed reference). The old name becomes an alias,
// and the whole thing is logged so it can be reversed. A function, not just a
// route, because the custom-name merge below is a rename followed by a merge
// and re-implementing half of it there is how the two drift.
async function renameVendor(req, from, to) {
  const upd = await pool.query(
    `UPDATE expenses SET payee = $1 WHERE label_id = $2 AND LOWER(payee) = LOWER($3) RETURNING id`,
    [to, req.labelId, from]);
  // `vendor_name` is what the public vendor form captured. Leaving it behind
  // makes the submission record disagree with the ledger row it created.
  const vn = await pool.query(
    `UPDATE expenses SET vendor_name = $1 WHERE label_id = $2 AND LOWER(vendor_name) = LOWER($3) RETURNING id`,
    [to, req.labelId, from]);
  const rec = await foldVendorRecord(req.labelId, from, to);
  // Aliases, learned bank lessons and bank-line overrides are name-keyed too
  // (lib/vendorCascade.js) — leaving them behind points the next statement
  // and the next submission at a vendor that no longer exists.
  const cascade = await cascadeVendorName(pool, req.labelId, from, to);
  const alias = await pool.query(
    `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical RETURNING id`,
    [req.labelId, to, from, req.user.name]);
  const emails = await carryVendorEmails(req.labelId, from, to);
  await pool.query(
    `INSERT INTO vendor_merge_log (label_id, kind, from_name, into_name, expense_ids, vendor_name_ids, email_ids, created_alias, merged_by, cascade_ids)
     VALUES ($1,'rename',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [req.labelId, from, to, JSON.stringify(upd.rows.map((r) => r.id)),
      JSON.stringify(vn.rows.map((r) => r.id)), JSON.stringify(emails.moved), !!alias.rows.length, req.user.name,
      JSON.stringify(cascade)]);
  await logActivity(req, 'Renamed vendor', `${from} \u2192 ${to}`);
  return { updated: upd.rowCount, vendor_names: vn.rowCount, emails_moved: emails.moved.length, emails_dropped: emails.dropped, cascaded: cascadeCount(cascade), ...(rec || {}) };
}

router.put('/vendors/rename', requireAdmin, async (req, res) => {
  try {
    const from = String(req.body.from || '').trim();
    const to = String(req.body.to || '').trim();
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required' });
    if (from.toLowerCase() === to.toLowerCase()) return res.status(400).json({ success: false, error: 'Names are the same' });
    res.json({ success: true, data: await renameVendor(req, from, to) });
  } catch (error) {
    console.error('Vendor rename error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/vendors/merge { from, into, rename_into_to? }
// Fold one vendor into another. `rename_into_to` is the deck's custom-name
// merge: both spellings are wrong and the survivor should be a third name.
// Doing it here rather than asking the client to call rename-then-merge means
// one request either does both or reports which half failed — and both halves
// land in vendor_merge_log, so both are reversible.
router.post('/vendors/merge', requireAdmin, async (req, res) => {
  try {
    const from = String(req.body.from || '').trim();
    let into = String(req.body.into || '').trim();
    const customName = String(req.body.rename_into_to || '').trim();
    if (!from || !into) return res.status(400).json({ success: false, error: 'from and into are required' });
    if (from.toLowerCase() === into.toLowerCase()) return res.status(400).json({ success: false, error: 'Pick two different vendors' });
    let renamed = null;
    if (customName && customName.toLowerCase() !== into.toLowerCase()) {
      if (customName.toLowerCase() === from.toLowerCase()) {
        return res.status(400).json({ success: false, error: 'The custom name is the vendor being folded in — swap the direction instead' });
      }
      renamed = await renameVendor(req, into, customName);
      into = customName;
    }
    const upd = await pool.query(
      `UPDATE expenses SET payee = $1 WHERE label_id = $2 AND LOWER(payee) = LOWER($3) RETURNING id`,
      [into, req.labelId, from]);
    const vn = await pool.query(
      `UPDATE expenses SET vendor_name = $1 WHERE label_id = $2 AND LOWER(vendor_name) = LOWER($3) RETURNING id`,
      [into, req.labelId, from]);
    const rec = await foldVendorRecord(req.labelId, from, into);
    const cascade = await cascadeVendorName(pool, req.labelId, from, into);
    const alias = await pool.query(
      `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical RETURNING id`,
      [req.labelId, into, from, req.user.name]);
    const emails = await carryVendorEmails(req.labelId, from, into);
    // Log the exact ids. Reversing by NAME would drag rows that were always
    // under the target back out with the ones that arrived — the failure that
    // made the reference app's first unmerge unusable.
    const { rows: logRow } = await pool.query(
      `INSERT INTO vendor_merge_log (label_id, kind, from_name, into_name, expense_ids, vendor_name_ids, email_ids, created_alias, merged_by, cascade_ids)
       VALUES ($1,'merge',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.labelId, from, into, JSON.stringify(upd.rows.map((r) => r.id)),
        JSON.stringify(vn.rows.map((r) => r.id)), JSON.stringify(emails.moved), !!alias.rows.length, req.user.name,
        JSON.stringify(cascade)]);
    await logActivity(req, 'Merged vendor', `${from} → ${into} (${upd.rowCount} entries)`);
    res.json({ success: true, data: { moved: upd.rowCount, vendor_names: vn.rowCount, emails_moved: emails.moved.length, emails_dropped: emails.dropped, cascaded: cascadeCount(cascade), merge_id: logRow[0].id, into, renamed, ...(rec || {}) } });
  } catch (error) {
    console.error('Vendor merge error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/vendors/:name/merges — what was folded INTO this vendor.
router.get('/vendors/:name/merges', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, kind, from_name, into_name, merged_by, merged_at, undone_at, undone_by, created_alias,
              jsonb_array_length(expense_ids) AS entry_count
         FROM vendor_merge_log
        WHERE label_id = $1 AND LOWER(into_name) = LOWER($2)
        ORDER BY merged_at DESC LIMIT 50`,
      [req.labelId, req.params.name]);
    // A merge that predates this log cannot be listed — say so rather than
    // implying the vendor was never merged into.
    const { rows: since } = await pool.query(
      `SELECT MIN(merged_at) AS since FROM vendor_merge_log WHERE label_id = $1`, [req.labelId]);
    res.json({ success: true, data: { merges: rows, logged_since: since[0]?.since || null } });
  } catch (error) {
    console.error('Vendor merges error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/vendors/unmerge/:id — reverse a merge BY ID.
router.post('/vendors/unmerge/:id(\\d+)', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT * FROM vendor_merge_log WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    const log = rows[0];
    if (!log) return res.status(404).json({ success: false, error: 'Merge not found' });
    if (log.undone_at) return res.status(400).json({ success: false, error: 'That merge has already been undone' });
    const eIds = (log.expense_ids || []).map(Number).filter(Number.isFinite);
    const vIds = (log.vendor_name_ids || []).map(Number).filter(Number.isFinite);
    const mIds = (log.email_ids || []).map(Number).filter(Number.isFinite);
    const back = eIds.length
      ? await pool.query(`UPDATE expenses SET payee = $1 WHERE label_id = $2 AND id = ANY($3::int[]) RETURNING id`, [log.from_name, req.labelId, eIds])
      : { rowCount: 0 };
    if (vIds.length) await pool.query(`UPDATE expenses SET vendor_name = $1 WHERE label_id = $2 AND id = ANY($3::int[])`, [log.from_name, req.labelId, vIds]);
    if (mIds.length) await pool.query(`UPDATE vendor_emails SET vendor = $1 WHERE label_id = $2 AND id = ANY($3::int[])`, [log.from_name, req.labelId, mIds]);
    // Only remove the alias this merge created — an alias that already existed
    // is somebody else's fact.
    if (log.created_alias) {
      await pool.query('DELETE FROM vendor_aliases WHERE label_id = $1 AND LOWER(alias) = LOWER($2) AND LOWER(canonical) = LOWER($3)',
        [req.labelId, log.from_name, log.into_name]);
    }
    // Everything the name cascade moved goes back too — by id, and only the
    // rows this merge touched. An unmerge that restores the ledger but leaves
    // the learned bank lesson pointing at the survivor re-merges the vendor on
    // the next statement upload.
    await revertVendorCascade(pool, req.labelId, log.from_name, log.cascade_ids || {});
    await pool.query('UPDATE vendor_merge_log SET undone_at = NOW(), undone_by = $1 WHERE id = $2', [req.user.name, id]);
    await logActivity(req, 'Unmerged vendor', `${log.into_name} → ${log.from_name} (${back.rowCount} entries)`);
    res.json({ success: true, data: { restored: back.rowCount } });
  } catch (error) {
    console.error('Vendor unmerge error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET/POST/DELETE aliases for a canonical vendor.
router.get('/vendors/:name/aliases', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, alias FROM vendor_aliases WHERE label_id = $1 AND LOWER(canonical) = LOWER($2) ORDER BY alias', [req.labelId, req.params.name]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Words that are not a vendor. Accepting "LLC" as an alias points every
// company whose name ends in LLC at one vendor the next time dup-check runs.
const NOISE_ALIASES = new Set(['llc', 'l.l.c.', 'inc', 'inc.', 'incorporated', 'corp', 'corp.',
  'corporation', 'ltd', 'ltd.', 'limited', 'co', 'co.', 'company', 'the', 'and', 'llp', 'lp', 'plc', 'gmbh', 'dba']);

router.post('/vendors/:name/aliases', async (req, res) => {
  try {
    const alias = String(req.body.alias || '').trim();
    if (!alias) return res.status(400).json({ success: false, error: 'Alias is required' });
    if (NOISE_ALIASES.has(alias.toLowerCase())) {
      return res.status(400).json({ success: false, error: `"${alias}" is a company suffix, not a vendor name — it would match every company that ends in it.` });
    }
    if (alias.toLowerCase() === String(req.params.name || '').toLowerCase()) {
      return res.status(400).json({ success: false, error: 'That is already this vendor\'s name' });
    }
    // ON CONFLICT re-points an existing alias silently. Report it instead:
    // moving an alias off another vendor changes THAT vendor's identity too.
    const { rows: prior } = await pool.query(
      'SELECT canonical FROM vendor_aliases WHERE label_id = $1 AND LOWER(alias) = LOWER($2)', [req.labelId, alias]);
    await pool.query(
      `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical`,
      [req.labelId, req.params.name, alias, req.user.name]
    );
    const reassigned = prior[0] && prior[0].canonical.toLowerCase() !== String(req.params.name).toLowerCase()
      ? prior[0].canonical : null;
    res.json({ success: true, data: { reassigned_from: reassigned } });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/vendors/aliases/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vendor_aliases WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/ledger/vendors/scan-w9s — batch-validate W9s on file.
//
// UNSCANNED ONLY, capped, and throttled. The previous version rescanned every
// W9-bearing payee in one unbounded request: on a large tenant that is a
// request timeout and an AI bill for work already done. `remaining` lets the
// client say how much is left and click again.
const W9_SCAN_BATCH = 10;
router.post('/vendors/scan-w9s', requireAdmin, async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    const rescanAll = req.body?.rescan_all === true;
    // One representative W9-bearing entry per payee. Creator rows are excluded
    // for the same reason they never enter the vendors directory: a creator is
    // not a vendor, their W9 exposure is per calendar YEAR and is answered on
    // /creators. Sweeping them in here puts them in a batch whose results are
    // rendered against a vendor list they are absent from.
    const scanned = rescanAll ? '' : 'AND e.w9_scan IS NULL';
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(payee)) id, payee, w9_r2_key, w9_filename
         FROM expenses e
        WHERE label_id = $1 AND w9_r2_key IS NOT NULL AND payee IS NOT NULL
          AND (deleted = false OR deleted IS NULL)
          AND ${excludeCreatorRows('e')}
          ${scanned}
        ORDER BY LOWER(payee), id DESC`,
      [req.labelId]
    );
    const batch = rows.slice(0, W9_SCAN_BATCH);
    const out = [];
    for (const e of batch) {
      const r = await aiScan.rescanW9(req.labelId, e.id);
      const w9Name = r.ok ? r.scan.w9_name : null;
      out.push({
        vendor: e.payee,
        ok: r.ok,
        reason: r.ok ? null : r.reason,
        flags: r.ok ? (r.scan.discrepancies || []) : [],
        summary: r.ok ? r.scan.summary : null,
        w9_name: r.w9_on_file ? w9Name : null,
        // The mismatch is computed the same way the vendor LIST computes it,
        // so the panel and the badge can never disagree.
        name_mismatch: w9Name ? !w9NameMatch.namesMatch(e.payee, w9Name) : false,
      });
      await new Promise((r2) => setTimeout(r2, 200));
    }
    await logActivity(req, 'Batch W9 scan', `${out.length} vendors`);
    res.json({ success: true, data: out, meta: { scanned: out.length, remaining: Math.max(0, rows.length - batch.length) } });
  } catch (error) {
    console.error('Batch W9 scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/file/:type — signed URL for invoice|w9|receipt|proof
router.get('/entries/:id/file/:type', async (req, res) => {
  try {
    // `receipt` is the expense receipt (what a reimbursement is claiming); `proof` is
    // proof of PAYMENT. Two different documents, two different columns.
    const col = { invoice: 'invoice_r2_key', w9: 'w9_r2_key', receipt: 'receipt_r2_key', proof: 'proof_r2_key' }[req.params.type];
    if (!col) return res.status(400).json({ success: false, error: 'Invalid file type' });
    const { rows } = await pool.query(
      `SELECT ${col} AS key FROM expenses WHERE id = $1 AND label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length || !rows[0].key) return res.status(404).json({ success: false, error: 'File not found' });
    if (!r2Configured()) return res.status(503).json({ success: false, error: "File storage is not configured on this deployment." });
    const url = await getSignedFileUrl(rows[0].key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('File url error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/file/:type — attach/replace a file (invoice|w9|
// receipt) on an existing entry, straight from the ledger.
router.post('/entries/:id/file/:type', upload.single('file'), async (req, res) => {
  try {
    const cols = { invoice: ['invoice_r2_key', 'invoice_filename'], w9: ['w9_r2_key', 'w9_filename'], receipt: ['receipt_r2_key', 'receipt_filename'], proof: ['proof_r2_key', 'proof_filename'] }[req.params.type];
    if (!cols) return res.status(400).json({ success: false, error: 'Invalid file type' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const cur = await pool.query('SELECT id FROM expenses WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const stored = await storeFile(req.labelId, req.file, req.params.type);
    const { rows } = await pool.query(
      `UPDATE expenses SET ${cols[0]} = $1, ${cols[1]} = $2 WHERE id = $3 AND label_id = $4 RETURNING *`,
      [stored.key, stored.filename, parseInt(req.params.id, 10), req.labelId]
    );
    await logActivity(req, 'Attached ledger file', `${req.params.type} → ${rows[0].payee}`);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Attach file error:', err.message);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// DELETE /api/ledger/entries/:id/file/:type — remove a file from an entry
// (boom's Remove ✕, LED-11). R2 delete is best-effort: a storage hiccup must
// not leave the row pointing at a file we meant to remove.
router.delete('/entries/:id/file/:type', async (req, res) => {
  try {
    const cols = { invoice: ['invoice_r2_key', 'invoice_filename'], w9: ['w9_r2_key', 'w9_filename'], receipt: ['receipt_r2_key', 'receipt_filename'], proof: ['proof_r2_key', 'proof_filename'] }[req.params.type];
    if (!cols) return res.status(400).json({ success: false, error: 'Invalid file type' });
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query(`SELECT id, payee, ${cols[0]} AS key FROM expenses WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    if (!cur.rows[0].key) return res.status(404).json({ success: false, error: 'No file of that type on this entry' });
    await pool.query(`UPDATE expenses SET ${cols[0]} = NULL, ${cols[1]} = NULL WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
    deleteFile(cur.rows[0].key).catch(() => {});
    bkAudit(req, id, 'file-removed', req.params.type);
    await logActivity(req, 'Removed ledger file', `${req.params.type} — ${cur.rows[0].payee}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove file error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/receipts — add ANOTHER receipt to an entry (the
// first lives on the row's receipt_* columns; extras land in entity_files,
// same as the create route). DELETE removes one extra by file id.
router.post('/entries/:id/receipts', upload.single('file'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const cur = await pool.query('SELECT id, receipt_r2_key FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const stored = await storeFile(req.labelId, req.file, 'receipt');
    // First receipt goes on the row itself (keeps every legacy consumer working).
    if (!cur.rows[0].receipt_r2_key) {
      await pool.query('UPDATE expenses SET receipt_r2_key = $1, receipt_filename = $2 WHERE id = $3 AND label_id = $4', [stored.key, stored.filename, id, req.labelId]);
      return res.json({ success: true, data: { slot: 'row' } });
    }
    const { rows } = await pool.query(
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, uploaded_by, file_size)
       VALUES ($1,'expense_receipt',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.labelId, id, stored.key.split('/').pop(), req.file.originalname, req.file.mimetype, stored.key, req.user.id || null, req.file.size || null]
    );
    res.json({ success: true, data: { slot: 'extra', id: rows[0].id } });
  } catch (error) {
    console.error('Add receipt error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/entries/:id/receipts/:fileId(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM entity_files WHERE id = $1 AND label_id = $2 AND entity_type = 'expense_receipt' AND entity_id = $3 RETURNING r2_key`,
      [parseInt(req.params.fileId, 10), req.labelId, parseInt(req.params.id, 10)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Receipt not found' });
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('Delete receipt error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/bulk-approve — approve many pending entries at once.
router.post('/bulk-approve', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    // Every id needs its own completed checklist (`checklists: { [id]: {...} }`).
    // The Approvals page now reviews cards one at a time through the deck, so
    // this route has no UI caller — but an unguarded route IS the bypass:
    // anyone holding a token could still POST to it, and a checklist you can
    // skip by calling a different endpoint is not a checklist.
    // Rep-visibility on every id — any invisible entry rejects the whole batch
    // (silently skipping would leave items pending without the caller knowing).
    const invisible = await findInvisibleEntry(req, ids);
    if (invisible) {
      return res.status(403).json({ success: false, error: `Bulk includes an entry you don't have visibility into (id ${invisible.id}, rep ${invisible.rep || 'none'})` });
    }
    const checklists = req.body.checklists || {};
    const stampedById = new Map();
    for (const cid of ids) {
      const check = validateApprovalChecklist(checklists[cid]);
      if (!check.ok) return res.status(400).json({ success: false, error: `Invoice ${cid}: ${check.error}` });
      stampedById.set(cid, stampChecklist(check.value, req.user));
    }
    for (const [cid, stamped] of stampedById) {
      await writeApprovalChecklist(pool, req.labelId, cid, stamped);
    }
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE label_id = $2 AND status = 'pending' AND id = ANY($3::int[])
       RETURNING *`,
      [req.user.name, req.labelId, ids]
    );
    rows.forEach(r => bkAudit(req, r.id, 'approved', `bulk — ${r.payee} ${r.currency} ${r.amount} · checklist ${JSON.stringify(stampedById.get(r.id))}`));
    // Cascade approval to pending children of these parents (children are
    // hidden from the queue, so they can't be selected directly).
    await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = NOW()
        WHERE label_id = $2 AND parent_id = ANY($3::int[]) AND status = 'pending' AND (deleted = false OR deleted IS NULL)`,
      [req.user.name, req.labelId, ids]
    );
    // Apply any vendor-provided multi-artist allocation as real splits.
    for (const r of rows) {
      const parts = await applyBreakdownSplits(req.labelId, r, req.user.name);
      if (parts) bkAudit(req, r.id, 'split', `auto-split into ${parts} artists on approve`);
    }
    await logActivity(req, 'Bulk approved', `${rows.length} entries`);
    if (rows.length) {
      const sum = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
      activityBot.postEvent(req.labelId, {
        text: `✅ ${rows.length} invoice${rows.length === 1 ? '' : 's'} approved (${money(sum, rows[0].currency)}) — by ${req.user.name}`,
        icon: 'check', link: '/ledger',
      });
    }
    // Return the approved rows so the client can queue per-vendor emails.
    res.json({ success: true, data: { approved: rows.length, rows } });
  } catch (error) {
    console.error('Bulk approve error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/restore — undo a soft delete.
router.post('/entries/:id/restore', requireAdmin, async (req, res) => {
  try {
    // Un-delete (family-wide) AND revive a rejected entry back to pending.
    // Goes to 'pending', never straight to 'approved': a rejection was a
    // decision, and undoing it restores the QUESTION, not the opposite answer.
    // The rejection reason is deliberately KEPT (column + notes trail) — erasing
    // it would make a restored invoice indistinguishable from one that was
    // never rejected.
    const { rows } = await pool.query(
      `UPDATE expenses SET deleted = false, deleted_by = NULL, deleted_at = NULL,
         status = CASE WHEN status = 'rejected' THEN 'pending' ELSE status END
        WHERE label_id = $2 AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $1 AND label_id = $2)
        RETURNING *`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    bkAudit(req, parseInt(req.params.id, 10), 'restored', null);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/archive — rejected + soft-deleted entries with who/when
// attribution, for review and restore (admin surface).
router.get('/archive', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, payee, artist, invoice_number, amount, currency, category, status, payment_status,
              rejected_reason, rejected_by, rejected_at, approved_by, approved_at, deleted, deleted_by, deleted_at, created_at,
              (invoice_r2_key IS NOT NULL) AS has_invoice, (w9_r2_key IS NOT NULL) AS has_w9, (receipt_r2_key IS NOT NULL) AS has_receipt
         FROM expenses
        WHERE label_id = $1 AND (deleted = true OR status = 'rejected')
        ORDER BY COALESCE(deleted_at, approved_at, created_at) DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Archive error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/split — divide a parent entry into N slices of
// { artist, song?, amount }. The parent KEEPS the first slice (its amount is
// reduced) and the rest become children carrying parent_id. Family totals SUM
// every leaf (parent + children), so the slices must sum to the original
// amount. The pre-split state is snapshotted into artist_breakdown.origin so
// unsplit can restore it exactly.
router.post('/entries/:id/split', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const raw = Array.isArray(req.body.splits) ? req.body.splits : [];
    const splits = raw
      .map(s => ({ artist: (s.artist || '').trim(), song: (s.song || '').trim() || null, amount: parseFloat(s.amount) }))
      .filter(s => s.amount && s.amount > 0);
    if (splits.length < 2) return res.status(400).json({ success: false, error: 'Provide at least two slices with positive amounts' });

    await client.query('BEGIN');
    const { rows: prows } = await client.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2 AND parent_id IS NULL FOR UPDATE', [id, req.labelId]);
    if (!prows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Entry not found or already a child' }); }
    const parent = prows[0];
    // Re-split REPLACES the existing children in this same transaction (boom
    // behavior, LED-17) — refused only when a child carries its own files or
    // installments (deleting those rows would orphan real documents/payments).
    const { rows: existingKids } = await client.query(
      `SELECT id, amount, invoice_r2_key, receipt_r2_key, w9_r2_key, proof_r2_key, is_reimbursement
         FROM expenses WHERE parent_id = $1 AND label_id = $2 AND (deleted = false OR deleted IS NULL)`,
      [id, req.labelId]
    );
    let familyTotal = Number(parent.amount || 0);
    if (existingKids.length) {
      if (existingKids.some(k => k.invoice_r2_key || k.receipt_r2_key || k.w9_r2_key || k.proof_r2_key)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'A split has its own file attached — remove it before re-splitting' });
      }
      const inst = await client.query('SELECT 1 FROM payment_installments WHERE label_id = $1 AND expense_id = ANY($2::int[]) LIMIT 1', [req.labelId, existingKids.map(k => k.id)]);
      if (inst.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: 'A split has recorded payments — cannot re-split' });
      }
      familyTotal += existingKids.reduce((a, k) => a + Number(k.amount || 0), 0);
    }

    const total = splits.reduce((a, s) => a + s.amount, 0);
    if (Math.abs(total - familyTotal) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Slices (${total.toFixed(2)}) must sum to the entry amount (${familyTotal.toFixed(2)})` });
    }
    if (existingKids.length) await client.query('DELETE FROM expenses WHERE parent_id = $1 AND label_id = $2', [id, req.labelId]);

    // Snapshot the pre-split parent so unsplit restores it exactly. On a
    // re-split, keep the ORIGINAL origin — that's the true pre-split state.
    const prevSnap = parent.artist_breakdown && parent.artist_breakdown.origin ? parent.artist_breakdown.origin : null;
    const snapshot = { origin: prevSnap || { amount: Number(parent.amount), artist: parent.artist || null, song: parent.song || null }, splits };
    const [head, ...rest] = splits;

    // Parent takes the first slice; keep every other field intact.
    await client.query(
      `UPDATE expenses SET amount = $1, artist = COALESCE($2, artist), song = $3, artist_breakdown = $4::jsonb WHERE id = $5 AND label_id = $6`,
      [head.amount, head.artist || null, head.song, JSON.stringify(snapshot), id, req.labelId]
    );

    // Children inherit every classification + payment field so the family stays
    // coherent with item 1's cascade (a split of a Paid entry stays Paid).
    for (const s of rest) {
      await client.query(
        `INSERT INTO expenses (label_id, parent_id, invoice_date, payee, description, category, artist, song,
           invoice_number, amount, currency, payment_method, status, payment_status, is_reimbursement, recoupable,
           rep, notes, entry_source, cobrand, is_bulk_deal, payment_date, paid_by, payment_ref, fx_rate_to_usd,
           scheduled_payment_date, payment_terms, vendor_email, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW())`,
        [req.labelId, id, parent.invoice_date, parent.payee, parent.description, parent.category,
         s.artist || parent.artist, s.song, parent.invoice_number, s.amount, parent.currency,
         parent.payment_method, parent.status, parent.payment_status, parent.is_reimbursement, parent.recoupable,
         parent.rep, parent.notes, parent.entry_source, parent.cobrand, parent.is_bulk_deal, parent.payment_date,
         parent.paid_by, parent.payment_ref, parent.fx_rate_to_usd, parent.scheduled_payment_date, parent.payment_terms,
         parent.vendor_email, req.user.name]
      );
    }
    await client.query('COMMIT');
    await logActivity(req, 'Split ledger entry', `${parent.payee} → ${splits.length} slices`, { entryPayee: parent.payee });
    bkAudit(req, id, 'split', `${splits.length} slices`);
    res.json({ success: true, data: { slices: splits.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Split error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/ledger/entries/:id/splits — merge children back into the parent.
// Refuses if any child carries its own files or payment installments (those
// would be orphaned). Restores the parent amount/artist/song from the snapshot.
router.delete('/entries/:id/splits', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    await client.query('BEGIN');
    const { rows: prows } = await client.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2 AND parent_id IS NULL FOR UPDATE', [id, req.labelId]);
    if (!prows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Entry not found' }); }
    const parent = prows[0];
    const { rows: kids } = await client.query('SELECT * FROM expenses WHERE parent_id = $1 AND label_id = $2', [id, req.labelId]);
    if (!kids.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'This entry is not split' }); }

    // Refuse when a child carries its own attachments — EXCEPT the fee/reimb
    // carve-off's receipt child, whose receipt travels back to the parent
    // (boom's split-fee-reimb round trip, LED-32).
    let pullReceipt = null;
    const withFiles = kids.filter(k => {
      if (k.invoice_r2_key || k.w9_r2_key || k.proof_r2_key) return true;
      if (k.receipt_r2_key) {
        if (k.is_reimbursement && !parent.receipt_r2_key && !pullReceipt) { pullReceipt = k; return false; }
        return true;
      }
      return false;
    });
    if (withFiles.length) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: 'A split has its own file attached — remove it before unsplitting' }); }
    // …or its own recorded installments.
    const kidIds = kids.map(k => k.id);
    const inst = await client.query('SELECT 1 FROM payment_installments WHERE label_id = $1 AND expense_id = ANY($2::int[]) LIMIT 1', [req.labelId, kidIds]);
    if (inst.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: 'A split has recorded payments — cannot unsplit' }); }

    // Restore from the snapshot; fall back to summing the live rows for legacy splits.
    const snap = parent.artist_breakdown && parent.artist_breakdown.origin ? parent.artist_breakdown.origin : null;
    const restoredAmount = snap ? Number(snap.amount) : (Number(parent.amount || 0) + kids.reduce((a, k) => a + Number(k.amount || 0), 0));
    // no_auto_split: the restored song may contain the comma that split it —
    // without the guard, the next inline edit would immediately re-split (LED-16).
    await client.query(
      `UPDATE expenses SET amount = $1, artist = $2, song = $3, artist_breakdown = NULL, no_auto_split = TRUE,
              receipt_r2_key = COALESCE(receipt_r2_key, $6), receipt_filename = COALESCE(receipt_filename, $7)
        WHERE id = $4 AND label_id = $5`,
      [restoredAmount, snap ? snap.artist : parent.artist, snap ? snap.song : parent.song, id, req.labelId,
       pullReceipt ? pullReceipt.receipt_r2_key : null, pullReceipt ? pullReceipt.receipt_filename : null]
    );
    await client.query('DELETE FROM expenses WHERE parent_id = $1 AND label_id = $2', [id, req.labelId]);
    await client.query('COMMIT');
    await logActivity(req, 'Unsplit ledger entry', parent.payee, { entryPayee: parent.payee });
    bkAudit(req, id, 'unsplit', `merged ${kids.length} slices`);
    res.json({ success: true, data: { removed: kids.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Unsplit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/ledger/entries/:id/split-fee-reimb — carve a reimbursement out of
// an existing invoice (boom parity, LED-32). Fee + reimbursement must equal
// the entry total, the receipt is REQUIRED (a reimbursement is a claim against
// a receipt), and the carve becomes an is_reimbursement child carrying it.
// Unsplit pulls the receipt back to the parent; re-split refuses while the
// receipt child exists (both above).
router.post('/entries/:id/split-fee-reimb', upload.single('receipt'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const fee = parseFloat(req.body.fee_amount);
    const reimb = parseFloat(req.body.reimb_amount);
    if (!(fee > 0) || !(reimb > 0)) return res.status(400).json({ success: false, error: 'Fee and reimbursement must both be positive' });
    if (!req.file) return res.status(400).json({ success: false, error: 'A receipt is required — the reimbursement is a claim against it' });

    await client.query('BEGIN');
    const { rows: prows } = await client.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2 AND parent_id IS NULL FOR UPDATE', [id, req.labelId]);
    if (!prows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Entry not found or already a child' }); }
    const parent = prows[0];
    const kid = await client.query('SELECT 1 FROM expenses WHERE parent_id = $1 LIMIT 1', [id]);
    if (kid.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: 'This entry is already split — unsplit it first' }); }
    if (Math.abs(fee + reimb - Number(parent.amount || 0)) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Fee (${fee.toFixed(2)}) + reimbursement (${reimb.toFixed(2)}) must equal the entry amount (${Number(parent.amount).toFixed(2)})` });
    }

    const stored = await storeFile(req.labelId, req.file, 'receipt');
    const snapshot = {
      origin: { amount: Number(parent.amount), artist: parent.artist || null, song: parent.song || null },
      splits: [{ artist: parent.artist || null, song: parent.song || null, amount: fee }, { artist: parent.artist || null, song: parent.song || null, amount: reimb, reimbursement: true }],
    };
    await client.query(
      `UPDATE expenses SET amount = $1, artist_breakdown = $2::jsonb WHERE id = $3 AND label_id = $4`,
      [fee, JSON.stringify(snapshot), id, req.labelId]
    );
    await client.query(
      `INSERT INTO expenses (label_id, parent_id, invoice_date, payee, description, category, artist, song,
         invoice_number, amount, currency, payment_method, status, payment_status, is_reimbursement, recoupable,
         rep, notes, entry_source, cobrand, is_bulk_deal, payment_date, paid_by, payment_ref, fx_rate_to_usd,
         scheduled_payment_date, payment_terms, vendor_email, approved_by, approved_at,
         receipt_r2_key, receipt_filename, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,NOW())`,
      [req.labelId, id, parent.invoice_date, parent.payee, parent.description ? `${parent.description} (reimbursement)` : 'Reimbursement carve-off',
       parent.category, parent.artist, parent.song, parent.invoice_number, reimb, parent.currency,
       parent.payment_method, parent.status, parent.payment_status, parent.recoupable,
       parent.rep, parent.notes, parent.entry_source, parent.cobrand, parent.is_bulk_deal, parent.payment_date,
       parent.paid_by, parent.payment_ref, parent.fx_rate_to_usd, parent.scheduled_payment_date, parent.payment_terms,
       parent.vendor_email, parent.approved_by, parent.approved_at, stored.key, stored.filename, req.user.name]
    );
    await client.query('COMMIT');
    await logActivity(req, 'Carved reimbursement off invoice', `${parent.payee} — fee ${fee.toFixed(2)} / reimb ${reimb.toFixed(2)}`);
    bkAudit(req, id, 'split-fee-reimb', `fee ${fee.toFixed(2)} + reimb ${reimb.toFixed(2)}`);
    res.json({ success: true, data: { fee, reimb } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Split fee/reimb error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/ledger/import — bulk create entries from parsed rows (CSV wizard
// on the client posts a JSON array). Inserted in one transaction.
router.post('/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ success: false, error: 'No rows to import' });
    if (rows.length > 1000) return res.status(400).json({ success: false, error: 'Too many rows (max 1000 per import)' });

    await client.query('BEGIN');
    let inserted = 0;
    for (const r of rows) {
      if (!r.payee || !r.amount) continue;
      await client.query(
        `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, invoice_number,
           amount, currency, payment_method, status, payment_status, rep, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'USD'),$10,COALESCE($11,'approved'),COALESCE($12,'Unpaid'),$13,$14,$15,NOW())`,
        [req.labelId, r.invoice_date || null, String(r.payee).trim(), r.description || null, r.category || null,
         r.artist || null, r.invoice_number || null, parseFloat(r.amount) || 0, r.currency || null,
         r.payment_method || null, r.status || null, r.payment_status || null, r.rep || null, r.notes || null, req.user.name]
      );
      inserted += 1;
    }
    await client.query('COMMIT');
    await logActivity(req, 'Imported ledger entries', `${inserted} rows`);
    res.status(201).json({ success: true, data: { inserted } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import error:', error);
    res.status(500).json({ success: false, error: 'Import failed' });
  } finally {
    client.release();
  }
});

// The label's own vocabulary, for steering the extractions: active expense
// categories + every artist name in use (roster ∪ ledger). Roster alone is the
// wrong test — an artist can own ledger lines before ever being signed.
async function labelVocabulary(labelId) {
  const [cats, roster, ledgerArtists] = await Promise.all([
    pool.query(`SELECT name FROM categories WHERE label_id = $1 AND kind = 'expense' AND active IS NOT FALSE ORDER BY sort_order NULLS LAST, id`, [labelId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT name FROM artists WHERE label_id = $1 AND archived IS NOT TRUE`, [labelId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT DISTINCT TRIM(artist) AS name FROM expenses
                 WHERE label_id = $1 AND artist IS NOT NULL AND TRIM(artist) <> ''
                   AND (deleted = false OR deleted IS NULL)`, [labelId]).catch(() => ({ rows: [] })),
  ]);
  const artists = [...new Set([...roster.rows, ...ledgerArtists.rows].map(r => String(r.name || '').trim()).filter(n => n.length >= 2))];
  return { categories: cats.rows.map(r => r.name), artists };
}

// POST /api/ledger/parse-invoice — AI-extract fields from an uploaded invoice
// (for auto-filling the add-entry form). Does not persist anything. Always
// answers 200 with ai_status so the client can tell "AI not configured" /
// "AI errored" / "ran but found nothing" apart (boom's /parse contract).
async function parseInvoiceRoute(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!claude.isEnabled()) return res.json({ success: true, data: {}, ai_status: 'disabled', ai_error: 'AI is not configured on the server', ai_warnings: [], suggest_socials: [] });
    const vocab = await labelVocabulary(req.labelId);
    const r = await claude.parseInvoice({ buffer: req.file.buffer, mimeType: req.file.mimetype, categories: vocab.categories, roster: vocab.artists });
    const d = r.ok ? { ...(r.data || {}) } : {};
    // Post-validation, never trust: a @handle in the artist slot is a social,
    // not an artist — moved aside with a warning instead of landing on the row.
    const warnings = [];
    const suggestSocials = [];
    if (d.artist && /^@/.test(String(d.artist).trim())) {
      suggestSocials.push(String(d.artist).trim());
      warnings.push(`"${d.artist}" looks like a social handle, not an artist — moved to socials`);
      d.artist = null;
    }
    // And an artist the label has never used is a guess — checked against the
    // known list rather than trusted, same posture as boom's roster validation.
    if (d.artist && vocab.artists.length) {
      const known = vocab.artists.find(a => a.toLowerCase() === String(d.artist).trim().toLowerCase());
      if (known) d.artist = known;
      else { warnings.push(`"${d.artist}" is not a known artist — left blank for you to confirm`); d.artist = null; }
    }
    res.json({
      success: true,
      data: d,
      ai_status: r.ok ? 'ok' : 'error',
      ai_error: r.ok ? null : (r.error || null),
      ai_warnings: warnings,
      suggest_socials: suggestSocials,
    });
  } catch (error) {
    console.error('Parse invoice error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// POST /api/ledger/validate-invoice — is this document actually an invoice,
// billed to the label, with the basics on it? FAILS OPEN (valid:true) when AI
// is unavailable — a hiccup must never block filing; the dup gate + review
// still stand behind it.
async function validateInvoiceRoute(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const open = { valid: true, issues: [], ai: false };
    if (!claude.isEnabled()) return res.json({ success: true, data: open });
    const { rows } = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const r = await claude.validateInvoiceDoc({ buffer: req.file.buffer, mimeType: req.file.mimetype, labelName: rows[0]?.name });
    if (!r.ok) return res.json({ success: true, data: open });
    const d = r.data || {};
    const issues = (Array.isArray(d.issues) ? d.issues : []).map(x => String(x || '').trim()).filter(Boolean);
    res.json({ success: true, data: { valid: d.valid !== false, issues, is_invoice: d.is_invoice, billed_to: d.billed_to || null, ai: true } });
  } catch (error) {
    console.error('Validate invoice error:', error);
    res.json({ success: true, data: { valid: true, issues: [], ai: false } });
  }
}

// POST /api/ledger/validate-w9 — auto-check a W9/W8 the moment it's attached
// (form type, signature, name match). Same fail-open posture as above.
async function validateW9Route(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const open = { valid: true, issues: [], ai: false };
    if (!claude.isEnabled()) return res.json({ success: true, data: open });
    const vendorName = String(req.body?.vendor_name || req.query.vendor_name || '').trim();
    const r = await claude.validateW9({ buffer: req.file.buffer, mimeType: req.file.mimetype, vendorName: vendorName || 'the payee' });
    if (!r.ok) return res.json({ success: true, data: open });
    const d = r.data || {};
    const issues = [];
    const formType = String(d.form_type || '').toUpperCase();
    if (formType && !formType.startsWith('W-9') && !formType.startsWith('W-8') && !formType.startsWith('W9') && !formType.startsWith('W8')) {
      issues.push(`This looks like "${d.form_type}", not a W-9 / W-8 form`);
    }
    if (d.has_signature === false) issues.push('The form is not signed');
    if (vendorName && d.name_matches === false) issues.push(`Name on the form (${d.legal_name || 'unknown'}) doesn't match "${vendorName}"`);
    res.json({ success: true, data: { valid: issues.length === 0, issues, form_type: d.form_type || null, legal_name: d.legal_name || null, ai: true } });
  } catch (error) {
    console.error('Validate W9 error:', error);
    res.json({ success: true, data: { valid: true, issues: [], ai: false } });
  }
}

// POST /api/ledger/parse-proof — extract payment date/method/reference off a
// proof-of-payment document, for prefilling the Mark-as-Paid fields.
async function parseProofRoute(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!claude.isEnabled()) return res.json({ success: true, data: {} });
    const r = await claude.parseProof({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!r.ok) { if (r.error) console.warn('AI parse-proof:', r.error); return res.json({ success: true, data: {} }); }
    const d = r.data || {};
    const METHODS = ['ACH', 'Check', 'Wire', 'Credit Card', 'PayPal', 'Cash'];
    const method = METHODS.find(m => m.toLowerCase() === String(d.payment_method || '').trim().toLowerCase()) || null;
    res.json({ success: true, data: {
      payment_date: /^\d{4}-\d{2}-\d{2}/.test(String(d.payment_date || '')) ? String(d.payment_date).slice(0, 10) : null,
      payment_method: method,
      reference_number: String(d.reference_number || '').trim() || null,
      amount: typeof d.amount === 'number' ? d.amount : null,
      // Who the proof says was paid — the schema always extracted it; Bulk
      // Upload's proof→invoice auto-match needs it (payee AND amount must
      // agree, boom's rule). Additive for the single-entry consumer.
      payee: String(d.payee || '').trim() || null,
    } });
  } catch (error) {
    console.error('Parse proof error:', error);
    res.json({ success: true, data: {} });
  }
}

// POST /api/ledger/parse-lines — the line items inside a multi-line invoice,
// for the Add Invoice line-item editor. Divergence from boom (documented in
// lib/claude.js): amounts here are AI-extracted rather than read from PDF text
// deterministically (no PDF-text dependency in cadence), so the server reports
// the tie-out against the document's printed total and the client puts every
// line in front of a human — nothing is saved unreviewed.
async function parseLinesRoute(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    const vocab = await labelVocabulary(req.labelId);
    const r = await claude.parseInvoiceLines({ buffer: req.file.buffer, mimeType: req.file.mimetype, categories: vocab.categories, roster: vocab.artists });
    if (!r.ok) return res.status(502).json({ success: false, error: r.error || 'Could not read line items' });
    const raw = Array.isArray(r.data?.lines) ? r.data.lines : [];
    const lines = raw
      .map((l, i) => ({
        n: i + 1,
        description: String(l?.description || '').trim(),
        amount: typeof l?.amount === 'number' ? Math.round(l.amount * 100) / 100 : null,
        date: /^\d{4}-\d{2}-\d{2}/.test(String(l?.date || '')) ? String(l.date).slice(0, 10) : null,
        category: vocab.categories.find(c => c.toLowerCase() === String(l?.category || '').trim().toLowerCase()) || null,
        // A hallucinated or mis-spelled artist becomes null, not a new artist.
        artist: vocab.artists.find(a => a.toLowerCase() === String(l?.artist || '').trim().toLowerCase()) || null,
        // Recoupable defaults ON only when the line names an artist — the column
        // defaults TRUE in the DB, so defaulting it here would put subscriptions
        // and rides onto Recoupments against nobody.
      }))
      .map(l => ({ ...l, recoupable: !!l.artist }))
      .filter(l => l.description || l.amount != null);
    const printedTotal = typeof r.data?.printed_total === 'number' ? Math.round(r.data.printed_total * 100) / 100 : null;
    const sum = Math.round(lines.reduce((a, l) => a + (l.amount || 0), 0) * 100) / 100;
    const reconciles = printedTotal != null && Math.abs(sum - printedTotal) <= 0.02;
    res.json({ success: true, data: {
      lines,
      printed_total: printedTotal,
      lines_total: sum,
      reconciles,
      reason: printedTotal == null ? 'no printed total found on the document' : (reconciles ? null : `lines sum to ${sum.toFixed(2)}, document prints ${printedTotal.toFixed(2)}`),
      labels_from: 'ai',
    } });
  } catch (error) {
    console.error('Parse lines error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// GET /api/ledger/vendor-w9-status?payee= — does this vendor (or any of their
// aliases) already have a W9 on file? Drives the "already on file — only
// upload if updated" state on the Add Invoice W9 tile. Booleans only.
async function vendorW9StatusRoute(req, res) {
  try {
    const payee = String(req.query.payee || '').trim();
    if (!payee) return res.json({ success: true, data: { has_w9: false } });
    // Names to check: the payee plus alias resolutions in both directions.
    const { rows: aliasRows } = await pool.query(
      `SELECT canonical AS name FROM vendor_aliases WHERE label_id = $1 AND LOWER(TRIM(alias)) = LOWER(TRIM($2))
       UNION
       SELECT alias AS name FROM vendor_aliases WHERE label_id = $1 AND LOWER(TRIM(canonical)) = LOWER(TRIM($2))`,
      [req.labelId, payee]
    );
    const names = [payee, ...aliasRows.map(r => r.name)].filter(Boolean);
    const { rows: vend } = await pool.query(
      `SELECT name, w9_filename FROM vendors WHERE label_id = $1 AND LOWER(TRIM(name)) = ANY($2) AND w9_r2_key IS NOT NULL LIMIT 1`,
      [req.labelId, names.map(n => n.toLowerCase().trim())]
    );
    if (vend.length) return res.json({ success: true, data: { has_w9: true, source: 'vendor', vendor: vend[0].name, w9_filename: vend[0].w9_filename } });
    const { rows: exp } = await pool.query(
      `SELECT id, w9_filename FROM expenses
        WHERE label_id = $1 AND LOWER(TRIM(payee)) = ANY($2) AND w9_r2_key IS NOT NULL
          AND (deleted = false OR deleted IS NULL)
        ORDER BY id DESC LIMIT 1`,
      [req.labelId, names.map(n => n.toLowerCase().trim())]
    );
    if (exp.length) return res.json({ success: true, data: { has_w9: true, source: 'entry', entry_id: exp[0].id, w9_filename: exp[0].w9_filename } });
    res.json({ success: true, data: { has_w9: false } });
  } catch (error) {
    console.error('Vendor W9 status error:', error);
    res.json({ success: true, data: { has_w9: false } });
  }
}

// POST /api/ledger/entries/:id/scan?type=invoice|w9 — AI-check the stored file
// against the entry (invoice discrepancies, or W9 name/type/signature).
router.post('/entries/:id/scan', async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    const type = req.query.type === 'w9' ? 'w9' : 'invoice';
    const col = type === 'w9' ? 'w9_r2_key' : 'invoice_r2_key';
    const { rows } = await pool.query(`SELECT payee, amount, currency, invoice_number, ${col} AS key FROM expenses WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    if (!rows[0].key) return res.status(400).json({ success: false, error: `No ${type} file on this entry` });
    const buffer = await loadFileBuffer(rows[0].key, null);
    if (!buffer) return res.status(404).json({ success: false, error: 'File not found' });
    // Infer mime from the key extension (R2 keys preserve the original name).
    const mimeType = /\.pdf$/i.test(rows[0].key) ? 'application/pdf' : (/\.png$/i.test(rows[0].key) ? 'image/png' : 'image/jpeg');
    const r = type === 'w9'
      ? await claude.validateW9({ buffer, mimeType, vendorName: rows[0].payee })
      : await claude.scanInvoice({ buffer, mimeType, entry: rows[0] });
    if (!r.ok) return res.status(502).json({ success: false, error: r.error || 'Scan failed' });
    res.json({ success: true, data: r.data });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── AI discrepancy scans (persisted) ──────────────────────────────────────

// POST /api/ledger/entries/:id/rescan?type=invoice|w9|both — run the AI
// discrepancy scan and STORE the result on the entry (ai_scan / w9_scan).
router.post('/entries/:id/rescan', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const type = req.query.type || 'both';
    const out = {};
    if (type === 'invoice' || type === 'both') out.invoice = await aiScan.rescanInvoice(req.labelId, id);
    if (type === 'w9' || type === 'both') out.w9 = await aiScan.rescanW9(req.labelId, id);
    await logActivity(req, 'AI rescan', `entry ${id} (${type})`);
    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Rescan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/dismiss-scan — clear AI discrepancy warnings.
//   ?type=invoice|w9|both (or body.type) — NULL the whole scan column(s)
//   body.discrepancy { field, form_value, document_value } — remove ONLY the
//   matching item, preserving unrelated discrepancies and the summary /
//   scanned_at metadata (single-item JSONB rebuild, boom parity). Audited.
router.post('/entries/:id/dismiss-scan', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const type = req.body?.type || req.query.type || 'both';
    const discrepancy = req.body?.discrepancy;
    if (discrepancy && discrepancy.field != null) {
      const column = type === 'w9' ? 'w9_scan' : type === 'invoice' ? 'ai_scan' : null;
      if (!column) return res.status(400).json({ success: false, error: 'type must be "invoice" or "w9" for a single-discrepancy dismiss' });
      const { rowCount } = await pool.query(
        `UPDATE expenses SET ${column} = jsonb_set(
            ${column}, '{discrepancies}',
            COALESCE((SELECT jsonb_agg(d) FROM jsonb_array_elements(${column}->'discrepancies') d
              WHERE NOT (d->>'field' = $3
                AND COALESCE(d->>'form_value','') = COALESCE($4,'')
                AND COALESCE(d->>'document_value','') = COALESCE($5,''))), '[]'::jsonb))
          WHERE id = $1 AND label_id = $2 AND ${column} IS NOT NULL`,
        [id, req.labelId, String(discrepancy.field),
         discrepancy.form_value == null ? null : String(discrepancy.form_value),
         discrepancy.document_value == null ? null : String(discrepancy.document_value)]
      );
      if (!rowCount) return res.status(404).json({ success: false, error: 'Entry or scan not found' });
      bkAudit(req, id, 'scan_dismissed', `${column}: ${discrepancy.field}`);
      return res.json({ success: true });
    }
    const cols = [];
    if (type === 'invoice' || type === 'both') cols.push('ai_scan = NULL');
    if (type === 'w9' || type === 'both') cols.push('w9_scan = NULL');
    if (!cols.length) return res.status(400).json({ success: false, error: 'Nothing to dismiss' });
    const { rowCount } = await pool.query(`UPDATE expenses SET ${cols.join(', ')} WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Entry not found' });
    bkAudit(req, id, 'scan_dismissed', type);
    res.json({ success: true });
  } catch (error) {
    console.error('Dismiss scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/flagged — entries whose stored scans found discrepancies.
router.get('/flagged', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, payee, amount, currency, invoice_number, status, ai_scan, w9_scan
         FROM expenses
        WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
          AND ((ai_scan IS NOT NULL AND jsonb_array_length(COALESCE(ai_scan->'discrepancies','[]')) > 0)
            OR (w9_scan IS NOT NULL AND jsonb_array_length(COALESCE(w9_scan->'discrepancies','[]')) > 0))
        ORDER BY id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Flagged error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Duplicate-invoice check ────────────────────────────────────────────────

// GET /api/ledger/check-dup?payee=&invoice_number=[&exclude=] — does an entry
// already exist for this payee + normalized invoice#? Used by the add forms
// and the vendor portal to stop double submissions. Two tiers (boom parity):
// `match` is an exact normalized duplicate; `similar` lists invoices whose
// numbers normalize the same but are formatted differently ("INV-003" vs
// "#003"). Alias-aware and family-root-resolved — see findDuplicateInvoice.
async function checkDupRoute(req, res) {
  try {
    const payee = String(req.query.payee || '').trim();
    const num = String(req.query.invoice_number || '').trim();
    const key = normInv(num);
    if (!payee || !key) return res.json({ success: true, data: { duplicate: false, match: null, similar: [] } });
    const exclude = parseInt(req.query.exclude, 10) || 0;
    const { rows } = await pool.query(
      `${DUP_FAMILY_SELECT}
        WHERE e.label_id = $1 AND ${vendorMatchSql('$2')}
          AND e.invoice_number IS NOT NULL AND e.invoice_number <> ''
          AND (e.deleted = false OR e.deleted IS NULL)
          AND (r.deleted = false OR r.deleted IS NULL)
          AND e.status <> 'rejected'
          AND r.id <> $3 AND e.id <> $3`,
      [req.labelId, payee, exclude]
    );
    // De-duplicate by family ROOT — an 8-row split family must not list the
    // same invoice 8 times.
    const seen = new Set();
    let match = null;
    const similar = [];
    for (const r of rows) {
      const matched = r.matched_invoice_number || r.invoice_number;
      if (normInv(matched) !== key) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const { matched_invoice_number, ...entry } = r;
      if (String(matched).trim().toLowerCase() === num.toLowerCase()) { if (!match) match = entry; }
      else similar.push(entry);
    }
    // An exact-format hit is THE duplicate; different-format hits are the
    // "similar" tier (still the same normalized number — the softer warning).
    if (!match && similar.length) {
      res.json({ success: true, data: { duplicate: false, match: null, similar } });
    } else {
      res.json({ success: true, data: { duplicate: !!match, match, similar: match ? similar : [] } });
    }
  } catch (error) {
    console.error('Dup check error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ── Rush / expedited payment ───────────────────────────────────────────────

// POST /api/ledger/entries/:id/rush — flag for expedited payment.
router.post('/entries/:id/rush', async (req, res) => {
  try {
    // rush/hold are mutually exclusive — flagging rush clears any hold — and
    // the flag cascades to the whole split family so members never disagree.
    const id = parseInt(req.params.id, 10);
    if (!(await canActOnEntry(req, id))) {
      return res.status(403).json({ success: false, error: 'You do not have visibility into this entry' });
    }
    const root = await familyRoot(pool, id, req.labelId);
    if (!root) return res.status(404).json({ success: false, error: 'Entry not found' });
    // A Paid row has nothing left to expedite — refusing beats a stale badge.
    const { rows: cur } = await pool.query('SELECT payment_status FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (cur[0]?.payment_status === 'Paid') {
      return res.status(400).json({ success: false, error: 'This entry is already paid — there is nothing to rush' });
    }
    await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
      rush: true, rush_reason: String(req.body.reason || '').trim().slice(0, 500) || null, rush_needed_by: req.body.needed_by || null,
      rush_by: req.user.name, rush_at: new Date(), on_hold: false, hold_reason: null, hold_by: null, hold_at: null,
    });
    const { rows } = await pool.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await logActivity(req, 'Flagged rush', `${rows[0].payee} — ${rows[0].amount}`, { entryPayee: rows[0].payee });
    bkAudit(req, id, 'rush', req.body.reason ? String(req.body.reason).slice(0, 200) : null);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Rush error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/entries/:id/rush — clear the rush flag.
router.delete('/entries/:id/rush', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await canActOnEntry(req, id))) {
      return res.status(403).json({ success: false, error: 'You do not have visibility into this entry' });
    }
    const root = await familyRoot(pool, id, req.labelId);
    if (!root) return res.status(404).json({ success: false, error: 'Entry not found' });
    await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
      rush: false, rush_reason: null, rush_needed_by: null, rush_by: null, rush_at: null,
    });
    bkAudit(req, id, 'rush_cleared', null);
    res.json({ success: true });
  } catch (error) {
    console.error('Clear rush error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/rush-bulk { ids:[], reason } — rush several at once.
router.post('/rush-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    // Paid rows are SKIPPED, not flagged — and the caller is told how many
    // (boom's rushed/skipped accounting), so "3 of 5 flagged" is sayable.
    const { rowCount } = await pool.query(
      `UPDATE expenses SET rush = TRUE, rush_reason = $1, rush_needed_by = $2, rush_by = $3, rush_at = NOW(),
         on_hold = FALSE, hold_reason = NULL, hold_by = NULL, hold_at = NULL
         WHERE label_id = $4 AND id = ANY($5::int[]) AND payment_status IS DISTINCT FROM 'Paid'`,
      [String(req.body.reason || '').trim().slice(0, 500) || null, req.body.needed_by || null, req.user.name, req.labelId, ids]
    );
    await logActivity(req, 'Bulk rush', `${rowCount} entries`);
    res.json({ success: true, data: { rushed: rowCount, skipped: ids.length - rowCount } });
  } catch (error) {
    console.error('Bulk rush error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/hold — pause payment (clears any rush).
router.post('/entries/:id/hold', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const root = await familyRoot(pool, id, req.labelId);
    if (!root) return res.status(404).json({ success: false, error: 'Entry not found' });
    // Same Paid guard as rush — a paid row has nothing left to pause.
    const { rows: cur } = await pool.query('SELECT payment_status FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (cur[0]?.payment_status === 'Paid') {
      return res.status(400).json({ success: false, error: 'This entry is already paid — there is nothing to hold' });
    }
    await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
      on_hold: true, hold_reason: String(req.body.reason || '').trim().slice(0, 500) || null, hold_by: req.user.name, hold_at: new Date(),
      rush: false, rush_reason: null, rush_needed_by: null, rush_by: null, rush_at: null,
    });
    const { rows } = await pool.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await logActivity(req, 'Put payment on hold', `${rows[0].payee} — ${rows[0].amount}`, { entryPayee: rows[0].payee });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Hold error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/entries/:id/hold — release the hold.
router.delete('/entries/:id/hold', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const root = await familyRoot(pool, id, req.labelId);
    if (!root) return res.status(404).json({ success: false, error: 'Entry not found' });
    await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
      on_hold: false, hold_reason: null, hold_by: null, hold_at: null,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Clear hold error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/hold-bulk { ids:[], reason }
router.post('/hold-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rowCount } = await pool.query(
      `UPDATE expenses SET on_hold = TRUE, hold_reason = $1, hold_by = $2, hold_at = NOW(),
         rush = FALSE, rush_reason = NULL, rush_needed_by = NULL, rush_by = NULL, rush_at = NULL
         WHERE label_id = $3 AND id = ANY($4::int[]) AND payment_status IS DISTINCT FROM 'Paid'`,
      [String(req.body.reason || '').trim().slice(0, 500) || null, req.user.name, req.labelId, ids]
    );
    await logActivity(req, 'Bulk hold', `${rowCount} entries`);
    res.json({ success: true, data: { held: rowCount, skipped: ids.length - rowCount } });
  } catch (error) {
    console.error('Bulk hold error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/payment-stats — USD-equivalent headline totals for the
// payment dashboard cards. Honors the locked fx_rate_to_usd on paid rows;
// falls back to live conversion otherwise.
router.get('/payment-stats', async (req, res) => {
  try {
    // Same population as /payables — family HEADS with the family total, same
    // entry_source exclusions — so the cards can reconcile with the table
    // (split children were previously each counted as their own "invoice").
    // The paid window is widened to the current calendar MONTH so the "Paid
    // this month" card (boom parity) has its data; the linger-count still uses
    // PAID_GRACE_DAYS.
    const { rows } = await pool.query(
      `SELECT e.currency, e.fx_rate_to_usd, e.payment_date, e.invoice_date, e.scheduled_payment_date,
              e.payment_status, e.rush, e.on_hold, e.paid_marked_at,
              (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS amount
         FROM expenses e
        WHERE e.label_id = $1 AND e.status = 'approved' AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
          AND e.parent_id IS NULL
          AND (e.entry_source IS NULL OR e.entry_source NOT IN ('creator_payment', 'bank_statement', 'recoupments', 'artist_campaigns'))
          AND (e.payment_status IN ('Unpaid','Partial')
            OR (e.payment_status = 'Paid'
                AND (COALESCE(e.paid_marked_at, e.payment_date::timestamp, e.created_at) >= NOW() - INTERVAL '${PAID_GRACE_DAYS} days'
                  OR date_trunc('month', COALESCE(e.payment_date::timestamp, e.paid_marked_at)) = date_trunc('month', NOW()))))`,
      [req.labelId]
    );
    const usd = (r) => (r.fx_rate_to_usd ? Number(r.amount) / Number(r.fx_rate_to_usd) : toUSD(r.amount, r.currency, r.payment_date || r.invoice_date));
    // pg returns DATE columns as JS Date objects — String() on those yields a
    // locale string ("Wed Aug 26…"), which silently breaks every <= compare.
    const iso = (d) => (d instanceof Date ? d.toISOString() : String(d || ''));
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);
    const in7 = new Date(); in7.setDate(in7.getDate() + 7); const in7s = in7.toISOString().slice(0, 10);
    const acc = {
      outstanding: 0, overdue: 0, duesoon: 0, rush: 0, hold: 0, paidRecent: 0, paidMonth: 0,
      counts: { unpaid: 0, overdue: 0, duesoon: 0, rush: 0, hold: 0, paidRecent: 0, paidMonth: 0 },
      // Per-currency NATIVE totals per bucket — never netted into one number.
      // A label owing 40k USD + 3k GBP is not owing "43k of anything" (boom's
      // fmtTotals rule); the USD headline is a convenience on top.
      native: { outstanding: {}, overdue: {}, duesoon: {}, paidMonth: {} },
    };
    const nat = (bucket, r) => { const c = r.currency || 'USD'; acc.native[bucket][c] = (acc.native[bucket][c] || 0) + Number(r.amount || 0); };
    for (const r of rows) {
      const u = await usd(r);
      if (r.payment_status === 'Paid') {
        const paidOn = iso(r.payment_date || r.paid_marked_at).slice(0, 7);
        if (paidOn === thisMonth) { acc.paidMonth += u; acc.counts.paidMonth++; nat('paidMonth', r); }
        const linger = new Date(r.paid_marked_at || r.payment_date || 0).getTime() >= Date.now() - PAID_GRACE_DAYS * 86400000;
        if (linger) { acc.paidRecent += u; acc.counts.paidRecent++; }
        continue;
      }
      acc.outstanding += u; acc.counts.unpaid++; nat('outstanding', r);
      if (r.on_hold) { acc.hold += u; acc.counts.hold++; continue; }
      if (r.rush) { acc.rush += u; acc.counts.rush++; }
      const sched = r.scheduled_payment_date ? iso(r.scheduled_payment_date).slice(0, 10) : null;
      if (sched && sched < today) { acc.overdue += u; acc.counts.overdue++; nat('overdue', r); }
      else if (sched && sched <= in7s) { acc.duesoon += u; acc.counts.duesoon++; nat('duesoon', r); }
    }
    res.json({ success: true, data: acc });
  } catch (error) {
    console.error('Payment stats error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/payment-analytics — submissions-per-week (entries created)
// and paid-per-week (by payment_date). Week boundaries are anchored in the
// label's timezone (default America/Los_Angeles) so Sunday-night entries
// don't drift into the next week the way a UTC anchor caused.
//
// Defaults to the trailing 12 weeks; optional ?from/?to (YYYY-MM-DD) widen it
// for the Invoice Search charts (span clamped to 2 years, a missing side is
// filled 12 weeks from the given one). Each bucket carries week_end plus a
// vendor/admin split (counts and USD sums) so a clicked bar can filter a list
// to its exact Mon–Sun window — `week`/`count`/`amount` keep their old
// meaning, so Payments.jsx's paramless 12-week consumption is unchanged.
// Amounts are FAMILY totals (parent slice + live children, at the family's
// locked rate) so the charts tie to the invoice list's family framing.
router.get('/payment-analytics', async (req, res) => {
  try {
    const tzRow = await pool.query(`SELECT COALESCE(settings->>'timezone','America/Los_Angeles') AS tz FROM labels WHERE id = $1`, [req.labelId]);
    const tz = tzRow.rows[0]?.tz || 'America/Los_Angeles';
    // Optional range. Garbage params fall back to the default window rather
    // than erroring — the charts should always render something.
    const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const shift = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    let from = isIso(req.query.from) ? req.query.from : null;
    let to   = isIso(req.query.to)   ? req.query.to   : null;
    if (from && !to) to = shift(from, 83);   // 12 weeks from the given side
    if (to && !from) from = shift(to, -83);
    if (from && to) {
      if (from > to) { const t = from; from = to; to = t; }
      const spanDays = (new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000;
      if (spanDays > 730) from = shift(to, -730); // 2-year clamp — a bad param can't runaway the query
    }
    const ranged = !!(from && to);
    // Family total in USD at the parent's locked rate. Unstamped rows (unpaid
    // foreign) pass through at face value — same trade the old chart made.
    const famUsd = `(CASE WHEN e.fx_rate_to_usd IS NOT NULL AND e.fx_rate_to_usd > 0
                     THEN fam.total / e.fx_rate_to_usd ELSE fam.total END)`;
    // `bucketExprFn(tzParam)` must yield the row's local week-start date
    // (Monday-anchored in the label tz). Params are built per series because
    // the paid bucket doesn't need tz — an unreferenced parameter is a
    // Postgres error ("could not determine data type"), not a no-op.
    const series = async (bucketExprFn, extraWhere, needsTz) => {
      const params = [req.labelId];
      const p = (v) => { params.push(v); return `$${params.length}`; };
      const tzP = (needsTz || !ranged) ? p(tz) : null;
      // Both endpoints get snapped to their week's Monday, and generate_series
      // is inclusive — so a from/to inside the same week still yields one bar.
      const fromExpr = ranged ? `date_trunc('week', ${p(from)}::date)`
                              : `date_trunc('week', (NOW() AT TIME ZONE ${tzP})::date) - INTERVAL '11 weeks'`;
      const toExpr   = ranged ? `date_trunc('week', ${p(to)}::date)`
                              : `date_trunc('week', (NOW() AT TIME ZONE ${tzP})::date)`;
      const bucketExpr = bucketExprFn(tzP);
      const { rows } = await pool.query(
        `WITH weeks AS (
           SELECT generate_series(${fromExpr}, ${toExpr}, INTERVAL '1 week')::date AS wk)
         SELECT to_char(w.wk, 'YYYY-MM-DD') AS week,
                to_char(w.wk + 6, 'YYYY-MM-DD') AS week_end,
                COALESCE(COUNT(e.id), 0)::int AS count,
                COALESCE(COUNT(e.id) FILTER (WHERE e.vendor_submitted = TRUE), 0)::int AS vendor,
                COALESCE(COUNT(e.id) FILTER (WHERE e.vendor_submitted IS DISTINCT FROM TRUE), 0)::int AS admin,
                COALESCE(SUM(${famUsd}), 0)::numeric(18,2) AS amount,
                COALESCE(SUM(${famUsd}) FILTER (WHERE e.vendor_submitted = TRUE), 0)::numeric(18,2) AS vendor_amount,
                COALESCE(SUM(${famUsd}) FILTER (WHERE e.vendor_submitted IS DISTINCT FROM TRUE), 0)::numeric(18,2) AS admin_amount
           FROM weeks w
           LEFT JOIN expenses e ON ${bucketExpr} = w.wk
             AND e.label_id = $1 AND (e.deleted = false OR e.deleted IS NULL)
             AND (e.voided = false OR e.voided IS NULL) AND e.parent_id IS NULL ${extraWhere}
           LEFT JOIN LATERAL (
             SELECT e.amount + COALESCE(SUM(c.amount), 0) AS total
               FROM expenses c
              WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)
                AND (c.voided = false OR c.voided IS NULL)
           ) fam ON TRUE
          GROUP BY w.wk ORDER BY w.wk`,
        params
      );
      return rows;
    };
    const [submissions, paid] = await Promise.all([
      // created_at is UTC → convert into the label tz before bucketing.
      series((tzP) => `date_trunc('week', (e.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzP}))::date`, '', true),
      // payment_date is a calendar date — bucket it directly (no tz needed).
      series(() => `date_trunc('week', e.payment_date::timestamp)::date`, "AND e.payment_status = 'Paid' AND e.payment_date IS NOT NULL", false),
    ]);
    res.json({ success: true, data: { submissions, paid, tz } });
  } catch (error) {
    console.error('Payment analytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Invoice search (boom's /bk/invoices) ────────────────────────────────────
// GET /api/ledger/invoices — the browse/search-all-invoices index: one row per
// invoice FAMILY (parents/standalones only; children fold into the family
// total), distinct from the outbound-invoice creator at /api/invoices.
// Params:
//   search — payee / invoice # / description / artist substring, PLUS a
//     normalized invoice-number equality ("INV-0042" finds "#42"). The
//     normalization stays JS-side (lib/normalizeInvoiceNum is the one
//     definition, never re-expressed in SQL), so when it could apply the query
//     also pulls every invoice-number-bearing row in scope as candidates and
//     the filter runs here.
//   from/to + basis ∈ invoice_date (default) | created_at | payment_date —
//     the range filters on the same column a clicked chart bar bucketed by.
//   status ∈ approved (default) | rejected | pending. Rejected rows carry
//     rejected_at/rejected_by/rejected_reason straight off the row (no audit
//     LATERAL needed — cadence stamps them at reject time).
// Rep-visibility scoped like the main ledger list. 200 newest by basis column.
router.get('/invoices', async (req, res) => {
  try {
    const basisCol = { invoice_date: 'invoice_date', created_at: 'created_at', payment_date: 'payment_date' }[
      String(req.query.basis || '').toLowerCase()] || 'invoice_date';
    const allowedStatus = new Set(['approved', 'rejected', 'pending']);
    const status = allowedStatus.has(String(req.query.status || '').toLowerCase())
      ? String(req.query.status).toLowerCase() : 'approved';

    const params = [req.labelId, status];
    const conditions = [
      'e.label_id = $1',
      'e.status = $2',
      '(e.deleted = false OR e.deleted IS NULL)',
      '(e.voided = false OR e.voided IS NULL)',
      'e.parent_id IS NULL',
    ];
    // created_at is a timestamp; from/to are calendar dates — compare on
    // ::date so a chart week_end of Sunday includes Sunday-evening intake.
    const basisExpr = basisCol === 'created_at' ? 'e.created_at::date' : `e.${basisCol}`;
    if (req.query.from) { params.push(req.query.from); conditions.push(`${basisExpr} >= $${params.length}`); }
    if (req.query.to)   { params.push(req.query.to);   conditions.push(`${basisExpr} <= $${params.length}`); }

    const search = String(req.query.search ?? req.query.q ?? '').trim();
    const normSearch = normInv(search);
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      conditions.push(`(e.payee ILIKE $${n} OR e.invoice_number ILIKE $${n} OR e.description ILIKE $${n} OR e.artist ILIKE $${n}${
        normSearch ? ` OR (e.invoice_number IS NOT NULL AND TRIM(e.invoice_number) <> '')` : ''})`);
    }

    // Same rep-visibility rule as the main list (no-op for Admin/Superadmin).
    const reps = await visibleReps(req);
    if (reps) { params.push(reps); conditions.push(`(e.rep = ANY($${params.length}) OR e.rep IS NULL)`); }

    // When searching, the LIMIT must land AFTER the JS-side normalized filter
    // (SQL can't know which candidates survive); otherwise cap in SQL.
    const limitSql = search ? '' : ' LIMIT 200';
    const { rows } = await pool.query(
      `SELECT e.id, e.invoice_date, e.created_at, e.payment_date, e.payee, e.invoice_number,
              e.description, e.artist, e.category, e.currency, e.fx_rate_to_usd,
              e.status, e.payment_status, e.vendor_submitted, e.is_reimbursement,
              e.rejected_reason, e.rejected_by, e.rejected_at,
              (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
                  WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)
                    AND (c.voided = false OR c.voided IS NULL)), 0)) AS amount,
              (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id
                 AND (c.deleted = false OR c.deleted IS NULL)) AS split_count,
              (e.invoice_r2_key IS NOT NULL) AS has_invoice,
              (e.w9_r2_key IS NOT NULL) AS has_w9,
              (e.proof_r2_key IS NOT NULL) AS has_proof,
              e.invoice_filename, e.w9_filename, e.proof_filename,
              -- Alias-aware shared-W9 resolution: the row that HOLDS this
              -- vendor's W9 (same rule as the main list / w9_entry_id).
              (SELECT x.id FROM expenses x
                WHERE x.label_id = e.label_id AND x.w9_r2_key IS NOT NULL
                  AND (x.deleted = false OR x.deleted IS NULL) AND x.status <> 'rejected'
                  AND (
                    LOWER(TRIM(x.payee)) = LOWER(TRIM(e.payee))
                    OR LOWER(TRIM(x.payee)) IN (
                      SELECT LOWER(TRIM(va.alias))     FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.canonical)) = LOWER(TRIM(e.payee))
                      UNION
                      SELECT LOWER(TRIM(va.canonical)) FROM vendor_aliases va WHERE va.label_id = e.label_id AND LOWER(TRIM(va.alias))     = LOWER(TRIM(e.payee))
                    )
                  )
                ORDER BY x.id DESC LIMIT 1) AS w9_entry_id
         FROM expenses e
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.${basisCol} DESC NULLS LAST, e.id DESC${limitSql}`,
      params
    );

    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      const hit = (v) => String(v || '').toLowerCase().includes(q);
      data = rows.filter(r =>
        hit(r.payee) || hit(r.invoice_number) || hit(r.description) || hit(r.artist)
        || (normSearch && normInv(r.invoice_number) === normSearch)
      ).slice(0, 200);
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('Invoice search error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Vendor saved emails (auto-CC on confirmations) ─────────────────────────
// Alias-aware: addresses saved under a spelling this vendor was merged from
// are still this vendor's addresses.
router.get('/vendors/:name/emails', async (req, res) => {
  try {
    const names = await vendorNameSet(req.labelId, req.params.name);
    const { rows } = await pool.query(
      'SELECT id, vendor, email, label_text FROM vendor_emails WHERE label_id = $1 AND LOWER(vendor) = ANY($2) ORDER BY id',
      [req.labelId, names]);
    res.json({ success: true, data: rows.map((r) => ({ ...r, via_alias: r.vendor.toLowerCase() !== String(req.params.name).toLowerCase() })) });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
router.post('/vendors/:name/emails', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim();
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
    // A malformed address saved here is auto-CC'd on every future payment
    // confirmation and fails silently in the provider — reject it at the door.
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: `"${email}" is not a valid email address` });
    const { rows: dup } = await pool.query(
      'SELECT id FROM vendor_emails WHERE label_id = $1 AND LOWER(vendor) = LOWER($2) AND LOWER(email) = LOWER($3)',
      [req.labelId, req.params.name, email]);
    if (dup.length && !req.body.label_text) {
      return res.status(409).json({ success: false, error: 'That address is already saved for this vendor' });
    }
    await pool.query(
      `INSERT INTO vendor_emails (label_id, vendor, email, label_text, created_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (label_id, LOWER(vendor), LOWER(email)) DO UPDATE SET label_text = EXCLUDED.label_text`,
      [req.labelId, req.params.name, email, String(req.body.label_text || '').trim() || null, req.user.name]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/vendor-emails/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vendor_emails WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Payment-confirmation emails ────────────────────────────────────────────

// Shared confirmation sender: 1..N PAID invoices for ONE vendor → one email,
// stating each invoice's FAMILY total (a split vendor billed once — telling
// them the parent's slice understates what they were paid), with the invoice +
// proof documents attached. Marks every family notified. Boom's
// /payments/:id/confirmation + bulk_payment_confirmation in one shape.
async function sendVendorConfirmation(req, ids, override = {}) {
  const { rows } = await pool.query(
    `SELECT e.*,
       (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount
       FROM expenses e
      WHERE e.label_id = $1 AND e.id = ANY($2::int[]) AND e.parent_id IS NULL AND e.payment_status = 'Paid'
        AND (e.deleted = false OR e.deleted IS NULL)`,
    [req.labelId, ids]
  );
  if (!rows.length) return { status: 404, body: { success: false, error: 'Paid entries not found' } };
  const to = override.to || rows[0].vendor_email;
  if (!to) return { status: 400, body: { success: false, error: 'No vendor email on this entry' } };
  // Proof gate (boom parity): a payment confirmation with no proof behind it
  // is an assertion, not a confirmation. Any of: entry proof, legacy receipt
  // slot, or a recorded installment proof.
  const noProof = [];
  for (const e of rows) {
    if (e.proof_r2_key || e.receipt_r2_key) continue;
    const inst = await pool.query(
      `SELECT 1 FROM payment_installments WHERE label_id = $1 AND proof_r2_key IS NOT NULL
        AND expense_id IN (SELECT id FROM expenses WHERE id = $2 OR parent_id = $2) LIMIT 1`,
      [req.labelId, e.id]
    );
    if (!inst.rows.length) noProof.push(e.invoice_number || `#${e.id}`);
  }
  if (noProof.length && !override.force) {
    return { status: 400, body: { success: false, error: `No proof of payment on file for ${noProof.join(', ')} — attach one first (or resend with force).` } };
  }

  const invoices = rows.map(e => ({ invoiceNumber: e.invoice_number, amount: e.family_amount, currency: e.currency, date: e.payment_date instanceof Date ? e.payment_date.toISOString().slice(0, 10) : e.payment_date, method: e.payment_method }));
  const byCur = {};
  rows.forEach(e => { byCur[e.currency || 'USD'] = (byCur[e.currency || 'USD'] || 0) + Number(e.family_amount || 0); });
  const totalLine = Object.entries(byCur).map(([c, a]) => `${c} ${Number(a).toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join(' · ');

  // Attach the paperwork the email is about — each invoice + its proof.
  const attachments = [];
  const seen = new Set();
  for (const e of rows) {
    for (const [key, name] of [[e.invoice_r2_key, e.invoice_filename || `invoice-${e.id}.pdf`], [e.proof_r2_key || e.receipt_r2_key, e.proof_filename || e.receipt_filename || `proof-${e.id}.pdf`]]) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      attachments.push({ r2_key: key, filename: name });
    }
  }

  const head = rows[0];
  const ctx = {
    labelId: req.labelId, to, cc: override.cc,
    vendorName: head.vendor_name || head.payee,
    invoiceNumber: rows.length === 1 ? head.invoice_number : null,
    amount: rows.length === 1 ? head.family_amount : null,
    currency: head.currency, method: head.payment_method,
    date: head.payment_date instanceof Date ? head.payment_date.toISOString().slice(0, 10) : head.payment_date,
    invoices: rows.length > 1 ? invoices : null,
    totalLine: rows.length > 1 ? totalLine : null,
    note: override.note || null,
    attachments,
  };
  const workspace = await loadLabelIdentity(req.labelId);
  if (workspace) ctx.workspaceName = workspace.name;
  const result = await dispatchSend(rows.length > 1 ? 'bulk_payment_confirmation' : 'payment_confirmation', ctx, { subject: override.subject || undefined });
  if (!result.sent) return { status: 502, body: { success: false, error: result.reason || 'Send failed' } };
  await pool.query(
    `UPDATE expenses SET payment_notified = TRUE, payment_notified_at = NOW()
      WHERE label_id = $1 AND COALESCE(parent_id, id) = ANY($2::int[])`,
    [req.labelId, rows.map(r => r.id)]
  );
  rows.forEach(r => bkAudit(req, r.id, 'confirmation_sent', `to ${to}`));
  await logActivity(req, 'Sent payment confirmation', `${head.payee} — ${rows.length} invoice(s)`, { entryPayee: head.payee });
  return { status: 200, body: { success: true, data: { sent: rows.length } } };
}

// POST /api/ledger/entries/:id/send-confirmation — email the payee that their
// invoice was paid; states the FAMILY total, attaches invoice + proof, records
// the whole family as notified. Accepts { to, cc, subject, note, force }
// overrides from the preview modal.
router.post('/entries/:id/send-confirmation', async (req, res) => {
  try {
    const out = await sendVendorConfirmation(req, [parseInt(req.params.id, 10)], req.body || {});
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('Send confirmation error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/send-vendor-confirmation { ids:[], to, cc, subject, note }
// — ONE combined email covering every selected paid invoice for one vendor
// (the client groups by vendor_email; a vendor with 5 paid invoices gets one
// email, not five).
router.post('/send-vendor-confirmation', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(n => parseInt(n, 10)).filter(Boolean))] : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const out = await sendVendorConfirmation(req, ids, req.body || {});
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('Vendor confirmation error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/send-confirmations-bulk { ids:[] } — legacy per-entry loop,
// kept for API compatibility (the Payments page now groups by vendor and uses
// /send-vendor-confirmation through the preview modal instead).
router.post('/send-confirmations-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(n => parseInt(n, 10)).filter(Boolean))] : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rows } = await pool.query(
      `SELECT * FROM expenses WHERE label_id = $1 AND id = ANY($2::int[]) AND payment_status = 'Paid' AND vendor_email IS NOT NULL`,
      [req.labelId, ids]
    );
    let sent = 0;
    for (const e of rows) {
      await notifyVendor(req.labelId, e, 'paid', { method: e.payment_method, date: e.payment_date });
      await pool.query(`UPDATE expenses SET payment_notified = TRUE, payment_notified_at = NOW() WHERE id = $1`, [e.id]);
      sent++;
    }
    await logActivity(req, 'Bulk payment confirmations', `${sent} sent`);
    res.json({ success: true, data: { sent } });
  } catch (error) {
    console.error('Bulk confirmation error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/mark-sent  &  /mark-unsent — toggle the notified
// flag manually (e.g. confirmed out-of-band).
// Confirmation flag is tracked per split family (mark the whole family).
router.post('/entries/:id/mark-sent', async (req, res) => {
  try {
    await pool.query(
      `UPDATE expenses SET payment_notified = TRUE, payment_notified_at = NOW()
        WHERE label_id = $2 AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $1 AND label_id = $2)`,
      [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/entries/:id/mark-unsent', async (req, res) => {
  try {
    await pool.query(
      `UPDATE expenses SET payment_notified = FALSE, payment_notified_at = NULL
        WHERE label_id = $2 AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $1 AND label_id = $2)`,
      [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/ledger/payments-export?filter=all|unpaid|overdue|due_soon — Excel of
// the payment queue (rep-visibility honored, formatted amounts, per-currency
// TOTAL rows). Boom's /payments/export, tenant-scoped.
router.get('/payments-export', async (req, res) => {
  try {
    const filter = String(req.query.filter || 'all');
    const params = [req.labelId];
    let where = `e.label_id = $1 AND e.status = 'approved'
      AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
      AND e.parent_id IS NULL
      AND (e.entry_source IS NULL OR e.entry_source NOT IN ('creator_payment', 'bank_statement', 'recoupments', 'artist_campaigns'))`;
    if (filter === 'unpaid') where += ` AND e.payment_status IN ('Unpaid','Partial')`;
    else if (filter === 'overdue') where += ` AND e.payment_status IN ('Unpaid','Partial') AND (e.on_hold = false OR e.on_hold IS NULL) AND e.scheduled_payment_date < CURRENT_DATE`;
    else if (filter === 'due_soon') where += ` AND e.payment_status IN ('Unpaid','Partial') AND (e.on_hold = false OR e.on_hold IS NULL) AND e.scheduled_payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`;
    else where += ` AND (e.payment_status IN ('Unpaid','Partial')
      OR (e.payment_status = 'Paid' AND COALESCE(e.paid_marked_at, e.payment_date::timestamp, e.created_at) >= NOW() - INTERVAL '${PAID_GRACE_DAYS} days'))`;
    const reps = await visibleReps(req);
    if (reps) { params.push(reps); where += ` AND (e.rep = ANY($${params.length}) OR e.rep IS NULL)`; }
    const { rows } = await pool.query(
      `SELECT e.invoice_date, e.payee, e.artist, e.song, e.invoice_number, e.category, e.payment_method,
              e.scheduled_payment_date, e.payment_status, e.on_hold, e.rush, e.rep, e.payment_date, e.vendor_bank,
              (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS amount,
              e.currency
         FROM expenses e WHERE ${where}
        ORDER BY (e.payment_status = 'Paid'), e.scheduled_payment_date ASC NULLS LAST, e.id ASC`,
      params
    );
    const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Payments');
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 }, { header: 'Payee', key: 'payee', width: 28 },
      { header: 'Artist', key: 'artist', width: 18 }, { header: 'Song', key: 'song', width: 18 },
      { header: 'Inv #', key: 'inv', width: 14 }, { header: 'Category', key: 'category', width: 16 },
      { header: 'Method', key: 'method', width: 12 }, { header: 'Due date', key: 'due', width: 12 },
      { header: 'Status', key: 'status', width: 10 }, { header: 'Rep', key: 'rep', width: 14 },
      { header: 'Paid date', key: 'paid', width: 12 }, { header: 'Bank', key: 'bank', width: 18 },
      { header: 'Amount', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } }, { header: 'Currency', key: 'currency', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    const byCur = {};
    for (const r of rows) {
      ws.addRow({
        date: day(r.invoice_date), payee: r.payee, artist: r.artist, song: r.song, inv: r.invoice_number,
        category: r.category, method: r.payment_method, due: day(r.scheduled_payment_date),
        status: r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'Hold' : r.rush ? 'Rush' : (r.payment_status || 'Unpaid'),
        rep: r.rep, paid: day(r.payment_date), bank: r.vendor_bank,
        amount: Number(r.amount || 0), currency: r.currency || 'USD',
      });
      if (r.payment_status !== 'Paid') byCur[r.currency || 'USD'] = (byCur[r.currency || 'USD'] || 0) + Number(r.amount || 0);
    }
    ws.addRow({});
    for (const [c, a] of Object.entries(byCur)) {
      const tr = ws.addRow({ payee: `TOTAL UNPAID (${c})`, amount: Math.round(a * 100) / 100, currency: c });
      tr.font = { bold: true };
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="payments-${filter}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (error) {
    console.error('Payments export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/export — CSV of all (non-deleted) entries for the workspace.
// Shared WHERE for the export family (CSV / Excel / file ZIPs): honors the
// same filters as the list so "export what I'm looking at" is honest, excludes
// voided (reversed money is not spend), and stays on family roots — but
// exports the FAMILY total + aggregated child artists, never just the parent's
// slice (LED-2).
function exportFilters(req, params) {
  let where = `e.label_id = $1 AND (e.deleted = false OR e.deleted IS NULL) AND e.parent_id IS NULL
    AND (e.voided = false OR e.voided IS NULL) AND e.status <> 'pending'`;
  if (req.query.status) { params.push(req.query.status); where += ` AND e.status = $${params.length}`; }
  if (req.query.payment_status) { params.push(req.query.payment_status); where += ` AND e.payment_status = $${params.length}`; }
  if (req.query.category) { params.push(req.query.category); where += ` AND e.category = $${params.length}`; }
  if (req.query.artist) { params.push(`%${req.query.artist}%`); where += ` AND e.artist ILIKE $${params.length}`; }
  if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND (e.payee ILIKE $${params.length} OR e.description ILIKE $${params.length} OR e.artist ILIKE $${params.length} OR e.invoice_number ILIKE $${params.length})`; }
  // Same ?source= contract as the list, so an export contains EXACTLY the page
  // it was launched from. A workbook that disagrees with the screen it came
  // from is worse than no workbook — and this one goes to the accountant.
  // Returns null on a bad value; callers 400 rather than exporting everything.
  const srcSql = sourceClause(req.query.source, 'e');
  if (srcSql === null) return null;
  return where + srcSql;
}

const EXPORT_SELECT = `SELECT e.invoice_date, e.payee, e.description, e.category, e.artist,
    (SELECT STRING_AGG(DISTINCT c.artist, ', ') FROM expenses c
      WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL) AND c.artist IS NOT NULL AND c.artist <> e.artist) AS child_artists,
    e.song, e.invoice_number,
    (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
        WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)
          AND (c.voided = false OR c.voided IS NULL)), 0)) AS amount,
    e.currency, e.payment_method, e.status, e.payment_status, e.payment_date, e.paid_by, e.rep,
    e.recoupable, e.in_quickbooks, e.notes
  FROM expenses e`;

// Thrown rather than returned: three export routes call this, and a null
// return would have to be checked in each — one unchecked call site is a query
// with `WHERE null` in it.
class BadSource extends Error {}
async function exportRows(req) {
  const params = [req.labelId];
  const where = exportFilters(req, params);
  if (where === null) throw new BadSource();
  const { rows } = await pool.query(
    `${EXPORT_SELECT} WHERE ${where} ORDER BY COALESCE(e.invoice_date, e.created_at::date) DESC, e.id DESC`,
    params
  );
  return rows;
}

const EXPORT_COLS = ['invoice_date', 'payee', 'description', 'category', 'artist', 'child_artists', 'song', 'invoice_number', 'amount', 'currency', 'payment_method', 'status', 'payment_status', 'payment_date', 'paid_by', 'rep', 'recoupable', 'in_quickbooks', 'notes'];

router.get('/export', async (req, res) => {
  try {
    const rows = await exportRows(req);
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [EXPORT_COLS.join(','), ...rows.map(r => EXPORT_COLS.map(c => esc(c === 'invoice_date' || c === 'payment_date' ? (r[c] ? String(r[c]).slice(0, 10) : '') : r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ledger-export.csv"');
    res.send(csv);
  } catch (error) {
    if (error instanceof BadSource) return res.status(400).json(BAD_SOURCE);
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/export-xlsx — branded workbook: full ledger + Unpaid + Paid
// tabs, family-total amounts (boom's Excel export, LED-12).
router.get('/export-xlsx', async (req, res) => {
  try {
    const rows = await exportRows(req);
    const wb = new ExcelJS.Workbook();
    const HEADERS = ['Date', 'Payee', 'Description', 'Category', 'Artist', 'Split artists', 'Song', 'Inv #', 'Amount', 'Currency', 'Method', 'Status', 'Payment', 'Paid on', 'Paid by', 'Rep', 'Recoup?', 'QB?', 'Notes'];
    const addTab = (name, subset) => {
      const ws = wb.addWorksheet(name);
      const head = ws.addRow(HEADERS);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      let total = 0;
      for (const r of subset) {
        total += Number(r.amount || 0);
        ws.addRow([
          r.invoice_date ? String(r.invoice_date).slice(0, 10) : '', r.payee || '', r.description || '', r.category || '',
          r.artist || '', r.child_artists || '', r.song || '', r.invoice_number || '', Number(r.amount || 0), r.currency || 'USD',
          r.payment_method || '', r.status || '', r.payment_status || '', r.payment_date ? String(r.payment_date).slice(0, 10) : '',
          r.paid_by || '', r.rep || '', r.recoupable ? 'Yes' : 'No', r.in_quickbooks ? 'Yes' : 'No', r.notes || '',
        ]);
      }
      const totalRow = ws.addRow(['', '', '', '', '', '', '', 'TOTAL', total]);
      totalRow.font = { bold: true };
      ws.columns.forEach(c => { c.width = 16; });
    };
    addTab('Ledger', rows);
    addTab('Unpaid', rows.filter(r => r.payment_status !== 'Paid'));
    addTab('Paid', rows.filter(r => r.payment_status === 'Paid'));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ledger-export.xlsx"');
    res.send(buf);
  } catch (error) {
    if (error instanceof BadSource) return res.status(400).json(BAD_SOURCE);
    console.error('Export xlsx error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/export-invoices-zip · /export-w9s-zip — every invoice / W9
// file the current filters reach, capped so one click can't drain R2 (LED-12).
const ZIP_FILE_CAP = 300;
async function fileZip(req, res, keyCol, nameOf, zipName) {
  const params = [req.labelId];
  const where = exportFilters(req, params);
  if (where === null) return res.status(400).json(BAD_SOURCE);
  const { rows } = await pool.query(
    `SELECT e.id, e.payee, e.invoice_number, e.${keyCol} AS key FROM expenses e
      WHERE ${where} AND e.${keyCol} IS NOT NULL
      ORDER BY COALESCE(e.invoice_date, e.created_at::date) DESC, e.id DESC LIMIT ${ZIP_FILE_CAP + 1}`,
    params
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'No files match the current filters' });
  const capped = rows.length > ZIP_FILE_CAP;
  const entries = [];
  const seen = new Set();
  for (const r of rows.slice(0, ZIP_FILE_CAP)) {
    const buf = await loadFileBuffer(r.key, null).catch(() => null);
    if (!buf) continue; // R2 gap degrades to a smaller zip, never a 500
    let name = `${nameOf(r)}.${fileExt(r.key)}`;
    if (seen.has(name)) name = `${nameOf(r)}-${r.id}.${fileExt(r.key)}`;
    seen.add(name);
    entries.push({ name, content: buf });
  }
  if (!entries.length) return res.status(404).json({ success: false, error: 'Files are not available in storage' });
  if (capped) entries.push({ name: '_CAPPED.txt', content: Buffer.from(`Only the newest ${ZIP_FILE_CAP} files are included — narrow the filters for the rest.`) });
  const zip = buildZip(entries, Math.floor(Date.now() / 1000));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  res.send(zip);
}
router.get('/export-invoices-zip', async (req, res) => {
  try { await fileZip(req, res, 'invoice_r2_key', r => `${safe(r.payee)} - ${safe(r.invoice_number || r.id)}`, 'invoices.zip'); }
  catch (error) { console.error('Invoices zip error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.get('/export-w9s-zip', async (req, res) => {
  try { await fileZip(req, res, 'w9_r2_key', r => `W9 - ${safe(r.payee)}`, 'w9s.zip'); }
  catch (error) { console.error('W9s zip error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/ledger/entries/:id/void — reverse an approved/paid entry without
// deleting it (keeps the audit trail; excluded from payable/spend totals).
// Admin-only (boom parity): voiding reverses money. Cascades to the whole
// split family so a family never half-voids, and KEEPS payment_status — a
// voided-then-restored paid entry must still read Paid (LED-27).
router.post('/entries/:id/void', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE expenses SET voided = TRUE, voided_at = NOW(), voided_by = $1
       WHERE label_id = $3 AND (voided = false OR voided IS NULL)
         AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $2 AND label_id = $3)
       RETURNING *`,
      [req.user.name, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const head = rows.find(r => r.id === id) || rows[0];
    await logActivity(req, 'Voided ledger entry', `${head.payee} — ${head.amount}${rows.length > 1 ? ` (+${rows.length - 1} in family)` : ''}`, { entryPayee: head.payee });
    bkAudit(req, id, 'voided', rows.length > 1 ? `family of ${rows.length}` : null);
    res.json({ success: true, data: head });
  } catch (error) {
    console.error('Void error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/unvoid — restore a voided entry (+ family).
router.post('/entries/:id/unvoid', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `UPDATE expenses SET voided = FALSE, voided_at = NULL, voided_by = NULL
       WHERE label_id = $2
         AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $1 AND label_id = $2)
       RETURNING *`,
      [id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    bkAudit(req, id, 'unvoided', null);
    res.json({ success: true, data: rows.find(r => r.id === id) || rows[0] });
  } catch (error) {
    console.error('Unvoid error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/bulk-reject — reject many pending entries at once.
router.post('/bulk-reject', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'rejected', rejected_reason = $1, approved_by = $2, approved_at = NOW()
       WHERE label_id = $3 AND status = 'pending' AND id = ANY($4::int[]) RETURNING id`,
      [req.body.reason || null, req.user.name, req.labelId, ids]
    );
    await logActivity(req, 'Bulk rejected', `${rows.length} entries`);
    res.json({ success: true, data: { rejected: rows.length } });
  } catch (error) {
    console.error('Bulk reject error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Bulk-deal items ──────────────────────────────────────────────────────
async function expenseInLabel(id, labelId) {
  const { rows } = await pool.query('SELECT 1 FROM expenses WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length > 0;
}

// GET /api/ledger/bulk-deals — the delivery-tracking rollup behind /bulk-deals.
//
// One payment buying N deliverables. Every derived figure (contracted,
// delivered, paid, stalled, paid-ahead, per-unit) is computed HERE via
// lib/bulkDeals so the tracker and the notification bell cannot disagree about
// which deals are in trouble — the client only formats.
//
// Split children come back attached to their parent rather than as a second
// round trip: the split editor needs them, and so does the socials editor's
// "For artist" picker.
router.get('/bulk-deals', async (req, res) => {
  try {
    const { rows } = await pool.query(BULK_DEALS_SQL, [req.labelId]);
    const now = Date.now();
    const deals = rows.map(r => deriveDeal(r, now));

    if (deals.length) {
      const { rows: kids } = await pool.query(
        `SELECT id, parent_id, artist, song, amount FROM expenses
          WHERE label_id = $1 AND parent_id = ANY($2::int[])
            AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
          ORDER BY id`,
        [req.labelId, deals.map(d => d.id)]
      );
      const byParent = new Map();
      for (const k of kids) {
        if (!byParent.has(k.parent_id)) byParent.set(k.parent_id, []);
        byParent.get(k.parent_id).push({ id: k.id, artist: k.artist, song: k.song, amount: Number(k.amount) });
      }
      for (const d of deals) {
        const children = byParent.get(d.id) || [];
        // The PARENT holds the first slice — a split family is parent + kids, so
        // rendering only the children would drop a real artist and a real slice
        // of the money from the editor.
        d.splits = children.length
          ? [{ id: d.id, artist: d.artist, song: d.song, amount: Number(d.amount) }, ...children]
          : [];
        d.family_artists = [...new Set(d.splits.map(s => (s.artist || '').trim()).filter(Boolean))];
      }
    }
    res.json({ success: true, data: deals });
  } catch (error) {
    console.error('Bulk deals rollup error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/bulk-items
router.get('/entries/:id/bulk-items', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM bulk_deal_items WHERE label_id = $1 AND expense_id = $2 ORDER BY position, id',
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List bulk items error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/bulk-items — add a deliverable (also flags the
// parent expense as a bulk deal).
router.post('/entries/:id/bulk-items', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await expenseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Entry not found' });
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
    await pool.query('UPDATE expenses SET is_bulk_deal = TRUE WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    // Auto-position at the end when the caller doesn't say. Every row landing on
    // position 0 makes the checklist order an id accident, which the ghost-slot
    // "Log" flow (Video 1, Video 2, …) reads as arbitrary.
    const { rows: pos } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM bulk_deal_items WHERE label_id = $1 AND expense_id = $2',
      [req.labelId, id]
    );
    // Resolved in JS, not `COALESCE($n,$m)`: both placeholders arrive untyped, so
    // a null caller-position leaves Postgres unable to infer the type (42804).
    const asked = parseInt(req.body.position, 10);
    const position = Number.isFinite(asked) ? asked : pos[0].next_pos;
    const { rows } = await pool.query(
      `INSERT INTO bulk_deal_items (label_id, expense_id, title, url, platform, position)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.labelId, id, title, req.body.url || null, req.body.platform || null, position]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create bulk item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/ledger/bulk-items/:itemId — toggle completion / edit.
router.patch('/bulk-items/:itemId', async (req, res) => {
  try {
    const fields = [];
    const values = [];
    // Placeholders number off VALUES, not off `fields` — `completed` pushes a
    // literal `completed_at = NOW()` clause with no parameter behind it, so
    // numbering from fields.length skipped a slot and any PATCH that sent
    // `completed` alongside a second field died on a missing $n.
    const set = (col, v) => { values.push(v); fields.push(`${col} = $${values.length}`); };
    if (typeof req.body.completed === 'boolean') {
      set('completed', req.body.completed);
      fields.push(`completed_at = ${req.body.completed ? 'NOW()' : 'NULL'}`);
    }
    if (typeof req.body.title === 'string' && req.body.title.trim()) set('title', req.body.title.trim());
    if (req.body.url !== undefined) set('url', req.body.url || null);
    if (req.body.platform !== undefined) set('platform', req.body.platform || null);
    if (req.body.position !== undefined) {
      const p = parseInt(req.body.position, 10);
      if (!Number.isFinite(p)) return res.status(400).json({ success: false, error: 'Bad position' });
      set('position', p);
    }
    if (!fields.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    values.push(parseInt(req.params.itemId, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE bulk_deal_items SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update bulk item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/bulk-items/:itemId
router.delete('/bulk-items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM bulk_deal_items WHERE id = $1 AND label_id = $2', [parseInt(req.params.itemId, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete bulk item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Payment installments ─────────────────────────────────────────────────

// GET /api/ledger/entries/:id/installments
router.get('/entries/:id/installments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM payment_installments WHERE label_id = $1 AND expense_id = $2 ORDER BY paid_date, id',
      [req.labelId, parseInt(req.params.id, 10)]
    );
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    res.json({ success: true, data: { installments: rows, total } });
  } catch (error) {
    console.error('List installments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/installments — record a partial payment. If the
// installments now cover the full amount, the entry is marked Paid.
router.post('/entries/:id/installments', upload.single('proof'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A valid amount is required' });
    const exp = await pool.query('SELECT amount FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!exp.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    // Optional proof-of-payment file.
    let proof = { key: null, filename: null };
    if (req.file) { const s = await storeFile(req.labelId, req.file, 'proof'); proof = s; }
    const { rows } = await pool.query(
      `INSERT INTO payment_installments (label_id, expense_id, amount, paid_date, method, reference, proof_r2_key, proof_filename, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING *`,
      [req.labelId, id, amount, req.body.paid_date || null, req.body.method || null, req.body.reference || null, proof.key, proof.filename, req.user.name]
    );
    // Recompute payment status across the WHOLE family (never a half-paid family).
    const root = await familyRoot(pool, id, req.labelId);
    const status = await recomputeFamilyPaymentStatus(pool, root, req.labelId);
    if (status === 'Paid') {
      await cascadePaymentFieldsToFamily(pool, root, req.labelId, { payment_date: req.body.paid_date || new Date().toISOString().slice(0, 10), paid_by: req.user.name, paid_marked_at: new Date() });
      const fam = await pool.query('SELECT id FROM expenses WHERE (id = $1 OR parent_id = $1) AND label_id = $2', [root, req.labelId]);
      fam.rows.forEach(r => stampFxRateAsync(r.id));  // one rate per family flip
    }
    const paid = Number((await pool.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_installments WHERE label_id = $1 AND expense_id = ANY(SELECT id FROM expenses WHERE (id=$2 OR parent_id=$2) AND label_id=$1)', [req.labelId, root])).rows[0].paid);
    res.status(201).json({ success: true, data: { installment: rows[0], paid, payment_status: status } });
  } catch (error) {
    console.error('Create installment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/installments/:installmentId/proof — signed URL for the proof file.
router.get('/installments/:installmentId/proof', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT proof_r2_key FROM payment_installments WHERE id = $1 AND label_id = $2', [parseInt(req.params.installmentId, 10), req.labelId]);
    if (!rows.length || !rows[0].proof_r2_key) return res.status(404).json({ success: false, error: 'No proof on file' });
    if (!r2Configured()) return res.status(503).json({ success: false, error: "File storage is not configured on this deployment." });
    const url = await getSignedFileUrl(rows[0].proof_r2_key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('Installment proof error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/installments/:installmentId — remove + recompute status.
router.delete('/installments/:installmentId', async (req, res) => {
  try {
    const del = await pool.query('DELETE FROM payment_installments WHERE id = $1 AND label_id = $2 RETURNING expense_id', [parseInt(req.params.installmentId, 10), req.labelId]);
    if (!del.rows.length) return res.status(404).json({ success: false, error: 'Installment not found' });
    const id = del.rows[0].expense_id;
    // Recompute across the whole family; a family that drops below fully-paid
    // must shed its payment stamps too.
    const root = await familyRoot(pool, id, req.labelId);
    const status = await recomputeFamilyPaymentStatus(pool, root, req.labelId);
    if (status === 'Unpaid') {
      await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
        payment_date: null, paid_by: null, payment_ref: null, fx_rate_to_usd: null, paid_marked_at: null,
      });
    }
    const paid = Number((await pool.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_installments WHERE label_id = $1 AND expense_id = ANY(SELECT id FROM expenses WHERE (id=$2 OR parent_id=$2) AND label_id=$1)', [req.labelId, root])).rows[0].paid);
    res.json({ success: true, data: { paid, payment_status: status } });
  } catch (error) {
    console.error('Delete installment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/1099-report — vendors with a W9 on file and their approved
// spend for the given year (default current), for 1099 preparation.
router.get('/1099-report', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT e.payee AS vendor,
              COALESCE(MAX(v.email), MAX(e.vendor_email)) AS email,
              MAX(v.address) AS address,
              SUM(e.amount)::numeric AS total_paid,
              COUNT(*)::int AS invoice_count,
              BOOL_OR(e.w9_r2_key IS NOT NULL) OR BOOL_OR(v.w9_r2_key IS NOT NULL) AS has_w9
       FROM expenses e
       LEFT JOIN vendors v ON v.label_id = e.label_id AND LOWER(v.name) = LOWER(e.payee)
       WHERE e.label_id = $1 AND e.status = 'approved' AND e.payment_status = 'Paid'
         AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
         -- Split children COUNT: a split family's parent row carries only its
         -- own slice, so excluding children understated split vendors (LED-3).
         AND e.payee IS NOT NULL AND e.payee != ''
         AND EXTRACT(YEAR FROM COALESCE(e.payment_date, e.invoice_date, e.created_at::date)) = $2
       GROUP BY e.payee
       HAVING SUM(e.amount) >= $3
       ORDER BY total_paid DESC`,
      [req.labelId, year, require('../lib/ledgerSource').reportingThresholdFor(year)]
    );
    res.json({ success: true, data: { year, vendors: rows.map(r => ({ ...r, total_paid: Number(r.total_paid) })) } });
  } catch (error) {
    console.error('1099 report error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Build a branded XLSX ledger for a set of expense rows.
// `accent` is the workspace's brand color as ARGB. Every other export in the
// app is workspace-branded; hardcoding indigo here shipped one tenant's accent
// to every other tenant's vendors.
async function vendorLedgerXlsx(vendorName, rows, accent = 'FF4F46E5') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ledger');
  const cols = ['Invoice date', 'Invoice #', 'Artist', 'Category', 'Amount', 'Currency', 'Status', 'Payment', 'Paid date', 'Method', 'Notes'];
  const title = ws.addRow([`${vendorName} — invoice ledger`]); title.font = { bold: true, size: 14 }; ws.mergeCells(`A1:${String.fromCharCode(64 + cols.length)}1`);
  const head = ws.addRow(cols); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } }; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  let total = 0;
  for (const e of rows) {
    const amount = Number(e.family_amount ?? e.amount ?? 0);
    total += amount;
    ws.addRow([
      e.invoice_date ? String(e.invoice_date).slice(0, 10) : '', e.invoice_number || '', e.artist || '', e.category || '',
      amount, e.currency || 'USD', e.status || '', e.payment_status || '',
      e.payment_date ? String(e.payment_date).slice(0, 10) : '', e.payment_method || '', e.notes || '',
    ]);
  }
  const totalRow = ws.addRow(['', '', '', 'TOTAL', total]); totalRow.font = { bold: true };
  ws.columns.forEach(c => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// The workspace accent as an ExcelJS ARGB string, falling back to the app's
// default rather than failing an export over a color.
async function labelAccentArgb(labelId) {
  try {
    const { rows } = await pool.query('SELECT accent_color FROM labels WHERE id = $1', [labelId]);
    const hex = String(rows[0]?.accent_color || '').trim().replace('#', '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `FF${hex.toUpperCase()}`;
  } catch { /* default accent */ }
  return 'FF4F46E5';
}

// GET /api/ledger/vendor-zip?payee= — ZIP with a vendor's invoices + W9 + a
// branded Excel ledger.
router.get('/vendor-zip', async (req, res) => {
  try {
    const payee = (req.query.payee || '').trim();
    if (!payee) return res.status(400).json({ success: false, error: 'payee is required' });
    // Roots only, but with the FAMILY total: cadence's splits carve the
    // parent's amount, so exporting the raw parent amount omits every child
    // slice from both the rows and the TOTAL — the vendor's own bundle would
    // understate what they billed.
    const { rows } = await pool.query(
      `SELECT e.*,
              (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
                 WHERE c.parent_id = e.id AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount
         FROM expenses e WHERE e.label_id = $1 AND LOWER(e.payee) = LOWER($2)
         AND (e.deleted = false OR e.deleted IS NULL) AND e.status != 'rejected' AND e.parent_id IS NULL
       ORDER BY e.invoice_date ASC NULLS LAST`,
      [req.labelId, payee]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No invoices found for that vendor' });

    const entries = [{ name: `00 - ${safe(payee)} ledger.xlsx`, content: await vendorLedgerXlsx(payee, rows, await labelAccentArgb(req.labelId)) }];
    let w9Key = null;
    for (const e of rows) {
      if (e.invoice_r2_key) {
        const buf = await loadFileBuffer(e.invoice_r2_key, null).catch(() => null);
        if (buf) entries.push({ name: `invoices/${safe(e.invoice_number || e.id)}.${fileExt(e.invoice_r2_key)}`, content: buf });
      }
      if (!w9Key && e.w9_r2_key) w9Key = e.w9_r2_key;
    }
    if (!w9Key) {
      const v = await pool.query('SELECT w9_r2_key FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, payee]);
      w9Key = v.rows[0]?.w9_r2_key || null;
    }
    if (w9Key) {
      const buf = await loadFileBuffer(w9Key, null).catch(() => null);
      if (buf) entries.push({ name: `W9 - ${safe(payee)}.${fileExt(w9Key)}`, content: buf });
    }

    const zip = buildZip(entries, Math.floor(Date.now() / 1000));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safe(payee)}.zip"`);
    res.send(zip);
  } catch (error) {
    console.error('Vendor zip error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/bulk-zip — upload a spreadsheet of vendor + invoice# and get
// back a ZIP of every matching invoice file + W9s + a per-sheet matches.csv.
router.post('/bulk-zip', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No spreadsheet provided' });
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(req.file.buffer); }
    catch { return res.status(400).json({ success: false, error: 'Could not read that spreadsheet (expected .xlsx).' }); }

    // Index this label's invoices by vendor_lc|normInv for fast lookup.
    const { rows: all } = await pool.query(
      `SELECT id, payee, invoice_number, invoice_r2_key, w9_r2_key FROM expenses
       WHERE label_id = $1 AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL`,
      [req.labelId]
    );
    const byKey = new Map();
    const w9ByVendor = new Map();
    for (const e of all) {
      if (e.payee && e.invoice_number) byKey.set(`${e.payee.toLowerCase()}|${normInv(e.invoice_number)}`, e);
      if (e.w9_r2_key && e.payee && !w9ByVendor.has(e.payee.toLowerCase())) w9ByVendor.set(e.payee.toLowerCase(), { key: e.w9_r2_key, payee: e.payee });
    }

    const entries = [];
    const seenW9 = new Set();
    const summary = [];
    const matchHeaderRe = /vendor|payee|supplier|company|bill ?to/i;
    const invHeaderRe = /invoice ?#?|inv ?#?|invoice ?number/i;

    for (const ws of wb.worksheets) {
      const sheetName = ws.name;
      const grid = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (grid.length >= MAX_IMPORT_ROWS) return;
        grid.push((row.values || []).slice(1).map(cellText)); // exceljs values are 1-indexed
      });
      if (!grid.length) continue;
      // Find the header row + vendor/invoice columns in the first 15 rows.
      let headerRow = -1, vCol = -1, iCol = -1;
      for (let r = 0; r < Math.min(15, grid.length); r++) {
        const row = grid[r] || [];
        const vc = row.findIndex(c => matchHeaderRe.test(String(c)));
        const ic = row.findIndex(c => invHeaderRe.test(String(c)));
        if (vc !== -1 && ic !== -1) { headerRow = r; vCol = vc; iCol = ic; break; }
      }
      if (headerRow === -1) { entries.push({ name: `${safe(sheetName)}/_SKIPPED.txt`, content: 'Could not find VENDOR and INVOICE # columns in the first 15 rows.' }); continue; }

      const csv = [['vendor', 'invoice', 'status']];
      let matched = 0, missing = 0;
      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const vendor = String(row[vCol] || '').trim();
        const inv = String(row[iCol] || '').trim();
        if (!vendor || !inv) { csv.push([vendor, inv, 'missing_field']); continue; }
        const hit = byKey.get(`${vendor.toLowerCase()}|${normInv(inv)}`);
        if (!hit) { csv.push([vendor, inv, 'not_found']); missing++; continue; }
        if (!hit.invoice_r2_key) { csv.push([vendor, inv, 'no_file']); continue; }
        const buf = await loadFileBuffer(hit.invoice_r2_key, null).catch(() => null);
        if (!buf) { csv.push([vendor, inv, 'no_file']); continue; }
        entries.push({ name: `${safe(sheetName)}/${safe(vendor)}-${safe(inv)}.${fileExt(hit.invoice_r2_key)}`, content: buf });
        csv.push([vendor, inv, 'matched']); matched++;
        // collect this vendor's W9
        const w9 = w9ByVendor.get(vendor.toLowerCase());
        if (w9 && !seenW9.has(vendor.toLowerCase())) {
          seenW9.add(vendor.toLowerCase());
          const wbuf = await loadFileBuffer(w9.key, null).catch(() => null);
          if (wbuf) entries.push({ name: `W9s/${safe(w9.payee)}.${fileExt(w9.key)}`, content: wbuf });
        }
      }
      entries.push({ name: `${safe(sheetName)}/matches.csv`, content: toCsv(['vendor', 'invoice', 'status'], csv.slice(1).map(([vendor, invoice, status]) => ({ vendor, invoice, status }))) });
      summary.push(`${sheetName}: ${matched} matched, ${missing} not found`);
    }

    entries.unshift({ name: 'summary.txt', content: summary.join('\n') || 'No sheets processed.' });
    const zip = buildZip(entries, Math.floor(Date.now() / 1000));
    await logActivity(req, 'Bulk invoice ZIP', summary.join('; '));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.zip"');
    res.send(zip);
  } catch (error) {
    console.error('Bulk zip error:', error);
    res.status(500).json({ success: false, error: 'Could not process the spreadsheet' });
  }
});

// DELETE /api/ledger/entries/:id — soft delete
router.delete('/entries/:id', async (req, res) => {
  try {
    // Soft-delete with attribution; cascade to split children so a family
    // disappears together (and can be restored together).
    const { rowCount } = await pool.query(
      `UPDATE expenses SET deleted = true, deleted_by = $3, deleted_at = NOW()
        WHERE label_id = $2 AND COALESCE(parent_id, id) = (SELECT COALESCE(parent_id, id) FROM expenses WHERE id = $1 AND label_id = $2)`,
      [parseInt(req.params.id, 10), req.labelId, req.user.name]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Entry not found' });
    bkAudit(req, parseInt(req.params.id, 10), 'deleted', null);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
// Shared with bank-matching's artist-rule retro path, so rule writes match the
// ledger's own edit path.
module.exports.autoLinkRelease = autoLinkRelease;
