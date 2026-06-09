const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { uploadFile, getSignedFileUrl } = require('../lib/r2');
const { upsertVendor } = require('../lib/vendors');

const router = express.Router();

// PUBLIC routes — no auth. The label is identified by its slug in the URL, so
// each workspace has its own vendor form at /submit/<slug>. Everything created
// here lands as a PENDING ledger entry scoped to that label.

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const fileFields = upload.fields([
  { name: 'invoice_file', maxCount: 1 },
  { name: 'w9_file', maxCount: 1 },
  { name: 'receipt_file', maxCount: 1 },
]);

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function labelBySlug(slug) {
  const { rows } = await pool.query('SELECT id, name, slug, accent_color, logo_r2_key FROM labels WHERE slug = $1', [slug]);
  return rows[0] || null;
}

// GET /api/vendor/:slug — public context to render the form (name + branding).
router.get('/:slug', async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : null;
    res.json({
      success: true,
      data: { name: label.name, slug: label.slug, accent_color: label.accent_color, logo_url },
    });
  } catch (error) {
    console.error('Vendor context error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/vendor/:slug/submit — create a pending ledger entry for the label.
router.post('/:slug/submit', submitLimiter, fileFields, async (req, res) => {
  try {
    const label = await labelBySlug(req.params.slug);
    if (!label) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const labelId = label.id;

    const b = req.body;
    const vendorName = (b.vendor_name || '').trim();
    const vendorEmail = (b.vendor_email || '').trim();
    const vendorAddress = (b.vendor_address || '').trim();
    const vendorBank = (b.vendor_bank || '').trim();
    const artist = (b.artist || '').trim();
    const category = (b.category || '').trim();
    const invoiceNum = (b.invoice_number || '').trim();
    const paymentPref = (b.payment_method || '').trim();
    const amount = parseFloat(b.amount) || null;
    const isReimb = b.is_reimbursement === 'yes' || b.is_reimbursement === 'true';

    // Validation (mirrors the Boom public form's required set).
    const errors = [];
    if (!vendorName) errors.push('Please enter your legal / government name.');
    if (!vendorEmail) errors.push('Please enter your email address.');
    else if (!isValidEmail(vendorEmail)) errors.push('Please enter a valid email address.');
    if (!vendorAddress) errors.push('Please enter your mailing address.');
    if (!vendorBank) errors.push('Please enter your bank name.');
    if (!invoiceNum) errors.push('Please enter your invoice number.');
    if (!paymentPref) errors.push('Please select your preferred payment method.');
    if (!artist) errors.push('Please enter the artist or project name.');
    if (!category) errors.push('Please select a category.');
    if (!amount || amount <= 0) errors.push('Please enter a valid invoice amount.');
    if (errors.length) return res.status(400).json({ success: false, error: errors[0] });

    const invoiceFile = req.files?.invoice_file?.[0];
    const w9File = req.files?.w9_file?.[0];
    const receiptFile = req.files?.receipt_file?.[0];
    if (!invoiceFile) return res.status(400).json({ success: false, error: 'Please upload your invoice file.' });
    if (isReimb && !receiptFile) return res.status(400).json({ success: false, error: 'Please attach your supporting receipt.' });
    if (!isReimb && !w9File) {
      // Accept a W9 already on file — either on the vendor record or any prior
      // approved invoice for this vendor in this label.
      const { rows } = await pool.query(
        `SELECT 1 FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2) AND w9_r2_key IS NOT NULL
         UNION ALL
         SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(vendor_name) = LOWER($2)
           AND w9_r2_key IS NOT NULL AND (deleted = false OR deleted IS NULL) LIMIT 1`,
        [labelId, vendorName]
      );
      if (!rows.length) return res.status(400).json({ success: false, error: 'Please upload your W9 / W8 form.' });
    }

    // Duplicate guard — same vendor email + invoice number in this label.
    const dup = await pool.query(
      `SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(vendor_email) = LOWER($2)
         AND LOWER(invoice_number) = LOWER($3) AND status != 'rejected'
         AND (deleted = false OR deleted IS NULL) LIMIT 1`,
      [labelId, vendorEmail, invoiceNum]
    );
    if (dup.rows.length) {
      return res.status(409).json({ success: false, error: 'We already have a submission from you with that invoice number.' });
    }

    // Store files in R2 (tenant-namespaced).
    const store = async (file, kind) => {
      if (!file) return [null, null];
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `label-${labelId}/ledger/${kind}-${Date.now()}-${safe}`;
      await uploadFile(key, file.buffer, file.mimetype);
      return [file.originalname, key];
    };
    const [invName, invKey] = await store(invoiceFile, 'invoice');
    const [w9Name, w9Key] = await store(w9File, 'w9');
    const [rcName, rcKey] = await store(receiptFile, 'receipt');

    const { rows } = await pool.query(
      `INSERT INTO expenses (
        label_id, invoice_date, payee, description, category, artist, invoice_number,
        amount, currency, payment_method, status, payment_status,
        is_reimbursement, vendor_submitted, vendor_name, vendor_email, vendor_address, vendor_bank,
        rep, notes, invoice_filename, invoice_r2_key, w9_filename, w9_r2_key,
        receipt_filename, receipt_r2_key, created_by, created_at
      ) VALUES (
        $1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, COALESCE($8,'USD'), $9,
        'pending', 'Unpaid', $10, TRUE, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, 'Vendor Submission', NOW()
      ) RETURNING id`,
      [
        labelId, vendorName, (b.notes || '').trim() || null, category, artist, invoiceNum,
        amount, (b.currency || 'USD').trim(), paymentPref, isReimb,
        vendorName, vendorEmail, vendorAddress, vendorBank, (b.rep || '').trim() || null,
        (b.notes || '').trim() || null, invName, invKey, w9Name, w9Key, rcName, rcKey,
      ]
    );

    // Keep the vendor record current (contact + W9 for next time).
    upsertVendor(pool, labelId, {
      name: vendorName, email: vendorEmail, address: vendorAddress, bank: vendorBank,
      w9_r2_key: w9Key, w9_filename: w9Name,
    }).catch(() => {});

    // Audit it in the label's activity feed.
    pool.query(
      `INSERT INTO activity_log (label_id, action, detail, method, endpoint, created_at)
       VALUES ($1, 'Vendor submission received', $2, 'POST', $3, NOW())`,
      [labelId, `${vendorName} — ${invoiceNum}`, `/api/vendor/${label.slug}/submit`]
    ).catch(() => {});

    res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (error) {
    console.error('Vendor submit error:', error);
    res.status(500).json({ success: false, error: 'Submission failed. Please try again.' });
  }
});

module.exports = router;
