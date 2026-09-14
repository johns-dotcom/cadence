// Cross-workspace roll-ups for the operator console.
//
// Pure — no pool, no network — so the money rule and the attention rules can be
// held by fixtures rather than only ever exercised through an HTTP route.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Money ───────────────────────────────────────────────────────────────────
//
// Money arrives in two halves on purpose. A cross-tenant month is mostly plain
// USD rows, and converting those one at a time in JS costs a pass over every
// row in every workspace for no arithmetic. So SQL sums the rows that need no
// conversion — already rounded AT THE ROW, `SUM(ROUND(amount,2))`, which is the
// repo's convention and what makes the operator figure equal the tenant
// dashboard's for the same month — and only the rows that genuinely need a rate
// are pulled and converted.
//
// `agg`  rows: { label_id, invoices, plain_logged, plain_paid }
// `rows` rows: { label_id, usd, payment_status }  ← `usd` already resolved by
//              the caller through lib/usd's rule (a locked fx_rate_to_usd
//              ALWAYS wins; never a silent 1:1).
//
// Returns Map<label_id, { invoices, logged, paid }>.
function foldMoney(agg = [], rows = []) {
  const out = new Map();
  const at = (id) => {
    const k = Number(id);
    if (!out.has(k)) out.set(k, { invoices: 0, logged: 0, paid: 0 });
    return out.get(k);
  };
  for (const a of agg) {
    const e = at(a.label_id);
    e.invoices += Number(a.invoices) || 0;
    e.logged += Number(a.plain_logged) || 0;
    e.paid += Number(a.plain_paid) || 0;
  }
  for (const r of rows) {
    const e = at(r.label_id);
    const usd = round2(r.usd);
    e.logged += usd;
    if (r.payment_status === 'Paid') e.paid += usd;
  }
  // Round once more at the END of the fold, not per addition: the parts are
  // already row-rounded, so this only clears float drift from summing them.
  for (const e of out.values()) { e.logged = round2(e.logged); e.paid = round2(e.paid); }
  return out;
}

// ── Needs attention ─────────────────────────────────────────────────────────
//
// Deliberately only conditions a human would ACT on. "12 releases" is a fact,
// not a problem; a workspace nobody has touched in a month, or one with an
// approval queue piling up, is something an operator can do something about.
const SEVERITY_RANK = { danger: 0, warning: 1, info: 2 };

function buildAttention(workspaces = [], opts = {}) {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now || Date.now());
  const idleDays = opts.idleDays || 30;
  const backlog = opts.backlog || 5;
  const items = [];

  for (const w of workspaces) {
    const name = w.name || `Workspace ${w.id}`;
    if (w.status === 'suspended') {
      items.push({ label_id: w.id, workspace: name, kind: 'suspended', severity: 'danger', text: 'Suspended — members cannot sign in' });
    }
    if (!Number(w.members)) {
      items.push({ label_id: w.id, workspace: name, kind: 'no_members', severity: 'warning', text: 'No members yet — nobody can use this workspace' });
    }
    const pending = Number(w.pending) || 0;
    if (pending > 0) {
      items.push({
        label_id: w.id, workspace: name, kind: 'pending_approvals',
        severity: pending >= backlog ? 'warning' : 'info',
        text: `${pending} invoice${pending === 1 ? '' : 's'} awaiting approval`,
      });
    }
    // A suspended workspace is idle BY DESIGN — saying so twice buries the one
    // line that explains the other.
    if (w.status !== 'suspended') {
      const last = w.last_active ? new Date(w.last_active).getTime() : null;
      if (!last || Number.isNaN(last)) {
        items.push({ label_id: w.id, workspace: name, kind: 'never_active', severity: 'info', text: 'No recorded activity yet' });
      } else {
        const days = Math.floor((now - last) / 86400000);
        if (days >= idleDays) {
          items.push({ label_id: w.id, workspace: name, kind: 'idle', severity: 'info', text: `No activity for ${days} days` });
        }
      }
    }
  }

  items.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.workspace.localeCompare(b.workspace) ||
    a.kind.localeCompare(b.kind));
  return items;
}

module.exports = { foldMoney, buildAttention, round2 };
