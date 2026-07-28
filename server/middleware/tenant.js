/**
 * Tenant + role helpers.
 *
 * Cadence is multi-tenant: every row of tenant-owned data carries a
 * `label_id`, and `req.user.label_id` (set from the JWT by authMiddleware) is
 * the only label a request is ever allowed to touch. These helpers make that
 * contract explicit at the route layer.
 *
 * Usage:
 *   router.get('/', authMiddleware, (req, res) => {
 *     pool.query('SELECT * FROM releases WHERE label_id = $1', [req.labelId])
 *   })
 *
 *   router.post('/', authMiddleware, requireRole('Admin', 'Superadmin'), ...)
 */

// Exposes req.labelId as a convenience and hard-fails if it's somehow absent
// (authMiddleware already guarantees it, but this is a cheap belt-and-braces
// guard against an endpoint that forgets to mount authMiddleware first).
const { runWithLabel } = require('../lib/aiUsage');

function withTenant(req, res, next) {
  if (!req.user?.label_id) {
    return res.status(401).json({ success: false, error: 'No workspace context' });
  }
  req.labelId = req.user.label_id;
  // Run the rest of the request inside an async-local context carrying the
  // workspace id, so AI metering can attribute + limit usage per workspace.
  runWithLabel(req.labelId, () => next());
}

// Role gate factory. Roles are scoped within a label — a Superadmin owns their
// own label only, not the platform. Pass the roles allowed through.
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

// Common shorthands.
const requireAdmin = requireRole('Superadmin', 'Admin');
const requireApprover = requireRole('Superadmin', 'Admin', 'Approver');

// Platform-admin gate. This is the SaaS *operator* (you) — a level above any
// label's Superadmin. Platform admins provision new label workspaces and are
// the ONLY identity allowed to act across tenants. Everyone else is confined
// to their own label_id.
function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) {
    return res.status(403).json({ success: false, error: 'Platform administrator only' });
  }
  next();
}

// Owner-tier operators only — the privileged platform actions (provisioning,
// suspend/delete, operator management). Workspace Admins (platform_role
// 'admin') can view the console and enter workspaces, but not these.
function requirePlatformOwner(req, res, next) {
  if (!req.user?.is_platform_admin || req.user.platform_role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Platform owner only' });
  }
  next();
}

module.exports = { withTenant, requireRole, requireAdmin, requireApprover, requirePlatformAdmin, requirePlatformOwner };
