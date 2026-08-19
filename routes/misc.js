// routes/misc.js — journal de points, notifications, catégories. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');

const router = express.Router();

// ---------- Journal de points ----------
router.get(
  '/points/history',
  auth(),
  asyncHandler(async (req, res) => {
    const events = await db.all(
      'SELECT amount, reason, created_at FROM point_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ events });
  })
);

// ---------- Notifications ----------
router.get(
  '/notifications',
  auth(),
  asyncHandler(async (req, res) => {
    const items = await db.all(
      `
    SELECT n.id, n.type, n.text, n.recipe_id, n.is_read, n.created_at, u.username actor, u.avatar actor_avatar
    FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
    WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 40`,
      [req.user.id]
    );
    const unreadRow = await db.get(
      'SELECT COUNT(*) c FROM notifications WHERE user_id=$1 AND is_read=0',
      [req.user.id]
    );
    res.json({ notifications: items, unread: Number(unreadRow.c) });
  })
);

router.post(
  '/notifications/read',
  auth(),
  asyncHandler(async (req, res) => {
    await db.run('UPDATE notifications SET is_read=1 WHERE user_id=$1', [req.user.id]);
    res.json({ ok: true });
  })
);

// Catégories dispo
router.get('/categories', (req, res) => {
  res.json({
    categories: [
      'Entrée',
      'Plat',
      'Dessert',
      'Petit-déj',
      'Végétarien',
      'Healthy',
      'Boisson',
      'Autre',
    ],
  });
});

module.exports = router;
