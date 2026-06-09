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
function withTenant(req, res, next) {
  if (!req.user?.label_id) {
    return res.status(401).json({ success: false, error: 'No workspace context' });
  }
  req.labelId = req.user.label_id;
  next();
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

module.exports = { withTenant, requireRole, requireAdmin, requireApprover };
