/**
 * Role-based access guard middleware factory.
 * Usage: router.get('/admin-only', auth, requireRole('admin'), handler)
 * Multiple roles: requireRole('admin', 'doctor')
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
};

module.exports = requireRole;
