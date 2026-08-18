// middleware/auth.js — JWT via cookie httpOnly (pas de localStorage, surface XSS réduite)
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, COOKIE_OPTS } = require('../config');
const { apiError } = require('./errors');

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(required = true) {
  return (req, res, next) => {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      if (required) return apiError(res, 401, 'Non connecté', 'UNAUTHORIZED');
      req.user = null;
      return next();
    }
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      if (required) return apiError(res, 401, 'Session expirée', 'UNAUTHORIZED');
      req.user = null;
      next();
    }
  };
}

// À placer après auth() sur une route : exige que l'utilisateur connecté soit admin.
function requireAdmin(req, res, next) {
  const u = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.user.id);
  if (!u?.is_admin) return apiError(res, 403, 'Réservé aux administrateurs', 'FORBIDDEN');
  next();
}

module.exports = { sign, auth, requireAdmin, COOKIE_OPTS };
