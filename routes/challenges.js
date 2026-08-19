// routes/challenges.js — Défis. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');

const router = express.Router();

router.get(
  '/challenges',
  auth(false),
  asyncHandler(async (req, res) => {
    const rows = await db.all('SELECT * FROM challenges ORDER BY ends_at ASC');
    const challenges = await Promise.all(
      rows.map(async (ch) => {
        const participantsRow = await db.get(
          'SELECT COUNT(*) c FROM challenge_entries WHERE challenge_id=$1',
          [ch.id]
        );
        const joined = req.user
          ? !!(await db.get(
              'SELECT 1 FROM challenge_entries WHERE challenge_id=$1 AND user_id=$2',
              [ch.id, req.user.id]
            ))
          : false;
        return { ...ch, participants: Number(participantsRow.c), joined };
      })
    );
    res.json({ challenges });
  })
);

module.exports = router;
