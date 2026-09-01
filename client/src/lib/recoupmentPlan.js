// The recoupment upload plan — a localStorage-backed working set that
// Recoupments writes to ("Add to plan") and Recoupment Planning reads from.
//
// ── Why a client-side store and not a server table ──
// A plan is a DRAFT of a decision, not the decision. Nothing here has happened
// to the ledger; the only writes are at commit, when the staged items are
// marked UFR (and stamped with their label). Persisting the draft server-side
// would make an abandoned half-thought look like shared state to the next
// admin, and every mutation below is a keystroke-grain edit.
//
// Shape: { [expenseId: number]: labelString }
//   • key present     → the item is staged
//   • value           → the recoupment_label to stamp at commit
//   • '' (empty)      → staged but unlabeled
//   • key absent      → not staged
//
// Flat on purpose (no group objects): items sharing a label render as a group
// without a second structure to keep in sync with this one.

const KEY = 'cadence_recoupment_plan_v1'
const DEFERRED_KEY = 'cadence_recoupment_plan_deferred_v1'

export function loadPlan() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Coerce and drop anything that is not an id → string pair. A corrupt entry
    // here would otherwise render as a phantom group with no items.
    const out = {}
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k)
      if (!Number.isFinite(id)) continue
      out[id] = typeof v === 'string' ? v : ''
    }
    return out
  } catch { return {} }
}

export function savePlan(plan) {
  try { localStorage.setItem(KEY, JSON.stringify(plan)) } catch { /* private mode */ }
  return plan
}

export function addToPlan(ids, label = '') {
  const plan = loadPlan()
  for (const id of ids || []) {
    const n = Number(id)
    if (!Number.isFinite(n)) continue
    // Adding again with no label must not wipe a label already set — "Add to
    // plan" is idempotent from a surface that knows nothing about labels.
    if (n in plan && label === '') continue
    plan[n] = label
  }
  return savePlan(plan)
}

export function removeFromPlan(ids) {
  const plan = loadPlan()
  for (const id of ids || []) delete plan[Number(id)]
  return savePlan(plan)
}

export function setLabelForItems(ids, label) {
  const plan = loadPlan()
  const safe = typeof label === 'string' ? label : ''
  for (const id of ids || []) {
    const n = Number(id)
    if (n in plan) plan[n] = safe
  }
  return savePlan(plan)
}

export function clearPlan() { return savePlan({}) }

export const isInPlan = (plan, id) => Number(id) in (plan || {})
export const planSize = (plan) => Object.keys(plan || {}).length

// ── Saved for later ─────────────────────────────────────────────────────────
// Artist buckets set aside for a future batch. Persisted for the same reason
// the plan is: an in-memory Set loses the "not this month" decision on every
// reload, and the artist silently rejoins the commit.
export function loadDeferred() {
  try {
    const arr = JSON.parse(localStorage.getItem(DEFERRED_KEY) || '[]')
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch { return new Set() }
}

export function saveDeferred(set) {
  try { localStorage.setItem(DEFERRED_KEY, JSON.stringify([...set])) } catch { /* private mode */ }
  return set
}
