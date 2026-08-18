// routes/rewards.js — boutique de récompenses. Monté sous /api.
const express = require('express');
const db = require('../db');
const { award } = require('../gamification');
const { auth } = require('../middleware/auth');
const { idParam, apiError } = require('../middleware/errors');

const router = express.Router();

router.get('/rewards', auth(false), (req, res) => {
  const rewards = db.prepare('SELECT * FROM rewards ORDER BY cost ASC').all();
  const mine = req.user
    ? db.prepare(`SELECT r.*, red.code, red.created_at redeemed_at
         FROM redemptions red JOIN rewards r ON r.id=red.reward_id
         WHERE red.user_id=? ORDER BY red.created_at DESC`).all(req.user.id)
    : [];
  res.json({ rewards, redeemed: mine });
});

router.post('/rewards/:id/redeem', idParam, auth(), (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.id);
  if (!reward) return apiError(res, 404, 'Récompense introuvable', 'NOT_FOUND');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (user.points < reward.cost)
    return apiError(res, 400, 'Pas assez de points', 'INSUFFICIENT_POINTS');
  if (reward.stock === 0) return apiError(res, 400, 'Épuisé', 'OUT_OF_STOCK');
  const code = 'CUI-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const tx = db.transaction(() => {
    award(req.user.id, -reward.cost, 'Échange : ' + reward.title);
    if (reward.stock > 0) db.prepare('UPDATE rewards SET stock=stock-1 WHERE id=?').run(reward.id);
    db.prepare('INSERT INTO redemptions (user_id,reward_id,code) VALUES (?,?,?)')
      .run(req.user.id, reward.id, code);
  });
  tx();
  const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ ok: true, code, points: fresh.points });
});

module.exports = router;
