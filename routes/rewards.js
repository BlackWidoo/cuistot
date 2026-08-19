// routes/rewards.js — boutique de récompenses. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { idParam, apiError, asyncHandler } = require('../middleware/errors');

const router = express.Router();

router.get(
  '/rewards',
  auth(false),
  asyncHandler(async (req, res) => {
    const rewards = await db.all('SELECT * FROM rewards ORDER BY cost ASC');
    const mine = req.user
      ? await db.all(
          `SELECT r.*, red.code, red.created_at redeemed_at
         FROM redemptions red JOIN rewards r ON r.id=red.reward_id
         WHERE red.user_id=$1 ORDER BY red.created_at DESC`,
          [req.user.id]
        )
      : [];
    res.json({ rewards, redeemed: mine });
  })
);

router.post(
  '/rewards/:id/redeem',
  idParam,
  auth(),
  asyncHandler(async (req, res) => {
    const reward = await db.get('SELECT * FROM rewards WHERE id=$1', [req.id]);
    if (!reward) return apiError(res, 404, 'Récompense introuvable', 'NOT_FOUND');
    const user = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (user.points < reward.cost)
      return apiError(res, 400, 'Pas assez de points', 'INSUFFICIENT_POINTS');
    if (reward.stock === 0) return apiError(res, 400, 'Épuisé', 'OUT_OF_STOCK');
    const code = 'CUI-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET points = GREATEST(0, points - $1) WHERE id = $2', [
        reward.cost,
        req.user.id,
      ]);
      await tx.run('INSERT INTO point_events (user_id, amount, reason) VALUES ($1,$2,$3)', [
        req.user.id,
        -reward.cost,
        'Échange : ' + reward.title,
      ]);
      if (reward.stock > 0)
        await tx.run('UPDATE rewards SET stock=stock-1 WHERE id=$1', [reward.id]);
      await tx.run('INSERT INTO redemptions (user_id,reward_id,code) VALUES ($1,$2,$3)', [
        req.user.id,
        reward.id,
        code,
      ]);
    });
    const fresh = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json({ ok: true, code, points: fresh.points });
  })
);

module.exports = router;
