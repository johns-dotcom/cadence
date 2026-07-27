// Email dispatch layer. One place that maps an email "kind" to its template
// and knows how to (a) render a preview payload and (b) send with the admin's
// edits applied. Every outbound email flows through here so EmailPreviewModal
// can show a rendered, editable preview before anything is sent.
//
// Callers (routes) resolve the context — recipient(s), template fields, and any
// attachment R2 keys — and pass it in. This keeps dispatch DB-agnostic; the
// routes already have the tenant-scoped rows in hand.

const email = require('./email');
const { loadFileBase64 } = require('./r2');

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
  return fn(ctx);
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
    attachmentLabels: (ctx.attachments || []).map(a => a.filename),
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
  const base = render(kind, ctx);
  const to = override.to || ctx.to;
  const cc = toCc(override.cc !== undefined ? override.cc : ctx.cc);
  const subject = override.subject || base.subject;
  const html = override.html_override || override.html || base.html;
  const attachments = await loadAttachments(ctx.attachments);
  return email.sendEmail({ to, cc, subject, html, text: base.text, attachments });
}

module.exports = { KINDS, prepareEmail, dispatchSend, render };
