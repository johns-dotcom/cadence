/**
 * The assignment email, in one place.
 *
 * Extracted from routes/tasks.js when the operator console gained the ability
 * to assign work into a workspace from outside it. Both callers build the same
 * payload for the same `task_assigned` template, and a second copy is how the
 * console ends up sending a mail that says something the tenant's own route
 * would not.
 *
 * `labelId` is a PARAMETER rather than req.labelId: the console has no single
 * tenant, and the assignee's workspace is the one the task was filed into.
 */
const pool = require('../db');
const { sendEmail, taskAssignmentEmail } = require('./email');
const { loadLabelIdentity } = require('./emailDispatch');

/**
 * Resolve the assignee inside their own workspace and build the template
 * context. Returns null when there is nobody to write to — a missing email is
 * not an error, it is a person who cannot be notified.
 */
async function buildAssignmentCtx({ labelId, assigneeId, task, assignerName, origin }) {
  const { rows } = await pool.query(
    `SELECT u.name, u.email, l.name AS workspace FROM users u JOIN labels l ON l.id = u.label_id
      WHERE u.id = $1 AND u.label_id = $2`,
    [assigneeId, labelId]
  );
  const a = rows[0];
  if (!a?.email) return null;
  const base = (origin || '').replace(/\/$/, '');
  return {
    to: a.email,
    assigneeName: a.name, workspaceName: a.workspace, description: task.description,
    dueDate: task.due_date ? String(task.due_date).slice(0, 10) : null, priority: task.priority,
    assignerName, link: base ? `${base}/my-work` : null,
    // The workspace this task belongs to — so the mail goes out as THEM, which
    // for a console assignment is the target tenant, not the operator's own.
    _label: await loadLabelIdentity(labelId),
  };
}

// Best-effort: an assignment must not fail because a mail server is down.
function sendAssignment(ctx) {
  if (!ctx) return;
  const msg = taskAssignmentEmail(ctx);
  sendEmail({ to: ctx.to, subject: msg.subject, html: msg.html, text: msg.text, label: ctx._label }).catch(() => {});
}

module.exports = { buildAssignmentCtx, sendAssignment };
