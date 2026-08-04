// Provider-agnostic transactional email.
//
// Delivery driver is chosen by environment, in priority order:
//   1. RESEND_API_KEY        → Resend HTTPS API (no dependency, uses fetch)
//   2. SENDGRID_API_KEY      → SendGrid HTTPS API (no dependency)
//   3. SMTP_HOST/USER/PASS   → SMTP via nodemailer (optional dependency)
//
// EMAIL_FROM is the sender (default john@deanst.co). With Resend/SendGrid the
// sending DOMAIN must be verified; with SMTP the mailbox sends it directly.
//
// If nothing is configured (or sending fails), sendEmail resolves to
// { sent: false, reason } instead of throwing — callers fall back to showing
// the invite link so the flow never hard-breaks on a missing key.

const FROM = process.env.EMAIL_FROM || 'Cadence <john@deanst.co>';

// nodemailer is optional — required lazily so the server still boots without it.
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* not installed — SMTP driver disabled */ }
let smtpTransport = null;

// Attachments are [{ filename, content (base64 string), contentType }].
const ccList = (cc) => (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean);

async function viaResend({ to, cc, subject, html, text, attachments, from, replyTo }) {
  const body = { from: from || FROM, to: [to], subject, html, text };
  if (replyTo) body.reply_to = replyTo;
  if (ccList(cc).length) body.cc = ccList(cc);
  if (attachments?.length) body.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}

async function viaSendgrid({ to, cc, subject, html, text, attachments, from: fromStr, replyTo }) {
  // SendGrid wants a bare address or "Name <addr>" split into name/email.
  const src = fromStr || FROM;
  const m = src.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  const from = m ? { name: m[1], email: m[2] } : { email: src };
  const personalization = { to: [{ email: to }] };
  if (ccList(cc).length) personalization.cc = ccList(cc).map(email => ({ email }));
  const body = {
    personalizations: [personalization], from, subject,
    content: [text ? { type: 'text/plain', value: text } : null, { type: 'text/html', value: html }].filter(Boolean),
  };
  if (replyTo) body.reply_to = { email: replyTo };
  if (attachments?.length) body.attachments = attachments.map(a => ({ content: a.content, filename: a.filename, type: a.contentType || 'application/octet-stream', disposition: 'attachment' }));
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}

async function viaSmtp({ to, cc, subject, html, text, attachments, from, replyTo }) {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT, 10) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const msg = { from: from || FROM, to, subject, html, text };
  if (replyTo) msg.replyTo = replyTo;
  if (ccList(cc).length) msg.cc = ccList(cc);
  if (attachments?.length) msg.attachments = attachments.map(a => ({ filename: a.filename, content: a.content, encoding: 'base64', contentType: a.contentType }));
  await smtpTransport.sendMail(msg);
  return true;
}

// Split the configured FROM into its verified address and default display name.
const FROM_ADDR = (FROM.match(/<([^>]+)>/)?.[1] || FROM).trim();
const FROM_NAME = (FROM.match(/^\s*(.*?)\s*</)?.[1] || 'Cadence').trim();

// Per-tenant identity: keep the verified sending ADDRESS (domain must stay
// verified with the provider) but show "<Label> via Cadence" as the display
// name, and set Reply-To to the label's chosen mailbox so vendors reply to the
// label, not to us.
function identityFor(label) {
  if (!label || !label.name) return { from: FROM, replyTo: null };
  const from = `${label.name} via Cadence <${FROM_ADDR}>`;
  const replyTo = label.email_reply_to || null;
  return { from, replyTo };
}

async function sendEmail({ to, cc, subject, html, text, attachments, label }) {
  try {
    if (!to) return { sent: false, reason: 'No recipient' };
    const { from, replyTo } = identityFor(label);
    const args = { to, cc, subject, html, text, attachments, from, replyTo };
    if (process.env.RESEND_API_KEY) { await viaResend(args); return { sent: true, via: 'resend' }; }
    if (process.env.SENDGRID_API_KEY) { await viaSendgrid(args); return { sent: true, via: 'sendgrid' }; }
    if (process.env.SMTP_HOST) {
      if (!nodemailer) return { sent: false, reason: 'SMTP_HOST is set but the nodemailer package is not installed on the server' };
      await viaSmtp(args);
      return { sent: true, via: 'smtp' };
    }
    console.warn('Email not sent: no email provider env vars are set (RESEND_API_KEY / SENDGRID_API_KEY / SMTP_HOST).');
    return { sent: false, reason: 'No email provider configured (set SMTP_* or RESEND_API_KEY in the server environment)' };
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

// ── Templates ─────────────────────────────────────────────────────────────

function inviteEmail({ inviteeName, workspaceName, inviterName, link, expiresDays }) {
  const subject = `You've been invited to ${workspaceName} on Cadence`;
  const safe = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:8px">
      <h2 style="color:#111;font-size:20px;margin:0 0 8px">You're invited to ${safe(workspaceName)}</h2>
      <p style="color:#444;font-size:14px;line-height:1.6">
        ${safe(inviterName) ? `${safe(inviterName)} has invited you` : 'You have been invited'} to join
        <strong>${safe(workspaceName)}</strong> on Cadence. Click below to set your password and get started.
      </p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#4F46E5;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;display:inline-block">Accept invitation</a>
      </p>
      <p style="color:#888;font-size:12px;line-height:1.6">
        Or paste this link into your browser:<br><span style="color:#4F46E5;word-break:break-all">${link}</span>
      </p>
      <p style="color:#aaa;font-size:11px;margin-top:24px">This invitation expires in ${expiresDays} days. If you weren't expecting it, you can ignore this email.</p>
    </div>`;
  const text = `You've been invited to join ${workspaceName} on Cadence.\n\nSet your password and get started:\n${link}\n\nThis invitation expires in ${expiresDays} days.`;
  return { subject, html, text };
}

const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const ACCENT = '#4F46E5';
// Normalize an accent to a safe hex; fall back to the Cadence indigo.
const accentOf = (a) => (typeof a === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.trim()) ? a.trim() : ACCENT);
const shell = (title, bodyHtml, accent) => {
  const a = accentOf(accent);
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:8px">
    <div style="height:4px;border-radius:4px;background:${a};margin:0 0 14px"></div>
    <h2 style="color:#111;font-size:18px;margin:0 0 8px">${esc(title)}</h2>
    ${bodyHtml}
    <p style="color:#aaa;font-size:11px;margin-top:24px">Sent via Cadence.</p>
  </div>`;
};
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

// Vendor's invoice was approved or rejected.
function vendorDecisionEmail({ vendorName, workspaceName, approved, invoiceNumber, amount, currency, reason, accent }) {
  const subject = approved
    ? `Your invoice ${invoiceNumber || ''} was approved by ${workspaceName}`.trim()
    : `Update on your invoice ${invoiceNumber || ''} for ${workspaceName}`.trim();
  const body = approved
    ? `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(vendorName)},</p>
       <p style="color:#444;font-size:14px;line-height:1.6"><strong>${esc(workspaceName)}</strong> has approved your invoice${invoiceNumber ? ` <strong>${esc(invoiceNumber)}</strong>` : ''}${amount ? ` for ${esc(money(amount, currency))}` : ''}. Payment will follow per your agreed terms.</p>`
    : `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(vendorName)},</p>
       <p style="color:#444;font-size:14px;line-height:1.6"><strong>${esc(workspaceName)}</strong> was unable to approve your invoice${invoiceNumber ? ` <strong>${esc(invoiceNumber)}</strong>` : ''}.${reason ? ` Reason: ${esc(reason)}.` : ''} Please reach out if you have questions.</p>`;
  return { subject, html: shell(approved ? 'Invoice approved' : 'Invoice update', body, accent), text: `${subject}` };
}

// Vendor's invoice was paid.
function paymentConfirmationEmail({ vendorName, workspaceName, invoiceNumber, amount, currency, method, date, accent }) {
  const subject = `Payment sent by ${workspaceName}${invoiceNumber ? ` — invoice ${invoiceNumber}` : ''}`;
  const body = `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(vendorName)},</p>
    <p style="color:#444;font-size:14px;line-height:1.6"><strong>${esc(workspaceName)}</strong> has sent payment${amount ? ` of <strong>${esc(money(amount, currency))}</strong>` : ''}${invoiceNumber ? ` for invoice <strong>${esc(invoiceNumber)}</strong>` : ''}${method ? ` via ${esc(method)}` : ''}${date ? ` on ${esc(date)}` : ''}.</p>`;
  return { subject, html: shell('Payment sent', body, accent), text: subject };
}

// Self-service password reset. Link points at the client /reset-password page.
function passwordResetEmail({ userName, workspaceName, link, expiresMinutes, accent }) {
  const a = accentOf(accent);
  const subject = `Reset your ${workspaceName || 'Cadence'} password`;
  const body = `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(userName || 'there')},</p>
    <p style="color:#444;font-size:14px;line-height:1.6">We received a request to reset your password${workspaceName ? ` for <strong>${esc(workspaceName)}</strong>` : ''} on Cadence. Click below to choose a new one.</p>
    <p style="margin:22px 0"><a href="${link}" style="background:${a};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;display:inline-block">Reset password</a></p>
    <p style="color:#888;font-size:12px;line-height:1.6">Or paste this link into your browser:<br><span style="color:${a};word-break:break-all">${link}</span></p>
    <p style="color:#aaa;font-size:11px;margin-top:20px">This link expires in ${expiresMinutes || 60} minutes. If you didn't request this, you can safely ignore this email — your password won't change.</p>`;
  return { subject, html: shell('Password reset', body, accent), text: `${subject}\n\nReset your password:\n${link}\n\nThis link expires in ${expiresMinutes || 60} minutes. If you didn't request it, ignore this email.` };
}

// A task was assigned to a team member.
function taskAssignmentEmail({ assigneeName, workspaceName, description, dueDate, priority, assignerName, link }) {
  const subject = `New task assigned to you in ${workspaceName}`;
  const body = `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(assigneeName)},</p>
    <p style="color:#444;font-size:14px;line-height:1.6">${assignerName ? `${esc(assignerName)} assigned you a task` : 'You have a new task'} in <strong>${esc(workspaceName)}</strong>:</p>
    <p style="color:#111;font-size:14px;line-height:1.6;background:#f4f4f6;border-radius:8px;padding:12px"><strong>${esc(description)}</strong>${priority ? `<br><span style="color:#888;font-size:12px">Priority: ${esc(priority)}</span>` : ''}${dueDate ? `<br><span style="color:#888;font-size:12px">Due: ${esc(dueDate)}</span>` : ''}</p>
    ${link ? `<p style="margin:18px 0"><a href="${link}" style="background:#4F46E5;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;display:inline-block">Open My Work</a></p>` : ''}`;
  return { subject, html: shell('New task', body), text: `${subject}: ${description}` };
}

// Internal "request a feature / report a bug" submission → platform team.
function internalRequestEmail({ userName, userEmail, workspaceName, requestType, title, details, page }) {
  const subject = `[${requestType || 'Request'}] ${title || 'Internal request'} — ${workspaceName}`;
  const body = `<p style="color:#444;font-size:14px;line-height:1.6"><strong>${esc(userName)}</strong> (${esc(userEmail)}) from <strong>${esc(workspaceName)}</strong> submitted a ${esc(requestType || 'request')}:</p>
    <p style="color:#111;font-size:14px;line-height:1.6;background:#f4f4f6;border-radius:8px;padding:12px"><strong>${esc(title)}</strong><br>${esc(details).replace(/\n/g, '<br>')}</p>
    ${page ? `<p style="color:#888;font-size:12px">From page: ${esc(page)}</p>` : ''}`;
  return { subject, html: shell('Internal request', body), text: `${subject}\n\n${details || ''}` };
}

// Batch of invoices sent to a named approver for sign-off (Excel + PDFs attached).
function approvalRequestEmail({ approverName, workspaceName, count, totalLine, note }) {
  const subject = `${workspaceName}: ${count} invoice${count === 1 ? '' : 's'} for your approval`;
  const body = `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(approverName || 'there')},</p>
    <p style="color:#444;font-size:14px;line-height:1.6"><strong>${esc(workspaceName)}</strong> has ${count} invoice${count === 1 ? '' : 's'} totalling <strong>${esc(totalLine || '')}</strong> awaiting your approval. A summary spreadsheet and the invoice PDFs are attached.</p>
    ${note ? `<p style="color:#444;font-size:14px;line-height:1.6">${esc(note).replace(/\n/g, '<br>')}</p>` : ''}`;
  return { subject, html: shell('Invoices for approval', body), text: subject };
}

// Someone @-mentioned you in chat (sent when you're not currently online).
function chatMentionEmail({ recipientName, actorName, workspaceName, channelLabel, snippet, link }) {
  const subject = `${actorName || 'Someone'} mentioned you in ${workspaceName}`;
  const body = `<p style="color:#444;font-size:14px;line-height:1.6">Hi ${esc(recipientName || 'there')},</p>
    <p style="color:#444;font-size:14px;line-height:1.6"><strong>${esc(actorName || 'Someone')}</strong> mentioned you in <strong>${esc(channelLabel || 'a conversation')}</strong> on <strong>${esc(workspaceName)}</strong>:</p>
    <p style="color:#111;font-size:14px;line-height:1.6;background:#f4f4f6;border-radius:8px;padding:12px;border-left:3px solid #4F46E5">${esc(snippet).replace(/\n/g, '<br>')}</p>
    ${link ? `<p style="margin:18px 0"><a href="${link}" style="background:#4F46E5;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;display:inline-block">Open in Cadence</a></p>` : ''}`;
  return { subject, html: shell('You were mentioned', body), text: `${subject}: ${snippet}` };
}

module.exports = { sendEmail, identityFor, inviteEmail, vendorDecisionEmail, paymentConfirmationEmail, passwordResetEmail, taskAssignmentEmail, internalRequestEmail, approvalRequestEmail, chatMentionEmail };
