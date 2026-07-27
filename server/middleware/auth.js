const jwt = require('jsonwebtoken');
const pool = require('../db');

// Ensure token_version column exists (session invalidation support).
pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 0')
  .catch(e => console.warn('token_version migration:', e.message));

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Every authenticated request must be bound to a tenant. A token without
    // a label_id is malformed/stale — reject rather than risk an unscoped query.
    if (!decoded.label_id) {
      return res.status(401).json({ success: false, error: 'Session not bound to a workspace. Please log in again.' });
    }

    // Verify token_version hasn't been bumped (session invalidation) + pull the
    // live role/flags so Settings changes take effect immediately.
    if (decoded.id) {
      let rows;
      if (decoded.is_platform_admin) {
        // Platform operators are NOT pinned to a tenant. Their home label_id can
        // change (relocation to Platform HQ) or a workspace can be deleted
        // without ending their session — resolve them by user id alone. (Their
        // token is signed by us, so trusting the is_platform_admin claim to pick
        // this branch is safe; the DB row is still the source of truth for the
        // actual flags overlaid below.)
        ({ rows } = await pool.query(
          `SELECT token_version, role, is_platform_admin, platform_role FROM users WHERE id = $1`,
          [decoded.id]
        ));
        if (!rows.length) return res.status(401).json({ success: false, error: 'Account no longer exists. Please log in again.' });
        if (decoded.tv !== undefined && rows[0].token_version !== decoded.tv) {
          return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
      } else {
        // Regular members stay strictly bound to their tenant (a token can never
        // resolve a user in another label).
        ({ rows } = await pool.query(
          `SELECT u.token_version, u.role, u.is_platform_admin, u.platform_role, l.status AS label_status
           FROM users u JOIN labels l ON l.id = u.label_id
           WHERE u.id = $1 AND u.label_id = $2`,
          [decoded.id, decoded.label_id]
        ));
        if (!rows.length) return res.status(401).json({ success: false, error: 'Account no longer exists. Please log in again.' });
        if (decoded.tv !== undefined && rows[0].token_version !== decoded.tv) {
          return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
        if (rows[0].label_status === 'suspended' && !rows[0].is_platform_admin) {
          return res.status(403).json({ success: false, error: 'This workspace has been suspended. Contact the platform operator.' });
        }
      }
      // Overlay fresh role + platform flags so permission gates use current values.
      if (rows[0].role) req.user.role = rows[0].role;
      req.user.is_platform_admin = !!rows[0].is_platform_admin;
      req.user.platform_role = rows[0].platform_role || null;
    }

    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
