const jwt = require('jsonwebtoken');
const pool = require('../db');

// Ensure token_version column exists (session invalidation support).
pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 0')
  .catch(e => console.warn('token_version migration:', e.message));

const authMiddleware = async (req, res, next) => {
  // Authorization header only. The session token is deliberately NOT accepted
  // as a ?token= query param (it would leak the full session into access logs /
  // Referer). Files use file-scoped signed URLs; the socket uses handshake auth.
  const token = req.headers.authorization?.split(' ')[1];

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

    // Verify token_version + pull live role/flags. Resolve the user by id FIRST
    // (the DB is the source of truth — never the token's claims), then decide
    // tenant-pinning from the DB's is_platform_admin. This is what keeps an
    // operator signed in when their home label changes or is deleted, even if
    // their current token was minted while the flag was momentarily false.
    if (decoded.id) {
      const { rows } = await pool.query(
        `SELECT token_version, role, is_platform_admin, platform_role, label_id FROM users WHERE id = $1`,
        [decoded.id]
      );
      if (!rows.length) {
        return res.status(401).json({ success: false, error: 'Account no longer exists. Please log in again.' });
      }
      const u = rows[0];
      if (decoded.tv !== undefined && u.token_version !== decoded.tv) {
        return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
      }
      if (!u.is_platform_admin) {
        // Regular members stay strictly bound to their tenant: the token's label
        // must match the user's actual label, and the workspace must be active.
        if (Number(decoded.label_id) !== Number(u.label_id)) {
          return res.status(401).json({ success: false, error: 'Session not valid for this workspace. Please log in again.' });
        }
        const lab = await pool.query('SELECT status FROM labels WHERE id = $1', [u.label_id]);
        if (!lab.rows.length) {
          return res.status(401).json({ success: false, error: 'Workspace no longer exists. Please log in again.' });
        }
        if (lab.rows[0].status === 'suspended') {
          return res.status(403).json({ success: false, error: 'This workspace has been suspended. Contact the platform operator.' });
        }
      }
      // Overlay fresh role + platform flags so permission gates use current values.
      if (u.role) req.user.role = u.role;
      req.user.is_platform_admin = !!u.is_platform_admin;
      req.user.platform_role = u.platform_role || null;
    }

    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
