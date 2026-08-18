// routes/challenges.js — Défis. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/challenges', auth(false), (req, res) => {
  const rows = db.prepare('SELECT * FROM challenges ORDER BY ends_at ASC').all();
  const challenges = rows.map((ch) => {
    const participants = db.prepare('SELECT COUNT(*) c FROM challenge_entries WHERE challenge_id=?').get(ch.id).c;
    const joined = req.user
      ? !!db.prepare('SELECT 1 FROM challenge_entries WHERE challenge_id=? AND user_id=?').get(ch.id, req.user.id)
      : false;
    return { ...ch, participants, joined };
  });
  res.json({ challenges });
});

module.exports = router;
