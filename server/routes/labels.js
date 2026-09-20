const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, isConfigured } = require('../lib/r2');

const router = express.Router();
router.use(authMiddleware, withTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const HEX_RE = /^#([0-9a-fA-F]{6})$/;

// Resolve a short-lived signed URL for the label's logo (null if none/unset).
async function logoUrl(r2Key) {
  if (!r2Key) return null;
  try { return await getSignedFileUrl(r2Key, 6 * 3600); } catch { return null; }
}

// GET /api/label — current workspace settings + branding
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      // `invoice_settings` is DERIVED from label_records, which owns the
      // remittance block since §7. The key keeps its old shape so the invoice
      // PDF, the sidebar footer and the create-invoice preview did not have to
      // change — but there is now one place it can be edited.
      `SELECT l.id, l.name, l.slug, l.accent_color, l.logo_r2_key, l.logo_data, l.vendor_form_token, l.created_at,
              COALESCE(l.settings, '{}'::jsonb) AS settings,
              jsonb_build_object(
                'company_name',   COALESCE(NULLIF(r.company_name, ''), NULLIF(r.display_name, ''), l.name),
                'address',        r.address,
                'contact',        r.contact,
                'phone',          r.phone,
                'email',          r.email,
                'ein',            r.ein,
                'bank_name',      r.bank_name,
                'bank_address',   r.bank_address,
                'account_name',   r.account_name,
                'account_type',   r.account_type,
                'swift',          r.swift,
                'routing',        r.routing,
                'routing_ach',    r.routing_ach,
                'account_number', r.account_number
              ) AS invoice_settings,
              (SELECT COUNT(*) FROM users WHERE label_id = l.id) AS member_count
       FROM labels l
       LEFT JOIN label_records r ON r.label_id = l.id
       WHERE l.id = $1`,
      [req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = rows[0];
    label.logo_url = label.logo_r2_key ? await logoUrl(label.logo_r2_key) : (label.logo_data || null);
    delete label.logo_r2_key;
    // The address mail falls back to, so Settings can NAME it instead of saying
    // "the default" — and so nobody has to hardcode it in the client, where it
    // would drift from EMAIL_FROM the first time that changes.
    label.platform_from_address = require('../lib/email').PLATFORM_FROM_ADDRESS;
    delete label.logo_data;
    res.json({ success: true, data: label });
  } catch (error) {
    console.error('Get label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/label — rename + set accent color (admin only). Slug is immutable.
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const { name, accent_color, invoice_settings, settings } = req.body;

    if (accent_color !== undefined && accent_color !== null && accent_color !== '' && !HEX_RE.test(accent_color)) {
      return res.status(400).json({ success: false, error: 'Accent color must be a hex value like #4F46E5' });
    }
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' });
    }
    if (settings !== undefined && (typeof settings !== 'object' || Array.isArray(settings) || settings === null)) {
      return res.status(400).json({ success: false, error: 'Settings must be an object' });
    }
    // Reply-to is a real email address (empty string clears it).
    if (settings && settings.email_reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.email_reply_to).trim())) {
      return res.status(400).json({ success: false, error: 'Reply-to must be a valid email address' });
    }
    // The business timezone anchors invoice due dates AND analytics week
    // boundaries (lib/labelTz). Validated against Intl rather than a list: a zone
    // Intl cannot format would throw inside a date calculation later, far from
    // the person who typed it.
    if (settings && settings.business_tz !== undefined && String(settings.business_tz).trim() !== '') {
      const { isValidTz } = require('../lib/labelTz');
      if (!isValidTz(String(settings.business_tz).trim())) {
        return res.status(400).json({ success: false, error: 'That is not a recognised timezone (e.g. America/Los_Angeles, Europe/London)' });
      }
    }
    if (settings && settings.email_from_address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.email_from_address).trim())) {
      return res.status(400).json({ success: false, error: 'Send-from must be a valid email address' });
    }
    if (settings && settings.email_from_name !== undefined && String(settings.email_from_name).length > 80) {
      return res.status(400).json({ success: false, error: 'Sender name must be 80 characters or fewer' });
    }
    // Verification belongs to the endpoint that earns it, never to a PATCH body:
    // accepting a stamp from the client would let anyone assert that any address
    // is verified and start sending from it.
    if (settings) {
      delete settings.email_from_verified_at;
      delete settings.email_from_verified_for;
    }

    // Empty string clears the accent (back to Cadence default).
    const accentValue = accent_color === '' ? null : accent_color;

    // settings is shallow-merged (jsonb ||) so each Settings sub-section saves
    // independently without clobbering the others.
    const { rows } = await pool.query(
      `UPDATE labels SET
         name = COALESCE($1, name),
         accent_color = CASE WHEN $2::boolean THEN $3 ELSE accent_color END,
         settings = CASE WHEN $4::boolean THEN COALESCE(settings, '{}'::jsonb) || $5::jsonb ELSE settings END
       WHERE id = $6
       RETURNING id, name, slug, accent_color, COALESCE(settings, '{}'::jsonb) AS settings`,
      [name ?? null, accent_color !== undefined, accentValue,
       settings !== undefined, settings ? JSON.stringify(settings) : '{}',
       req.labelId]
    );

    // A caller still sending the old `invoice_settings` key is writing the
    // remittance block, which now lives in label_records. Write it THERE
    // rather than to a column nothing reads — a silently ignored save is a
    // worse failure than a rejected one, and an address that appears to save
    // but never shows up on an invoice is exactly that.
    if (invoice_settings !== undefined && invoice_settings) {
      const F = require('./label-record').REMITTANCE_FIELDS;
      const cols = F.join(', ');
      const ph = F.map((_, i) => `$${i + 2}`).join(', ');
      const upd = F.map(f => `${f} = EXCLUDED.${f}`).join(', ');
      await pool.query(
        `INSERT INTO label_records (label_id, ${cols}, updated_by, updated_at)
         VALUES ($1, ${ph}, $${F.length + 2}, NOW())
         ON CONFLICT (label_id) DO UPDATE SET
           ${upd}, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [req.labelId, ...F.map(f => (invoice_settings[f] ? String(invoice_settings[f]).trim() : null)), req.user.id]
      );
    }
    await logActivity(req, 'Updated workspace branding', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/email-sender/verify — prove a custom send-from address works,
// and only then let mail go out as it.
//
// The proof is a real send FROM that address. There is no cheaper honest check:
// the provider decides whether a domain is verified, not us, and a regex says
// nothing about whether Resend will accept it. On success we stamp the address
// that earned the stamp; on failure we return the provider's own words, which is
// what tells somebody their DNS is not set up yet.
router.post('/email-sender/verify', requireAdmin, async (req, res) => {
  try {
    const { sendEmail, PLATFORM_FROM_ADDRESS } = require('../lib/email');
    const { loadLabelIdentity } = require('../lib/emailDispatch');
    const address = String(req.body.from_address || '').trim();
    const to = String(req.body.to || req.user.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return res.status(400).json({ success: false, error: 'Enter a valid address to verify' });
    }
    if (!to) return res.status(400).json({ success: false, error: 'No recipient to send the test to' });

    const identity = await loadLabelIdentity(req.labelId);
    const name = String(req.body.from_name || identity?.email_from_name || identity?.name || 'Cadence').trim();

    // Sent with the candidate identity FORCED — not the stored one, or a first
    // verification would test the address it is trying to replace.
    const result = await sendEmail({
      to,
      subject: `Cadence: confirming ${address} can send for ${identity?.name || 'your workspace'}`,
      html: `<p>This test was sent from <strong>${address}</strong>.</p>
             <p>If you received it, that address is able to send your workspace's email — invites,
             vendor decisions, payment confirmations and alerts will now come from it.</p>`,
      text: `This test was sent from ${address}. If you received it, that address can send your workspace's email.`,
      label: {
        name: identity?.name || 'Cadence',
        email_from_name: name,
        email_from_address: address,
        // Treat it as verified FOR THIS SEND ONLY, so the test actually uses the
        // candidate. Nothing is persisted unless the provider accepts it.
        email_from_verified_at: new Date().toISOString(),
        email_from_verified_for: address,
        email_reply_to: identity?.email_reply_to || null,
      },
    });

    if (!result.sent) {
      return res.status(502).json({
        success: false,
        error: result.reason || 'The provider refused that address',
        hint: `Mail is still going out from ${PLATFORM_FROM_ADDRESS}. Verify the domain with your email provider, then try again.`,
      });
    }

    const { rows } = await pool.query(
      `UPDATE labels SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb
        WHERE id = $2
        RETURNING COALESCE(settings, '{}'::jsonb) AS settings`,
      [JSON.stringify({
        email_from_address: address,
        email_from_name: name,
        email_from_verified_at: new Date().toISOString(),
        email_from_verified_for: address,
      }), req.labelId]
    );
    await logActivity(req, 'Verified outbound email sender', address);
    res.json({ success: true, data: { settings: rows[0].settings, sent_to: to, via: result.via } });
  } catch (error) {
    console.error('Verify sender error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/test-email — send a sample email to the requesting admin
// using this workspace's outbound identity (display name + reply-to + accent),
// so they can confirm delivery and how it looks before it reaches vendors.
router.post('/test-email', requireAdmin, async (req, res) => {
  try {
    const { sendEmail } = require('../lib/email');
    const { loadLabelIdentity } = require('../lib/emailDispatch');
    const identity = await loadLabelIdentity(req.labelId);
    const to = (req.body.to && String(req.body.to).trim()) || req.user.email;
    if (!to) return res.status(400).json({ success: false, error: 'No recipient address' });

    const accent = /^#([0-9a-fA-F]{3,8})$/.test(String(identity?.accent_color || '')) ? identity.accent_color : '#4F46E5';
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:8px">
        <div style="height:4px;border-radius:4px;background:${accent};margin:0 0 14px"></div>
        <h2 style="color:#111;font-size:18px;margin:0 0 8px">Test email from ${identity?.name || 'your workspace'}</h2>
        <p style="color:#444;font-size:14px;line-height:1.6">This is a test message sent from your Cadence workspace. If you received it, outbound email is working.</p>
        <p style="color:#444;font-size:14px;line-height:1.6">Replies to this message go to <strong>${identity?.email_reply_to || 'your login email'}</strong>.</p>
        <p style="color:#aaa;font-size:11px;margin-top:24px">Sent via Cadence.</p>
      </div>`;
    const result = await sendEmail({ to, subject: `Test email — ${identity?.name || 'Cadence'}`, html, text: 'This is a test email from your Cadence workspace.', label: identity });
    if (!result.sent) return res.status(502).json({ success: false, error: result.reason || 'Send failed' });
    res.json({ success: true, data: { to, via: result.via } });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/vendor-form-token/rotate — mint a new public vendor-form
// token (admin only). Any previously-shared link stops working immediately.
router.post('/vendor-form-token/rotate', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE labels SET vendor_form_token = md5(random()::text || clock_timestamp()::text || id::text)
         WHERE id = $1 RETURNING vendor_form_token`,
      [req.labelId]
    );
    await logActivity(req, 'Rotated vendor form link', null);
    res.json({ success: true, data: { vendor_form_token: rows[0].vendor_form_token } });
  } catch (error) {
    console.error('Rotate vendor form token error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label/logo — upload/replace the workspace logo (admin only).
// Uses R2 when configured; otherwise falls back to storing a small logo inline
// as a data: URL so branding works without object storage.
router.post('/logo', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ success: false, error: 'Logo must be an image' });
    }
    const { rows: existing } = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [req.labelId]);
    const oldKey = existing[0]?.logo_r2_key;

    // Preferred path: object storage.
    if (isConfigured()) {
      try {
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `label-${req.labelId}/branding/logo-${Date.now()}-${safeName}`;
        await uploadFile(key, req.file.buffer, req.file.mimetype);
        if (oldKey) deleteFile(oldKey).catch(() => {});
        await pool.query('UPDATE labels SET logo_r2_key = $1, logo_data = NULL WHERE id = $2', [key, req.labelId]);
        await logActivity(req, 'Updated workspace logo', null);
        return res.json({ success: true, data: { logo_url: await logoUrl(key) } });
      } catch (e) {
        console.error('R2 logo upload failed, falling back to inline:', e.message);
        // fall through to inline
      }
    }

    // Inline fallback — keep it small (rows + /auth/me payload).
    if (req.file.buffer.length > 512 * 1024) {
      return res.status(400).json({ success: false, error: 'Logo must be under 512 KB (larger files need object storage to be configured).' });
    }
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    if (oldKey) deleteFile(oldKey).catch(() => {});
    await pool.query('UPDATE labels SET logo_data = $1, logo_r2_key = NULL WHERE id = $2', [dataUrl, req.labelId]);
    await logActivity(req, 'Updated workspace logo', null);
    res.json({ success: true, data: { logo_url: dataUrl } });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({ success: false, error: 'Logo upload failed' });
  }
});

// DELETE /api/label/logo — remove the workspace logo (admin only)
router.delete('/logo', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [req.labelId]);
    if (rows[0]?.logo_r2_key) deleteFile(rows[0].logo_r2_key).catch(() => {});
    await pool.query('UPDATE labels SET logo_r2_key = NULL, logo_data = NULL WHERE id = $1', [req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Logo delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
