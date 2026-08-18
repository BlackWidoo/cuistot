// routes/moderation.js — signalements + panel admin. Monté sous /api.
const express = require('express');
const db = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');
const { validate, idParam, apiError } = require('../middleware/errors');
const { reportSchema, resolveReportSchema } = require('../schemas/moderation');

const router = express.Router();

// ---------- Signalements ----------
router.post('/reports', auth(), validate(reportSchema), (req, res) => {
  const { target_type, target_id, reason } = req.valid;
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?,?,?,?)')
    .run(req.user.id, target_type, target_id, reason);
  res.json({ ok: true });
});

// ---------- Modération (admin) ----------
router.get('/admin/reports', auth(), requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.target_type, r.target_id, r.reason, r.created_at, u.username reporter
    FROM reports r JOIN users u ON u.id = r.reporter_id
    WHERE r.status='open' ORDER BY r.created_at ASC`).all();
  // Aperçu du contenu ciblé, pour ne pas obliger l'admin à naviguer à l'aveugle
  const withPreview = rows.map((r) => {
    let preview = null;
    if (r.target_type === 'recipe') preview = db.prepare('SELECT title FROM recipes WHERE id=?').get(r.target_id)?.title;
    else if (r.target_type === 'comment') preview = db.prepare('SELECT body FROM comments WHERE id=?').get(r.target_id)?.body;
    else if (r.target_type === 'user') preview = db.prepare('SELECT username FROM users WHERE id=?').get(r.target_id)?.username;
    return { ...r, preview: preview || '(contenu introuvable — probablement déjà supprimé)' };
  });
  res.json({ reports: withPreview });
});

router.post('/admin/reports/:id/resolve', idParam, auth(), requireAdmin, validate(resolveReportSchema), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id=?').get(req.id);
  if (!report) return apiError(res, 404, 'Signalement introuvable', 'NOT_FOUND');
  const { action } = req.valid;
  if (action === 'hide') {
    if (report.target_type === 'recipe') db.prepare('UPDATE recipes SET is_hidden=1 WHERE id=?').run(report.target_id);
    else if (report.target_type === 'comment') db.prepare('UPDATE comments SET is_hidden=1 WHERE id=?').run(report.target_id);
  } else if (action === 'suspend_user') {
    const userId = report.target_type === 'user' ? report.target_id
      : report.target_type === 'recipe' ? db.prepare('SELECT author_id FROM recipes WHERE id=?').get(report.target_id)?.author_id
      : db.prepare('SELECT user_id FROM comments WHERE id=?').get(report.target_id)?.user_id;
    if (userId) db.prepare('UPDATE users SET is_suspended=1 WHERE id=?').run(userId);
  }
  db.prepare("UPDATE reports SET status=? WHERE id=?").run(action === 'dismiss' ? 'dismissed' : 'resolved', report.id);
  db.prepare('INSERT INTO admin_actions (admin_id, action, target_type, target_id) VALUES (?,?,?,?)')
    .run(req.user.id, action, report.target_type, report.target_id);
  res.json({ ok: true });
});

module.exports = router;
