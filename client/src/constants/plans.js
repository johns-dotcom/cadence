// Mirrors server/lib/plans.js — keep prices in sync. Monthly USD; seats null = unlimited.
export const PLANS = [
  { key: 'free', name: 'Free', price: 0, seats: 3 },
  { key: 'starter', name: 'Starter', price: 49, seats: 10 },
  { key: 'pro', name: 'Pro', price: 149, seats: 30 },
  { key: 'enterprise', name: 'Enterprise', price: 499, seats: null },
]
export const PLAN = Object.fromEntries(PLANS.map(p => [p.key, p]))
export const BILLING_STATUSES = ['trialing', 'active', 'past_due', 'canceled']
export const STATUS_STYLE = {
  trialing: 'bg-blue-100 text-blue-700',
  active: 'bg-emerald-100 text-emerald-700',
  past_due: 'bg-red-100 text-red-700',
  canceled: 'bg-gray-100 text-gray-500',
}
export const PLAN_STYLE = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-sky-100 text-sky-700',
  pro: 'bg-brand-100 text-brand-700',
  enterprise: 'bg-violet-100 text-violet-700',
}
export const money = (n) => `$${Number(n || 0).toLocaleString()}`
