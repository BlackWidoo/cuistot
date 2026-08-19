// routes/auth.js — inscription/connexion/compte. Monté sous /api.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { POINTS, award, badgesFor } = require('../gamification');
const { IS_PROD } = require('../config');
const { auth, sign, COOKIE_OPTS } = require('../middleware/auth');
const { validate, apiError, asyncHandler } = require('../middleware/errors');
const { loginLimiter, registerLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  avatarPatchSchema,
  deleteAccountSchema,
} = require('../schemas/auth');
const { publicUser, sanitizeAvatar, sanitizeAvatarColor } = require('../services/users');
const { sendPasswordResetEmail } = require('../services/email');

const router = express.Router();

router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.valid;
    try {
      const hash = bcrypt.hashSync(password, 10);
      const { rows } = await db.run(
        'INSERT INTO users (username, email, password_hash, avatar) VALUES ($1,$2,$3,$4) RETURNING id',
        [username, email, hash, 'pan']
      );
      const fresh = await db.get('SELECT * FROM users WHERE id=$1', [rows[0].id]);
      await award(fresh.id, POINTS.DAILY_LOGIN, 'Bienvenue sur Cuistot !');
      const withPoints = await db.get('SELECT * FROM users WHERE id=$1', [fresh.id]);
      const token = sign(withPoints);
      res.cookie('token', token, COOKIE_OPTS);
      res.json({ user: await publicUser(withPoints) });
    } catch (e) {
      if (e.code === '23505')
        // violation de contrainte UNIQUE (Postgres)
        return apiError(res, 409, 'Nom ou email déjà utilisé', 'CONFLICT');
      throw e;
    }
  })
);

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const identifier = req.valid.email.trim();
    const user = await db.get('SELECT * FROM users WHERE email=$1 OR LOWER(username)=$1', [
      identifier.toLowerCase(),
    ]);
    if (!user || !bcrypt.compareSync(req.valid.password, user.password_hash))
      return apiError(res, 401, 'Identifiants incorrects', 'UNAUTHORIZED');
    if (user.is_suspended) return apiError(res, 403, 'Ce compte a été suspendu', 'SUSPENDED');

    // Bonus de connexion quotidien : série "souple", pas de pénalité si elle casse — un bonus
    // fixe la première fois qu'on se connecte un jour donné, c'est tout.
    const today = new Date().toISOString().slice(0, 10);
    if (user.last_login_award_date !== today) {
      await award(user.id, POINTS.DAILY_LOGIN, 'Connexion quotidienne');
      await db.run('UPDATE users SET last_login_award_date=$1 WHERE id=$2', [today, user.id]);
    }

    const token = sign(user);
    res.cookie('token', token, COOKIE_OPTS);
    const fresh = await db.get('SELECT * FROM users WHERE id=$1', [user.id]);
    res.json({ user: await publicUser(fresh) });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
  res.json({ ok: true });
});

router.get(
  '/me',
  auth(false),
  asyncHandler(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const u = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json({ user: await publicUser(u), badges: await badgesFor(u.id) });
  })
);

// Choix de l'avatar (icône + couleur du profil)
router.patch(
  '/me',
  auth(),
  validate(avatarPatchSchema),
  asyncHandler(async (req, res) => {
    const b = req.valid;
    const updates = {};
    if (b.avatar !== undefined) {
      const avatar = await sanitizeAvatar(b.avatar, req.user.id);
      if (!avatar) return apiError(res, 403, 'Avatar pas encore débloqué', 'FORBIDDEN');
      updates.avatar = avatar;
    }
    if (b.avatar_color !== undefined) updates.avatar_color = sanitizeAvatarColor(b.avatar_color);
    if (updates.avatar !== undefined)
      await db.run('UPDATE users SET avatar=$1 WHERE id=$2', [updates.avatar, req.user.id]);
    if (updates.avatar_color !== undefined)
      await db.run('UPDATE users SET avatar_color=$1 WHERE id=$2', [
        updates.avatar_color,
        req.user.id,
      ]);
    const u = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json({ user: await publicUser(u), badges: await badgesFor(u.id) });
  })
);

// ---------- Mot de passe oublié ----------
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const email = req.valid.email;
    const user = await db.get('SELECT * FROM users WHERE email=$1', [email]);
    // Réponse identique que le compte existe ou non, pour ne pas révéler quels emails sont inscrits
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.run('DELETE FROM password_resets WHERE user_id=$1', [user.id]);
      await db.run(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
        [user.id, tokenHash, expiresAt]
      );
      // APP_URL plutôt que reconstruire depuis les headers de la requête, qui ne sont pas fiables
      // (Host peut être falsifié par un client) — voir .env.example.
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/?reset=${token}`;
      try {
        await sendPasswordResetEmail(user.email, link);
      } catch (e) {
        console.error('Envoi email échoué :', e.message);
      }
      res.json({ ok: true, ...(IS_PROD ? {} : { devToken: token }) });
    } else {
      res.json({ ok: true });
    }
  })
);

router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.valid;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await db.get(
      'SELECT * FROM password_resets WHERE token_hash=$1 AND expires_at >= NOW()',
      [tokenHash]
    );
    if (!row) return apiError(res, 400, 'Lien invalide ou expiré', 'INVALID_TOKEN');
    const hash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, row.user_id]);
    await db.run('DELETE FROM password_resets WHERE user_id=$1', [row.user_id]);
    // TODO (Lot 3 complet) : invalider les sessions actives de l'utilisateur ici (nécessite un
    // identifiant de session / une table sessions — les JWT actuels sont sans état donc ne
    // peuvent pas être révoqués individuellement avant leur expiration naturelle de 30 jours).
    res.json({ ok: true });
  })
);

// ---------- Compte : export et suppression ----------
router.get(
  '/me/export',
  auth(),
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const data = {
      user: await db.get(
        'SELECT id, username, email, bio, avatar, avatar_color, points, created_at FROM users WHERE id=$1',
        [uid]
      ),
      recipes: await db.all('SELECT * FROM recipes WHERE author_id=$1', [uid]),
      comments: await db.all('SELECT * FROM comments WHERE user_id=$1', [uid]),
      likes_given: await db.all('SELECT recipe_id, created_at FROM likes WHERE user_id=$1', [uid]),
      following: await db.all('SELECT following_id, created_at FROM follows WHERE follower_id=$1', [
        uid,
      ]),
      points_history: await db.all(
        'SELECT amount, reason, created_at FROM point_events WHERE user_id=$1',
        [uid]
      ),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="cuistot-mes-donnees.json"');
    res.json(data);
  })
);

router.delete(
  '/me',
  auth(),
  validate(deleteAccountSchema),
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!bcrypt.compareSync(req.valid.password, user.password_hash))
      return apiError(res, 401, 'Mot de passe incorrect', 'UNAUTHORIZED');
    // Toutes les tables liées ont ON DELETE CASCADE (recettes, likes, commentaires, follows,
    // favoris, notifications, historique de points, redemptions, participations aux défis...)
    await db.run('DELETE FROM users WHERE id=$1', [user.id]);
    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
    res.json({ ok: true });
  })
);

module.exports = router;
