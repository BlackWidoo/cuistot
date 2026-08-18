// routes/auth.js — inscription/connexion/compte. Monté sous /api.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { POINTS, award, badgesFor } = require('../gamification');
const { IS_PROD } = require('../config');
const { auth, sign, COOKIE_OPTS } = require('../middleware/auth');
const { validate, apiError } = require('../middleware/errors');
const { loginLimiter, registerLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');
const {
  registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema,
  avatarPatchSchema, deleteAccountSchema,
} = require('../schemas/auth');
const { publicUser, sanitizeAvatar, sanitizeAvatarColor } = require('../services/users');
const { sendPasswordResetEmail } = require('../services/email');

const router = express.Router();

router.post('/register', registerLimiter, validate(registerSchema), (req, res) => {
  const { username, email, password } = req.valid;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, email, password_hash, avatar) VALUES (?,?,?,?)'
    ).run(username, email, hash, 'pan');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    award(user.id, POINTS.DAILY_LOGIN, 'Bienvenue sur Cuistot !');
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const token = sign(fresh);
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ user: publicUser(fresh) });
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      return apiError(res, 409, 'Nom ou email déjà utilisé', 'CONFLICT');
    apiError(res, 500, 'Erreur serveur', 'SERVER_ERROR');
  }
});

router.post('/login', loginLimiter, validate(loginSchema), (req, res) => {
  const identifier = req.valid.email.trim();
  const user = db.prepare('SELECT * FROM users WHERE email=? OR LOWER(username)=?')
    .get(identifier.toLowerCase(), identifier.toLowerCase());
  if (!user || !bcrypt.compareSync(req.valid.password, user.password_hash))
    return apiError(res, 401, 'Identifiants incorrects', 'UNAUTHORIZED');
  if (user.is_suspended) return apiError(res, 403, 'Ce compte a été suspendu', 'SUSPENDED');

  // Bonus de connexion quotidien : série "souple", pas de pénalité si elle casse — un bonus
  // fixe la première fois qu'on se connecte un jour donné, c'est tout.
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_login_award_date !== today) {
    award(user.id, POINTS.DAILY_LOGIN, 'Connexion quotidienne');
    db.prepare('UPDATE users SET last_login_award_date=? WHERE id=?').run(today, user.id);
  }

  const token = sign(user);
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
  res.json({ ok: true });
});

router.get('/me', auth(false), (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), badges: badgesFor(u.id) });
});

// Choix de l'avatar (icône + couleur du profil)
router.patch('/me', auth(), validate(avatarPatchSchema), (req, res) => {
  const b = req.valid;
  const updates = {};
  if (b.avatar !== undefined) {
    const avatar = sanitizeAvatar(b.avatar, req.user.id);
    if (!avatar) return apiError(res, 403, 'Avatar pas encore débloqué', 'FORBIDDEN');
    updates.avatar = avatar;
  }
  if (b.avatar_color !== undefined) updates.avatar_color = sanitizeAvatarColor(b.avatar_color);
  if (updates.avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(updates.avatar, req.user.id);
  if (updates.avatar_color !== undefined) db.prepare('UPDATE users SET avatar_color=? WHERE id=?').run(updates.avatar_color, req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), badges: badgesFor(u.id) });
});

// ---------- Mot de passe oublié ----------
router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), async (req, res) => {
  const email = req.valid.email;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Réponse identique que le compte existe ou non, pour ne pas révéler quels emails sont inscrits
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
      .run(user.id, tokenHash, expiresAt);
    // APP_URL plutôt que reconstruire depuis les headers de la requête, qui ne sont pas fiables
    // (Host peut être falsifié par un client) — voir .env.example.
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/?reset=${token}`;
    try { await sendPasswordResetEmail(user.email, link); } catch (e) { console.error('Envoi email échoué :', e.message); }
    res.json({ ok: true, ...(IS_PROD ? {} : { devToken: token }) });
  } else {
    res.json({ ok: true });
  }
});

router.post('/reset-password', validate(resetPasswordSchema), (req, res) => {
  const { token, password } = req.valid;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND expires_at >= datetime('now')").get(tokenHash);
  if (!row) return apiError(res, 400, 'Lien invalide ou expiré', 'INVALID_TOKEN');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, row.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id);
  // TODO (Lot 3 complet) : invalider les sessions actives de l'utilisateur ici (nécessite un
  // identifiant de session / une table sessions — les JWT actuels sont sans état donc ne
  // peuvent pas être révoqués individuellement avant leur expiration naturelle de 30 jours).
  res.json({ ok: true });
});

// ---------- Compte : export et suppression ----------
router.get('/me/export', auth(), (req, res) => {
  const uid = req.user.id;
  const data = {
    user: db.prepare('SELECT id, username, email, bio, avatar, avatar_color, points, created_at FROM users WHERE id=?').get(uid),
    recipes: db.prepare('SELECT * FROM recipes WHERE author_id=?').all(uid),
    comments: db.prepare('SELECT * FROM comments WHERE user_id=?').all(uid),
    likes_given: db.prepare('SELECT recipe_id, created_at FROM likes WHERE user_id=?').all(uid),
    following: db.prepare('SELECT following_id, created_at FROM follows WHERE follower_id=?').all(uid),
    points_history: db.prepare('SELECT amount, reason, created_at FROM point_events WHERE user_id=?').all(uid),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="cuistot-mes-donnees.json"');
  res.json(data);
});

router.delete('/me', auth(), validate(deleteAccountSchema), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(req.valid.password, user.password_hash))
    return apiError(res, 401, 'Mot de passe incorrect', 'UNAUTHORIZED');
  // Toutes les tables liées ont ON DELETE CASCADE (recettes, likes, commentaires, follows,
  // favoris, notifications, historique de points, redemptions, participations aux défis...)
  db.prepare('DELETE FROM users WHERE id=?').run(user.id);
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
  res.json({ ok: true });
});

module.exports = router;
