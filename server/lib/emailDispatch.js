// Email dispatch layer. One place that maps an email "kind" to its template
// and knows how to (a) render a preview payload and (b) send with the admin's
// edits applied. Every outbound email flows through here so EmailPreviewModal
// can show a rendered, editable preview before anything is sent.
//
// Callers (routes) resolve the context — recipient(s), template fields, and any
// attachment R2 keys — and pass it in. This keeps dispatch DB-agnostic; the
// routes already have the tenant-scoped rows in hand.

const email = require('./email');
const pool = require('../db');
const { loadFileBase64 } = require('./r2');

// Resolve a tenant's outbound-email identity (display name, accent, reply-to)
// from the labels row. Reply-to lives in labels.settings.email_reply_to.
async function loadLabelIdentity(labelId) {
  if (!labelId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT name, accent_color, COALESCE(settings->>'email_reply_to','') AS email_reply_to FROM labels WHERE id = $1`,
      [labelId]
    );
    if (!rows.length) return null;
    return { name: rows[0].name, accent_color: rows[0].accent_color || null, email_reply_to: rows[0].email_reply_to || null };
  } catch { return null; }
}

// kind → (ctx) => { subject, html, text }
const TEMPLATES = {
  welcome:               (c) => email.inviteEmail(c),
  vendor_approved:       (c) => email.vendorDecisionEmail({ ...c, approved: true }),
  vendor_rejected:       (c) => email.vendorDecisionEmail({ ...c, approved: false }),
  payment_confirmation:  (c) => email.paymentConfirmationEmail(c),
  bulk_payment_confirmation: (c) => email.paymentConfirmationEmail(c), // per-vendor; queued client-side
  task_assigned:         (c) => email.taskAssignmentEmail(c),
  internal_request:      (c) => email.internalRequestEmail(c),
  approval_request:      (c) => email.approvalRequestEmail(c),
};

const KINDS = Object.keys(TEMPLATES);

function render(kind, ctx = {}) {
  const fn = TEMPLATES[kind];
  if (!fn) throw new Error(`Unknown email kind: ${kind}`);
  // Let the label's accent tint the template even when the caller didn't pass
  // one explicitly (ctx.label is the tenant identity object).
  const withAccent = ctx.accent || ctx.label?.accent_color ? { accent: ctx.accent || ctx.label?.accent_color, ...ctx } : ctx;
  return fn(withAccent);
}

const toCc = (cc) => (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean);

// Lightweight — no file loading. Returns what the preview modal needs.
function prepareEmail(kind, ctx = {}) {
  const { subject, html } = render(kind, ctx);
  return {
    to: ctx.to || '',
    cc: toCc(ctx.cc),
    subject,
    html,
    // Preview callers can't carry real attachments (the /email/preview route
    // strips them as a security boundary) — they pass display-only
    // attachmentLabels instead so the modal still shows what WILL be attached
    // by the feature route that ultimately sends.
    attachmentLabels: (ctx.attachments && ctx.attachments.length)
      ? ctx.attachments.map(a => a.filename)
      : (Array.isArray(ctx.attachmentLabels) ? ctx.attachmentLabels.map(String) : []),
  };
}

// Load attachment R2 keys → provider-ready base64 blobs. Skips any that fail.
async function loadAttachments(list = []) {
  const out = [];
  for (const a of list) {
    if (a.content) { out.push({ filename: a.filename, content: a.content, contentType: a.contentType }); continue; }
    if (!a.r2_key) continue;
    const b64 = await loadFileBase64(a.r2_key, a.legacy || null).catch(() => null);
    if (b64) out.push({ filename: a.filename || 'attachment', content: b64, contentType: a.contentType });
  }
  return out;
}

// Send, applying the admin's overrides (to / cc / subject / html_override).
async function dispatchSend(kind, ctx = {}, override = {}) {
  // Self-resolve tenant identity when the caller passed a labelId but no label.
  if (ctx.labelId && !ctx.label) {
    const id = await loadLabelIdentity(ctx.labelId);
    if (id) ctx = { ...ctx, label: id, accent: ctx.accent || id.accent_color };
  }
  const base = render(kind, ctx);
  const to = override.to || ctx.to;
  const cc = toCc(override.cc !== undefined ? override.cc : ctx.cc);
  const subject = override.subject || base.subject;
  const html = override.html_override || override.html || base.html;
  const attachments = await loadAttachments(ctx.attachments);
  return email.sendEmail({ to, cc, subject, html, text: base.text, attachments, label: ctx.label });
}

module.exports = { KINDS, prepareEmail, dispatchSend, render, loadLabelIdentity };
