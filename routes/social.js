// routes/social.js — abonnements, blocage, profils publics, classement. Monté sous /api.
const express = require('express');
const db = require('../db');
const { POINTS, award, badgesFor } = require('../gamification');
const { auth } = require('../middleware/auth');
const { idParam, apiError, asyncHandler } = require('../middleware/errors');
const { publicUser } = require('../services/users');
const { decorateRecipes } = require('../services/recipes');
const { notify } = require('../services/notifications');

const router = express.Router();

// ---------- Follow ----------
router.post(
  '/users/:id/follow',
  idParam,
  auth(),
  asyncHandler(async (req, res) => {
    const target = req.id;
    if (target === req.user.id)
      return apiError(res, 400, 'Impossible de se suivre soi-même', 'VALIDATION_ERROR');
    const t = await db.get('SELECT * FROM users WHERE id=$1', [target]);
    if (!t) return apiError(res, 404, 'Utilisateur introuvable', 'NOT_FOUND');
    const exists = await db.get('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [
      req.user.id,
      target,
    ]);
    if (exists) {
      await db.run('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [
        req.user.id,
        target,
      ]);
    } else {
      await db.run('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2)', [
        req.user.id,
        target,
      ]);
      await award(target, POINTS.RECEIVE_FOLLOW, 'Nouvel abonné');
      await notify(
        target,
        req.user.id,
        'follow',
        null,
        `${req.user.username} s'est abonné·e à toi`
      );
    }
    const followersRow = await db.get('SELECT COUNT(*) c FROM follows WHERE following_id=$1', [
      target,
    ]);
    res.json({ following: !exists, followers: Number(followersRow.c) });
  })
);

// ---------- Blocage ----------
router.post(
  '/users/:id/block',
  idParam,
  auth(),
  asyncHandler(async (req, res) => {
    const target = req.id;
    if (target === req.user.id)
      return apiError(res, 400, 'Impossible de se bloquer soi-même', 'VALIDATION_ERROR');
    const t = await db.get('SELECT * FROM users WHERE id=$1', [target]);
    if (!t) return apiError(res, 404, 'Utilisateur introuvable', 'NOT_FOUND');
    const exists = await db.get('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [
      req.user.id,
      target,
    ]);
    if (exists) {
      await db.run('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [
        req.user.id,
        target,
      ]);
    } else {
      await db.run('INSERT INTO blocks (blocker_id,blocked_id) VALUES ($1,$2)', [
        req.user.id,
        target,
      ]);
      // Bloquer coupe aussi les abonnements dans les deux sens
      await db.run(
        'DELETE FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)',
        [req.user.id, target]
      );
    }
    res.json({ blocked: !exists });
  })
);

router.get(
  '/blocked',
  auth(),
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `
    SELECT u.id, u.username, u.avatar, u.avatar_color FROM blocks b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ users: rows });
  })
);

// ---------- Profils / Utilisateurs ----------
router.get(
  '/users/:id',
  idParam,
  auth(false),
  asyncHandler(async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id=$1', [req.id]);
    if (!u) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
    const isFollowing = req.user
      ? !!(await db.get('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [
          req.user.id,
          u.id,
        ]))
      : false;
    const isBlocked = req.user
      ? !!(await db.get('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [
          req.user.id,
          u.id,
        ]))
      : false;
    const recipeRows = await db.all(
      "SELECT * FROM recipes WHERE author_id=$1 AND is_hidden=0 AND status='published' ORDER BY created_at DESC",
      [u.id]
    );
    const recipes = await decorateRecipes(recipeRows, req.user?.id);
    res.json({
      user: await publicUser(u),
      badges: await badgesFor(u.id),
      recipes,
      isFollowing,
      isBlocked,
    });
  })
);

// Classement
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      'SELECT * FROM users WHERE is_suspended=0 ORDER BY points DESC LIMIT 20'
    );
    const users = await Promise.all(
      rows.map(async (u, i) => ({ rank: i + 1, ...(await publicUser(u)) }))
    );
    res.json({ users });
  })
);

module.exports = router;
