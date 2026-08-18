// middleware/csrf.js — protection "double submit cookie"
// L'authentification repose sur un cookie envoyé automatiquement par le navigateur : sans
// protection supplémentaire, un site tiers pourrait déclencher une requête au nom de
// l'utilisateur connecté (like, suppression de recette...). Le jeton CSRF est lisible en JS
// (pas httpOnly) : un site tiers ne peut pas le lire à cause de la same-origin policy, donc
// ne peut pas le renvoyer dans le header personnalisé — seule notre propre app le peut.
const crypto = require('crypto');
const { IS_PROD } = require('../config');
const { apiError } = require('./errors');

function ensureCsrfCookie(req, res, next) {
  if (!req.cookies.csrf_token) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 864e5 });
    req.cookies.csrf_token = token; // dispo tout de suite si cette même requête est aussi vérifiée
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const header = req.headers['x-csrf-token'];
  if (!header || header !== req.cookies.csrf_token) {
    return apiError(res, 403, 'Requête refusée (jeton de sécurité manquant ou invalide)', 'CSRF_INVALID');
  }
  next();
}

module.exports = { ensureCsrfCookie, csrfProtect };
