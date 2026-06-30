// AI discrepancy rescans for existing ledger entries, stored on the row so the
// finding persists. rescanInvoice writes expenses.ai_scan; rescanW9 writes
// expenses.w9_scan. Both look up the entry + file by id (label-scoped) so
// callers only pass ids. Returns { ok, scan } or { ok:false, reason }.

const pool = require('./../db');
const { loadFileBuffer } = require('./r2');
const claude = require('./claude');

const mimeFromKey = (key) =>
  /\.pdf$/i.test(key) ? 'application/pdf' : /\.png$/i.test(key) ? 'image/png' : 'image/jpeg';

const nullableStr = { type: ['string', 'null'] };
const DISCREPANCY = {
  type: 'object', additionalProperties: false,
  properties: {
    field: { type: 'string' },
    form_value: nullableStr,
    document_value: nullableStr,
    severity: { type: 'string' },
  },
  required: ['field', 'form_value', 'document_value', 'severity'],
};

const INVOICE_SCAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    document_payee: nullableStr,
    document_amount: { type: ['number', 'null'] },
    document_currency: nullableStr,
    document_invoice_number: nullableStr,
    document_date: nullableStr,
    discrepancies: { type: 'array', items: DISCREPANCY },
    summary: { type: 'string' },
  },
  required: ['document_payee', 'document_amount', 'document_currency', 'document_invoice_number', 'document_date', 'discrepancies', 'summary'],
};

const W9_SCAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    form_type: nullableStr,
    w9_name: nullableStr,
    w9_tin_present: { type: ['boolean', 'null'] },
    w9_signed: { type: ['boolean', 'null'] },
    w9_dated: { type: ['boolean', 'null'] },
    discrepancies: { type: 'array', items: DISCREPANCY },
    summary: { type: 'string' },
  },
  required: ['form_type', 'w9_name', 'w9_tin_present', 'w9_signed', 'w9_dated', 'discrepancies', 'summary'],
};

async function rescanInvoice(labelId, entryId) {
  if (!claude.isEnabled()) return { ok: false, reason: 'AI is not configured (no API key on server).' };
  // Family total covers multi-artist splits: parent + every child amount, so a
  // split family doesn't (wrongly) flag an amount mismatch on every child.
  const { rows } = await pool.query(
    `SELECT e.payee, e.artist, e.song, e.invoice_number, e.amount, e.currency,
            e.category, e.description, e.invoice_r2_key, e.invoice_filename,
            (e.amount + COALESCE((SELECT SUM(c.amount) FROM expenses c
               WHERE c.parent_id = COALESCE(e.parent_id, e.id)
                 AND (c.deleted = false OR c.deleted IS NULL)), 0)) AS family_amount
       FROM expenses e WHERE e.id = $1 AND e.label_id = $2`,
    [entryId, labelId]
  );
  const e = rows[0];
  if (!e) return { ok: false, reason: 'Entry not found.' };
  if (!e.invoice_r2_key) return { ok: false, reason: 'No invoice file is attached to this entry.' };
  const buffer = await loadFileBuffer(e.invoice_r2_key, null);
  if (!buffer) return { ok: false, reason: 'Invoice file could not be loaded from storage.' };

  const formAmount = Number(e.family_amount) || Number(e.amount) || 0;
  const instruction = `You are an invoice auditor for a record label. A vendor submitted an invoice along with a form. Compare the attached document against the form data and identify discrepancies.

FORM DATA:
- Vendor Name: ${e.payee || '(not provided)'}
- Artist: ${e.artist || '(not provided)'}
- Invoice Number: ${e.invoice_number || '(not provided)'}
- Amount: ${formAmount} ${e.currency || 'USD'}
- Category: ${e.category || '(not provided)'}
- Notes: ${e.description || '(none)'}

Read the document (OCR even if low-res/angled — a document IS attached, never claim otherwise). Extract document_payee, document_amount (number), document_currency (3-letter), document_invoice_number, document_date (YYYY-MM-DD). Then list discrepancies — each {field, form_value, document_value, severity}. Severities: amount mismatch = high, currency mismatch = high, vendor name mismatch = medium, invoice number mismatch = medium. Be tolerant of formatting ("INV-0034" ≡ "34", "Smith LLC" ≡ "Smith, LLC"). Empty discrepancies array if everything matches. summary = one sentence describing what you read.`;

  const r = await claude.extractFromFile({ buffer, mimeType: mimeFromKey(e.invoice_r2_key), instruction, schema: INVOICE_SCAN_SCHEMA, maxTokens: 1500 });
  if (!r.ok) return { ok: false, reason: r.error || 'AI call failed' };
  const scan = { ...r.data, scanned_at: new Date().toISOString() };
  await pool.query('UPDATE expenses SET ai_scan = $1 WHERE id = $2 AND label_id = $3', [JSON.stringify(scan), entryId, labelId]);
  return { ok: true, scan };
}

async function rescanW9(labelId, entryId) {
  if (!claude.isEnabled()) return { ok: false, reason: 'AI is not configured (no API key on server).' };
  // Use this entry's W9 if present, else the most recent W9 on file for the
  // same payee within the label.
  const { rows } = await pool.query(
    `SELECT e.payee, e.vendor_email, e.vendor_address,
            COALESCE(e.w9_r2_key, w9.w9_r2_key) AS w9_r2_key,
            COALESCE(e.w9_filename, w9.w9_filename) AS w9_filename
       FROM expenses e
       LEFT JOIN LATERAL (
         SELECT w9_r2_key, w9_filename FROM expenses x
          WHERE x.label_id = e.label_id AND LOWER(TRIM(x.payee)) = LOWER(TRIM(e.payee))
            AND x.w9_r2_key IS NOT NULL
          ORDER BY x.id DESC LIMIT 1
       ) w9 ON true
      WHERE e.id = $1 AND e.label_id = $2`,
    [entryId, labelId]
  );
  const e = rows[0];
  if (!e) return { ok: false, reason: 'Entry not found.' };
  if (!e.w9_r2_key) return { ok: false, reason: 'No W9/W8 file is attached or on file for this vendor.' };
  const buffer = await loadFileBuffer(e.w9_r2_key, null);
  if (!buffer) return { ok: false, reason: 'W9/W8 file could not be loaded from storage.' };

  const instruction = `You are auditing a W-9 or W-8 tax form submitted by a vendor to a record label. Compare it against the vendor's submitted info.

VENDOR INFO:
- Legal Name: ${e.payee || '(not provided)'}
- Email: ${e.vendor_email || '(not provided)'}
- Address: ${e.vendor_address || '(not provided)'}

Read the document (OCR even if imperfect — a document IS attached). Set form_type ("W-9" | "W-8BEN" | "W-8BEN-E" | "unknown"), w9_name (line 1 name), w9_tin_present, w9_signed, w9_dated. List discrepancies — each {field, form_value, document_value, severity}. Checks: name mismatch vs submitted legal name (high if completely different, medium if minor), missing TIN/SSN/EIN (high), missing signature (high), missing date (medium). Be reasonable about names ("John Smith" ≡ "John A. Smith"). If the document is clearly NOT a W-9/W-8 (e.g. a receipt or ID), add a discrepancy field "form_type", document_value=<what it is>, severity "high". summary = one sentence.`;

  const r = await claude.extractFromFile({ buffer, mimeType: mimeFromKey(e.w9_r2_key), instruction, schema: W9_SCAN_SCHEMA, maxTokens: 1500 });
  if (!r.ok) return { ok: false, reason: r.error || 'AI call failed' };
  const scan = { ...r.data, scanned_at: new Date().toISOString() };
  await pool.query('UPDATE expenses SET w9_scan = $1 WHERE id = $2 AND label_id = $3', [JSON.stringify(scan), entryId, labelId]);
  return { ok: true, scan };
}

module.exports = { rescanInvoice, rescanW9 };
