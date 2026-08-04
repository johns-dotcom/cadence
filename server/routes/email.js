// Generic preview/send for text emails that an admin composes in the
// EmailPreviewModal. Attachment-bearing sends (vendor invoice PDFs, approval
// spreadsheets) go through their feature routes, which resolve files
// server-side — this generic route never accepts client-supplied R2 keys.

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { prepareEmail, dispatchSend, KINDS } = require('../lib/emailDispatch');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// Inject the true workspace name; never trust a client-supplied one. Drop any
// attachment references from client input.
async function safeCtx(labelId, ctx = {}) {
  const { rows } = await pool.query('SELECT name FROM labels WHERE id = $1', [labelId]);
  const { attachments, label, labelId: _lid, ...rest } = ctx;
  // labelId is injected server-side so dispatchSend self-loads the tenant's
  // outbound identity (display name, accent, reply-to) — never client-supplied.
  return { ...rest, labelId, workspaceName: rows[0]?.name || 'the label' };
}

// POST /api/email/preview { kind, ctx }
router.post('/preview', async (req, res) => {
  try {
    const { kind, ctx } = req.body;
    if (!KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'Unknown email type' });
    const data = prepareEmail(kind, await safeCtx(req.labelId, ctx));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Email preview error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/email/send { kind, ctx, override:{to,cc,subject,html_override} }
router.post('/send', async (req, res) => {
  try {
    const { kind, ctx, override } = req.body;
    if (!KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'Unknown email type' });
    const result = await dispatchSend(kind, await safeCtx(req.labelId, ctx), override || {});
    if (!result.sent) return res.status(502).json({ success: false, error: result.reason || 'Send failed' });
    await logActivity(req, 'Sent email', `${kind} → ${override?.to || ctx?.to || ''}`);
    res.json({ success: true, data: { to: override?.to || ctx?.to, cc: override?.cc ?? ctx?.cc ?? [] } });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
