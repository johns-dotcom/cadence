const jwt = require('jsonwebtoken');

// Sign a session JWT. The label_id is the tenant boundary — it's baked into
// every token and re-checked on every request by authMiddleware.
function signToken(user, expiresIn = '8h') {
  return jwt.sign(
    {
      id: user.id,
      label_id: user.label_id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      hierarchy_level: user.hierarchy_level,
      is_platform_admin: !!user.is_platform_admin,
      platform_role: user.platform_role || null,
      tv: user.token_version || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    label_id: u.label_id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    hierarchy_level: u.hierarchy_level,
    is_platform_admin: !!u.is_platform_admin,
    platform_role: u.platform_role || null,
  };
}

module.exports = { signToken, publicUser };
