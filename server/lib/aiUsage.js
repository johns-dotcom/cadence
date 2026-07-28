const { AsyncLocalStorage } = require('async_hooks');
const pool = require('../db');

// Carries the current request's workspace id through the async call chain so
// the central Claude wrapper can meter/limit usage without every AI helper
// having to thread a labelId param. Set by withTenant via runWithLabel().
const als = new AsyncLocalStorage();

// Default monthly AI-call allowance per workspace (override per-label in
// ai_limits, or globally via env). -1 anywhere means unlimited.
const DEFAULT_LIMIT = parseInt(process.env.AI_MONTHLY_LIMIT || '500', 10);

function runWithLabel(labelId, fn) { return als.run({ labelId }, fn); }
function currentLabelId() { return als.getStore()?.labelId || null; }

function ym(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Returns { limit, type } where type is 'requests' or 'tokens'.
async function limitFor(labelId) {
  try {
    const { rows } = await pool.query('SELECT monthly_limit, limit_type FROM ai_limits WHERE label_id = $1', [labelId]);
    if (rows.length && rows[0].monthly_limit != null) {
      return { limit: rows[0].monthly_limit, type: rows[0].limit_type === 'tokens' ? 'tokens' : 'requests' };
    }
  } catch { /* table may not exist yet */ }
  return { limit: DEFAULT_LIMIT, type: 'requests' };
}

async function usageFor(labelId, month = ym()) {
  try {
    const { rows } = await pool.query('SELECT calls, in_tokens, out_tokens FROM ai_usage WHERE label_id = $1 AND ym = $2', [labelId, month]);
    if (rows.length) return { calls: rows[0].calls, in_tokens: Number(rows[0].in_tokens), out_tokens: Number(rows[0].out_tokens) };
  } catch { /* ignore */ }
  return { calls: 0, in_tokens: 0, out_tokens: 0 };
}

// { ok, limit, type, used, remaining } — ok=false when the workspace is over
// quota. `used` is measured in the limit's unit (requests or tokens).
async function check(labelId) {
  if (!labelId) return { ok: true };
  const { limit, type } = await limitFor(labelId);
  if (limit < 0) return { ok: true, limit: -1, type, used: 0, remaining: Infinity };
  const u = await usageFor(labelId);
  const used = type === 'tokens' ? (u.in_tokens + u.out_tokens) : u.calls;
  return { ok: used < limit, limit, type, used, remaining: Math.max(0, limit - used) };
}

// Increment the workspace's usage for the current month (best-effort).
async function record(labelId, { input = 0, output = 0 } = {}) {
  if (!labelId) return;
  try {
    await pool.query(
      `INSERT INTO ai_usage (label_id, ym, calls, in_tokens, out_tokens) VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (label_id, ym) DO UPDATE SET
         calls = ai_usage.calls + 1,
         in_tokens = ai_usage.in_tokens + $3,
         out_tokens = ai_usage.out_tokens + $4`,
      [labelId, ym(), input || 0, output || 0]
    );
  } catch (e) { console.warn('AI usage record failed:', e.message); }
}

module.exports = { als, runWithLabel, currentLabelId, check, record, limitFor, usageFor, ym, DEFAULT_LIMIT };
