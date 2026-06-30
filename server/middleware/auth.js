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

    // Verify token_version hasn't been bumped (session invalidation), and at
    // the same time pull the live role from the DB so a role change made via
    // Settings takes effect immediately rather than only after re-login.
    // Scoped by label_id so a token can never resolve a user in another tenant.
    if (decoded.id) {
      const { rows } = await pool.query(
        `SELECT u.token_version, u.role, u.is_platform_admin, u.platform_role, l.status AS label_status
         FROM users u JOIN labels l ON l.id = u.label_id
         WHERE u.id = $1 AND u.label_id = $2`,
        [decoded.id, decoded.label_id]
      );
      if (!rows.length) {
        return res.status(401).json({ success: false, error: 'Account no longer exists. Please log in again.' });
      }
      if (decoded.tv !== undefined && rows[0].token_version !== decoded.tv) {
        return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
      }
      // A suspended workspace blocks all of its sessions — except platform
      // admins, who must still be able to enter and manage/reactivate it.
      if (rows[0].label_status === 'suspended' && !rows[0].is_platform_admin) {
        return res.status(403).json({ success: false, error: 'This workspace has been suspended. Contact the platform operator.' });
      }
      // Overlay the fresh role + platform-admin flag so permission gates see
      // the current values, not whatever was baked into the token at login.
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
