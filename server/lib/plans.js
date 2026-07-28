// Subscription plan registry. Prices are monthly USD; `seats` null = unlimited.
// Plans live in code so pricing changes in one place; the DB stores only each
// workspace's plan key + billing status (+ an optional MRR override).

const PLANS = [
  { key: 'free', name: 'Free', price: 0, seats: 3, storageGb: 1 },
  { key: 'starter', name: 'Starter', price: 49, seats: 10, storageGb: 10 },
  { key: 'pro', name: 'Pro', price: 149, seats: 30, storageGb: 50 },
  { key: 'enterprise', name: 'Enterprise', price: 499, seats: null, storageGb: null },
]
const PLAN = Object.fromEntries(PLANS.map(p => [p.key, p]))
const PLAN_KEYS = new Set(PLANS.map(p => p.key))
const BILLING_STATUSES = ['trialing', 'active', 'past_due', 'canceled']

// A workspace contributes MRR only while active or past-due (owed); trialing
// and canceled contribute 0. An mrr_override wins over the list price.
function effectiveMrr(label) {
  if (!['active', 'past_due'].includes(label.billing_status)) return 0
  if (label.mrr_override != null) return Number(label.mrr_override)
  return PLAN[label.plan]?.price ?? 0
}

module.exports = { PLANS, PLAN, PLAN_KEYS, BILLING_STATUSES, effectiveMrr }
