// routes/recipes.js — recettes, feed, likes, favoris, commentaires. Monté sous /api.
const express = require('express');
const db = require('../db');
const { POINTS, award, awardCapped, REASONS } = require('../gamification');
const { auth } = require('../middleware/auth');
const { validate, idParam, apiError } = require('../middleware/errors');
const { recipeCreateLimiter, commentLimiter, likeLimiter } = require('../middleware/rateLimit');
const { recipeSchema, commentSchema } = require('../schemas/recipes');
const {
  sanitizeDishIcon, sanitizePhoto, decorateRecipe, decorateRecipes, awardPublishRecipe,
} = require('../services/recipes');
const { notify } = require('../services/notifications');

const router = express.Router();

const MIN_COMMENT_FOR_POINTS = 8; // en dessous, le commentaire est publié mais ne rapporte pas de points (Lot 9)

// ---------- Recettes / Feed ----------
router.get('/recipes', auth(false), (req, res) => {
  const { q, category, sort, author, feed, drafts, max_prep, difficulty, max_cost } = req.query;
  // "drafts=1" ne lève le filtre de statut que pour l'auteur consultant ses propres brouillons
  // (ex: /api/recipes?author=<moi>&drafts=1) — jamais pour consulter les brouillons d'un tiers.
  const includeDrafts = drafts === '1' && req.user && author && Number(author) === req.user.id;
  // Masque le contenu retiré par la modération et celui des comptes suspendus, partout.
  let sql = "SELECT * FROM recipes WHERE is_hidden=0 AND author_id NOT IN (SELECT id FROM users WHERE is_suspended=1)";
  if (!includeDrafts) sql += " AND status='published'";
  const params = {};
  if (category && category !== 'Tout') { sql += ' AND category=@category'; params.category = String(category).slice(0, 40); }
  if (author) { sql += ' AND author_id=@author'; params.author = Number(author) || 0; }
  if (q) {
    sql += ' AND (LOWER(title) LIKE @q OR LOWER(description) LIKE @q OR LOWER(ingredients) LIKE @q OR LOWER(tags) LIKE @q)';
    params.q = '%' + String(q).slice(0, 100).toLowerCase() + '%';
  }
  if (feed === '1' && req.user) {
    sql += ` AND author_id IN (SELECT following_id FROM follows WHERE follower_id=@viewer)`;
    params.viewer = req.user.id;
  }
  if (max_prep) { sql += ' AND prep_minutes<=@maxPrep'; params.maxPrep = Math.max(Number(max_prep) || 0, 0); }
  if (difficulty) { sql += ' AND difficulty=@difficulty'; params.difficulty = String(difficulty).slice(0, 40); }
  if (max_cost) { sql += ' AND (cost_cents IS NULL OR cost_cents<=@maxCost)'; params.maxCost = Math.max(Number(max_cost) || 0, 0); }
  // N'affiche jamais le contenu des comptes que le visiteur a bloqués
  if (req.user) {
    sql += ' AND author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=@blocker)';
    params.blocker = req.user.id;
  }
  sql += ' ORDER BY created_at DESC';
  let rows = db.prepare(sql).all(params);
  let list = decorateRecipes(rows, req.user?.id);
  if (sort === 'popular') list.sort((a, b) => b.likes - a.likes);
  if (sort === 'trending') list.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const page = list.slice(offset, offset + limit);
  res.json({ recipes: page, hasMore: offset + limit < list.length, total: list.length });
});

router.get('/recipes/:id', idParam, auth(false), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Recette introuvable', 'NOT_FOUND');
  // Masqué par la modération OU brouillon : invisible pour tout le monde sauf l'auteur/un admin
  if ((r.is_hidden || r.status === 'draft') && r.author_id !== req.user?.id) {
    const isAdmin = req.user && db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.user.id)?.is_admin;
    if (!isAdmin) return apiError(res, 404, 'Recette introuvable', 'NOT_FOUND');
  }
  const recipe = decorateRecipe(r, req.user?.id);
  recipe.commentList = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=? AND c.is_hidden=0 ORDER BY c.created_at DESC
  `).all(r.id);
  res.json({ recipe });
});

router.post('/recipes', auth(), recipeCreateLimiter, validate(recipeSchema), (req, res) => {
  const b = req.valid;
  const status = b.status || 'published';
  const info = db.prepare(`
    INSERT INTO recipes (author_id, title, description, category, difficulty,
      prep_minutes, servings, image, photo, ingredients, steps, tags,
      calories, protein_g, carbs_g, fat_g, fiber_g, cost_cents,
      storage_instructions, reheat_instructions, status)
    VALUES (@author_id,@title,@description,@category,@difficulty,@prep_minutes,
      @servings,@image,@photo,@ingredients,@steps,@tags,
      @calories,@protein_g,@carbs_g,@fat_g,@fiber_g,@cost_cents,
      @storage_instructions,@reheat_instructions,@status)
  `).run({
    author_id: req.user.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: b.prep_minutes || 15, servings: b.servings || 2,
    image: sanitizeDishIcon(b.image), photo: sanitizePhoto(b.photo),
    ingredients: JSON.stringify(b.ingredients || []),
    steps: JSON.stringify(b.steps || []),
    tags: JSON.stringify(b.tags || []),
    calories: b.calories ?? null, protein_g: b.protein_g ?? null, carbs_g: b.carbs_g ?? null,
    fat_g: b.fat_g ?? null, fiber_g: b.fiber_g ?? null, cost_cents: b.cost_cents ?? null,
    storage_instructions: b.storage_instructions || '', reheat_instructions: b.reheat_instructions || '',
    status,
  });

  // Pas de points ni de vérification des défis pour un brouillon — seulement à la publication
  if (status === 'published') awardPublishRecipe(req.user.id, info.lastInsertRowid, b.tags, b.category);

  res.json({ recipe: decorateRecipe(db.prepare('SELECT * FROM recipes WHERE id=?').get(info.lastInsertRowid), req.user.id) });
});

router.put('/recipes/:id', idParam, auth(), validate(recipeSchema), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  if (r.author_id !== req.user.id) return apiError(res, 403, 'Non autorisé', 'FORBIDDEN');
  const b = req.valid;
  const newStatus = b.status || r.status || 'published';
  db.prepare(`UPDATE recipes SET title=@title, description=@description, category=@category,
      difficulty=@difficulty, prep_minutes=@prep_minutes, servings=@servings, image=@image,
      photo=@photo, ingredients=@ingredients, steps=@steps, tags=@tags,
      calories=@calories, protein_g=@protein_g, carbs_g=@carbs_g, fat_g=@fat_g, fiber_g=@fiber_g,
      cost_cents=@cost_cents, storage_instructions=@storage_instructions,
      reheat_instructions=@reheat_instructions, status=@status WHERE id=@id`).run({
    id: r.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: b.prep_minutes || 15, servings: b.servings || 2,
    image: sanitizeDishIcon(b.image), photo: b.photo !== undefined ? sanitizePhoto(b.photo) : (r.photo || ''),
    ingredients: JSON.stringify(b.ingredients || []),
    steps: JSON.stringify(b.steps || []),
    tags: JSON.stringify(b.tags || []),
    calories: b.calories ?? null, protein_g: b.protein_g ?? null, carbs_g: b.carbs_g ?? null,
    fat_g: b.fat_g ?? null, fiber_g: b.fiber_g ?? null, cost_cents: b.cost_cents ?? null,
    storage_instructions: b.storage_instructions || '', reheat_instructions: b.reheat_instructions || '',
    status: newStatus,
  });

  // Première publication (transition brouillon -> publié) : points + défis, une seule fois —
  // jamais en republiant un contenu déjà publié.
  if (r.status === 'draft' && newStatus === 'published') awardPublishRecipe(req.user.id, r.id, b.tags, b.category);

  res.json({ recipe: decorateRecipe(db.prepare('SELECT * FROM recipes WHERE id=?').get(r.id), req.user.id) });
});

router.delete('/recipes/:id', idParam, auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  if (r.author_id !== req.user.id) return apiError(res, 403, 'Non autorisé', 'FORBIDDEN');
  db.prepare('DELETE FROM recipes WHERE id=?').run(r.id);
  res.json({ ok: true });
});

// ---------- Likes ----------
router.post('/recipes/:id/like', idParam, auth(), likeLimiter, (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  const exists = db.prepare('SELECT 1 FROM likes WHERE recipe_id=? AND user_id=?').get(r.id, req.user.id);
  if (exists) {
    db.prepare('DELETE FROM likes WHERE recipe_id=? AND user_id=?').run(r.id, req.user.id);
    // Retire les points donnés au like pour éviter tout « farming » like/unlike
    if (r.author_id !== req.user.id) {
      award(req.user.id, -POINTS.GIVE_LIKE, 'Like retiré');
      award(r.author_id, -POINTS.RECEIVE_LIKE, 'Un like a été retiré');
    }
  } else {
    db.prepare('INSERT INTO likes (recipe_id,user_id) VALUES (?,?)').run(r.id, req.user.id);
    // Un like sur sa propre recette ne rapporte ni points ni notification (anti-abus)
    if (r.author_id !== req.user.id) {
      // Plafonné par jour côté auteur pour limiter le farming (voir gamification.js) ; liker
      // lui-même ne rapporte plus de points du tout (POINTS.GIVE_LIKE = 0).
      awardCapped(r.author_id, POINTS.RECEIVE_LIKE, REASONS.RECEIVE_LIKE);
      notify(r.author_id, req.user.id, 'like', r.id, `${req.user.username} a aimé « ${r.title} »`);
    }
  }
  const likes = db.prepare('SELECT COUNT(*) c FROM likes WHERE recipe_id=?').get(r.id).c;
  res.json({ likes, liked: !exists });
});

// ---------- Favoris / carnet de recettes ----------
router.post('/recipes/:id/bookmark', idParam, auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  const exists = db.prepare('SELECT 1 FROM bookmarks WHERE recipe_id=? AND user_id=?').get(r.id, req.user.id);
  if (exists) db.prepare('DELETE FROM bookmarks WHERE recipe_id=? AND user_id=?').run(r.id, req.user.id);
  else db.prepare('INSERT INTO bookmarks (recipe_id,user_id) VALUES (?,?)').run(r.id, req.user.id);
  res.json({ bookmarked: !exists });
});

router.get('/bookmarks', auth(), (req, res) => {
  const rows = db.prepare(`
    SELECT r.* FROM recipes r JOIN bookmarks b ON b.recipe_id=r.id
    WHERE b.user_id=? AND r.is_hidden=0 AND r.status='published' ORDER BY b.created_at DESC`).all(req.user.id);
  res.json({ recipes: decorateRecipes(rows, req.user.id) });
});

// ---------- Commentaires ----------
router.post('/recipes/:id/comments', idParam, auth(), commentLimiter, validate(commentSchema), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  const body = req.valid.body;
  db.prepare('INSERT INTO comments (user_id,recipe_id,body) VALUES (?,?,?)')
    .run(req.user.id, r.id, body);
  if (r.author_id !== req.user.id) {
    // Un commentaire trop court ("ok", "nice"...) est publié normalement mais ne rapporte pas
    // de points — évite de farmer des points avec des commentaires creux (Lot 9).
    if (body.length >= MIN_COMMENT_FOR_POINTS) awardCapped(req.user.id, POINTS.COMMENT, REASONS.COMMENT);
    notify(r.author_id, req.user.id, 'comment', r.id, `${req.user.username} a commenté « ${r.title} »`);
  }
  const list = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=? AND c.is_hidden=0 ORDER BY c.created_at DESC
  `).all(r.id);
  res.json({ comments: list });
});

module.exports = router;
