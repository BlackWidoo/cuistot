// routes/misc.js — journal de points, notifications, catégories. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// ---------- Journal de points ----------
router.get('/points/history', auth(), (req, res) => {
  const events = db.prepare('SELECT amount, reason, created_at FROM point_events WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id);
  res.json({ events });
});

// ---------- Notifications ----------
router.get('/notifications', auth(), (req, res) => {
  const items = db.prepare(`
    SELECT n.id, n.type, n.text, n.recipe_id, n.is_read, n.created_at, u.username actor, u.avatar actor_avatar
    FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
    WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 40`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ notifications: items, unread });
});

router.post('/notifications/read', auth(), (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// Catégories dispo
router.get('/categories', (req, res) => {
  res.json({ categories: ['Entrée', 'Plat', 'Dessert', 'Petit-déj', 'Végétarien', 'Healthy', 'Boisson', 'Autre'] });
});

module.exports = router;
