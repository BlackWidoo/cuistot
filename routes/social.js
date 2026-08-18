// routes/social.js — abonnements, blocage, profils publics, classement. Monté sous /api.
const express = require('express');
const db = require('../db');
const { POINTS, award, badgesFor } = require('../gamification');
const { auth } = require('../middleware/auth');
const { idParam, apiError } = require('../middleware/errors');
const { publicUser } = require('../services/users');
const { decorateRecipes } = require('../services/recipes');
const { notify } = require('../services/notifications');

const router = express.Router();

// ---------- Follow ----------
router.post('/users/:id/follow', idParam, auth(), (req, res) => {
  const target = req.id;
  if (target === req.user.id) return apiError(res, 400, 'Impossible de se suivre soi-même', 'VALIDATION_ERROR');
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(target);
  if (!t) return apiError(res, 404, 'Utilisateur introuvable', 'NOT_FOUND');
  const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, target);
  if (exists) {
    db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.user.id, target);
  } else {
    db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run(req.user.id, target);
    award(target, POINTS.RECEIVE_FOLLOW, 'Nouvel abonné');
    notify(target, req.user.id, 'follow', null, `${req.user.username} s'est abonné·e à toi`);
  }
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(target).c;
  res.json({ following: !exists, followers });
});

// ---------- Blocage ----------
router.post('/users/:id/block', idParam, auth(), (req, res) => {
  const target = req.id;
  if (target === req.user.id) return apiError(res, 400, 'Impossible de se bloquer soi-même', 'VALIDATION_ERROR');
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(target);
  if (!t) return apiError(res, 404, 'Utilisateur introuvable', 'NOT_FOUND');
  const exists = db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(req.user.id, target);
  if (exists) {
    db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id, target);
  } else {
    db.prepare('INSERT INTO blocks (blocker_id,blocked_id) VALUES (?,?)').run(req.user.id, target);
    // Bloquer coupe aussi les abonnements dans les deux sens
    db.prepare('DELETE FROM follows WHERE (follower_id=? AND following_id=?) OR (follower_id=? AND following_id=?)')
      .run(req.user.id, target, target, req.user.id);
  }
  res.json({ blocked: !exists });
});

router.get('/blocked', auth(), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.avatar_color FROM blocks b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id=? ORDER BY b.created_at DESC`).all(req.user.id);
  res.json({ users: rows });
});

// ---------- Profils / Utilisateurs ----------
router.get('/users/:id', idParam, auth(false), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.id);
  if (!u) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  const isFollowing = req.user
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, u.id)
    : false;
  const isBlocked = req.user
    ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(req.user.id, u.id)
    : false;
  const recipes = decorateRecipes(
    db.prepare("SELECT * FROM recipes WHERE author_id=? AND is_hidden=0 AND status='published' ORDER BY created_at DESC").all(u.id),
    req.user?.id
  );
  res.json({ user: publicUser(u), badges: badgesFor(u.id), recipes, isFollowing, isBlocked });
});

// Classement
router.get('/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT * FROM users WHERE is_suspended=0 ORDER BY points DESC LIMIT 20').all();
  res.json({ users: rows.map((u, i) => ({ rank: i + 1, ...publicUser(u) })) });
});

module.exports = router;
