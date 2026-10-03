export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    // req.user is securely populated by the Firebase auth.js middleware
    if (!req.user || !req.user.role) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User identity not found.' });
    }

    // This eliminates the payload spoofing
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `Forbidden: Action requires one of [${allowedRoles.join(', ')}].` 
      });
    }

    next();
  };
};