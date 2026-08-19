// routes/moderation.js — signalements + panel admin. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');
const { validate, idParam, apiError, asyncHandler } = require('../middleware/errors');
const { reportSchema, resolveReportSchema } = require('../schemas/moderation');

const router = express.Router();

// ---------- Signalements ----------
router.post(
  '/reports',
  auth(),
  validate(reportSchema),
  asyncHandler(async (req, res) => {
    const { target_type, target_id, reason } = req.valid;
    await db.run(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4)',
      [req.user.id, target_type, target_id, reason]
    );
    res.json({ ok: true });
  })
);

// ---------- Modération (admin) ----------
router.get(
  '/admin/reports',
  auth(),
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rows = await db.all(`
    SELECT r.id, r.target_type, r.target_id, r.reason, r.created_at, u.username reporter
    FROM reports r JOIN users u ON u.id = r.reporter_id
    WHERE r.status='open' ORDER BY r.created_at ASC`);
    // Aperçu du contenu ciblé, pour ne pas obliger l'admin à naviguer à l'aveugle
    const withPreview = await Promise.all(
      rows.map(async (r) => {
        let preview = null;
        if (r.target_type === 'recipe')
          preview = (await db.get('SELECT title FROM recipes WHERE id=$1', [r.target_id]))?.title;
        else if (r.target_type === 'comment')
          preview = (await db.get('SELECT body FROM comments WHERE id=$1', [r.target_id]))?.body;
        else if (r.target_type === 'user')
          preview = (await db.get('SELECT username FROM users WHERE id=$1', [r.target_id]))
            ?.username;
        return { ...r, preview: preview || '(contenu introuvable — probablement déjà supprimé)' };
      })
    );
    res.json({ reports: withPreview });
  })
);

router.post(
  '/admin/reports/:id/resolve',
  idParam,
  auth(),
  requireAdmin,
  validate(resolveReportSchema),
  asyncHandler(async (req, res) => {
    const report = await db.get('SELECT * FROM reports WHERE id=$1', [req.id]);
    if (!report) return apiError(res, 404, 'Signalement introuvable', 'NOT_FOUND');
    const { action } = req.valid;
    if (action === 'hide') {
      if (report.target_type === 'recipe')
        await db.run('UPDATE recipes SET is_hidden=1 WHERE id=$1', [report.target_id]);
      else if (report.target_type === 'comment')
        await db.run('UPDATE comments SET is_hidden=1 WHERE id=$1', [report.target_id]);
    } else if (action === 'suspend_user') {
      const userId =
        report.target_type === 'user'
          ? report.target_id
          : report.target_type === 'recipe'
            ? (await db.get('SELECT author_id FROM recipes WHERE id=$1', [report.target_id]))
                ?.author_id
            : (await db.get('SELECT user_id FROM comments WHERE id=$1', [report.target_id]))
                ?.user_id;
      if (userId) await db.run('UPDATE users SET is_suspended=1 WHERE id=$1', [userId]);
    }
    await db.run('UPDATE reports SET status=$1 WHERE id=$2', [
      action === 'dismiss' ? 'dismissed' : 'resolved',
      report.id,
    ]);
    await db.run(
      'INSERT INTO admin_actions (admin_id, action, target_type, target_id) VALUES ($1,$2,$3,$4)',
      [req.user.id, action, report.target_type, report.target_id]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
