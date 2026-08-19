// routes/recipes.js — recettes, feed, likes, favoris, commentaires. Monté sous /api.
const express = require('express');
const db = require('../db');
const { POINTS, award, awardCapped, REASONS } = require('../gamification');
const { auth } = require('../middleware/auth');
const { validate, idParam, apiError, asyncHandler } = require('../middleware/errors');
const { recipeCreateLimiter, commentLimiter, likeLimiter } = require('../middleware/rateLimit');
const { recipeSchema, commentSchema } = require('../schemas/recipes');
const {
  sanitizeDishIcon,
  sanitizePhoto,
  decorateRecipe,
  decorateRecipes,
  awardPublishRecipe,
} = require('../services/recipes');
const { notify } = require('../services/notifications');

const router = express.Router();

const MIN_COMMENT_FOR_POINTS = 8; // en dessous, le commentaire est publié mais ne rapporte pas de points (Lot 9)

// ---------- Recettes / Feed ----------
router.get(
  '/recipes',
  auth(false),
  asyncHandler(async (req, res) => {
    const { q, category, sort, author, drafts, max_prep, difficulty, max_cost } = req.query;
    const feed = req.query.feed;
    // "drafts=1" ne lève le filtre de statut que pour l'auteur consultant ses propres brouillons
    // (ex: /api/recipes?author=<moi>&drafts=1) — jamais pour consulter les brouillons d'un tiers.
    const includeDrafts = drafts === '1' && req.user && author && Number(author) === req.user.id;
    // Masque le contenu retiré par la modération et celui des comptes suspendus, partout.
    let sql =
      'SELECT * FROM recipes WHERE is_hidden=0 AND author_id NOT IN (SELECT id FROM users WHERE is_suspended=1)';
    if (!includeDrafts) sql += " AND status='published'";
    const params = [];
    const ph = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (category && category !== 'Tout') {
      sql += ` AND category=${ph(String(category).slice(0, 40))}`;
    }
    if (author) {
      sql += ` AND author_id=${ph(Number(author) || 0)}`;
    }
    if (q) {
      const like = ph('%' + String(q).slice(0, 100).toLowerCase() + '%');
      sql += ` AND (LOWER(title) LIKE ${like} OR LOWER(description) LIKE ${like} OR LOWER(ingredients) LIKE ${like} OR LOWER(tags) LIKE ${like})`;
    }
    if (feed === '1' && req.user) {
      sql += ` AND author_id IN (SELECT following_id FROM follows WHERE follower_id=${ph(req.user.id)})`;
    }
    if (max_prep) {
      sql += ` AND prep_minutes<=${ph(Math.max(Number(max_prep) || 0, 0))}`;
    }
    if (difficulty) {
      sql += ` AND difficulty=${ph(String(difficulty).slice(0, 40))}`;
    }
    if (max_cost) {
      sql += ` AND (cost_cents IS NULL OR cost_cents<=${ph(Math.max(Number(max_cost) || 0, 0))})`;
    }
    // N'affiche jamais le contenu des comptes que le visiteur a bloqués
    if (req.user) {
      sql += ` AND author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=${ph(req.user.id)})`;
    }
    sql += ' ORDER BY created_at DESC';
    const rows = await db.all(sql, params);
    let list = await decorateRecipes(rows, req.user?.id);
    if (sort === 'popular') list.sort((a, b) => b.likes - a.likes);
    if (sort === 'trending') list.sort((a, b) => b.likes + b.comments - (a.likes + a.comments));

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const page = list.slice(offset, offset + limit);
    res.json({ recipes: page, hasMore: offset + limit < list.length, total: list.length });
  })
);

router.get(
  '/recipes/:id',
  idParam,
  auth(false),
  asyncHandler(async (req, res) => {
    const r = await db.get('SELECT * FROM recipes WHERE id=$1', [req.id]);
    if (!r) return apiError(res, 404, 'Recette introuvable', 'NOT_FOUND');
    // Masqué par la modération OU brouillon : invisible pour tout le monde sauf l'auteur/un admin
    if ((r.is_hidden || r.status === 'draft') && r.author_id !== req.user?.id) {
      const adminRow =
        req.user && (await db.get('SELECT is_admin FROM users WHERE id=$1', [req.user.id]));
      if (!adminRow?.is_admin) return apiError(res, 404, 'Recette introuvable', 'NOT_FOUND');
    }
    const recipe = await decorateRecipe(r, req.user?.id);
    recipe.commentList = await db.all(
      `
    SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=$1 AND c.is_hidden=0 ORDER BY c.created_at DESC
  `,
      [r.id]
    );
    res.json({ recipe });
  })
);

router.post(
  '/recipes',
  auth(),
  recipeCreateLimiter,
  validate(recipeSchema),
  asyncHandler(async (req, res) => {
    const b = req.valid;
    const status = b.status || 'published';
    const { rows } = await db.run(
      `
    INSERT INTO recipes (author_id, title, description, category, difficulty,
      prep_minutes, servings, image, photo, ingredients, steps, tags,
      calories, protein_g, carbs_g, fat_g, fiber_g, cost_cents,
      storage_instructions, reheat_instructions, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    RETURNING id
  `,
      [
        req.user.id,
        b.title,
        b.description || '',
        b.category || 'Autre',
        b.difficulty || 'Facile',
        b.prep_minutes || 15,
        b.servings || 2,
        sanitizeDishIcon(b.image),
        sanitizePhoto(b.photo),
        JSON.stringify(b.ingredients || []),
        JSON.stringify(b.steps || []),
        JSON.stringify(b.tags || []),
        b.calories ?? null,
        b.protein_g ?? null,
        b.carbs_g ?? null,
        b.fat_g ?? null,
        b.fiber_g ?? null,
        b.cost_cents ?? null,
        b.storage_instructions || '',
        b.reheat_instructions || '',
        status,
      ]
    );
    const newId = rows[0].id;

    // Pas de points ni de vérification des défis pour un brouillon — seulement à la publication
    if (status === 'published') await awardPublishRecipe(req.user.id, newId, b.tags, b.category);

    const created = await db.get('SELECT * FROM recipes WHERE id=$1', [newId]);
    res.json({ recipe: await decorateRecipe(created, req.user.id) });
  })
);

router.put(
  '/recipes/:id',
  idParam,
  auth(),
  validate(recipeSchema),
  asyncHandler(async (req, res) => {
    const r = await db.get('SELECT * FROM recipes WHERE id=$1', [req.id]);
    if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
    if (r.author_id !== req.user.id) return apiError(res, 403, 'Non autorisé', 'FORBIDDEN');
    const b = req.valid;
    const newStatus = b.status || r.status || 'published';
    await db.run(
      `UPDATE recipes SET title=$1, description=$2, category=$3,
      difficulty=$4, prep_minutes=$5, servings=$6, image=$7,
      photo=$8, ingredients=$9, steps=$10, tags=$11,
      calories=$12, protein_g=$13, carbs_g=$14, fat_g=$15, fiber_g=$16,
      cost_cents=$17, storage_instructions=$18,
      reheat_instructions=$19, status=$20 WHERE id=$21`,
      [
        b.title,
        b.description || '',
        b.category || 'Autre',
        b.difficulty || 'Facile',
        b.prep_minutes || 15,
        b.servings || 2,
        sanitizeDishIcon(b.image),
        b.photo !== undefined ? sanitizePhoto(b.photo) : r.photo || '',
        JSON.stringify(b.ingredients || []),
        JSON.stringify(b.steps || []),
        JSON.stringify(b.tags || []),
        b.calories ?? null,
        b.protein_g ?? null,
        b.carbs_g ?? null,
        b.fat_g ?? null,
        b.fiber_g ?? null,
        b.cost_cents ?? null,
        b.storage_instructions || '',
        b.reheat_instructions || '',
        newStatus,
        r.id,
      ]
    );

    // Première publication (transition brouillon -> publié) : points + défis, une seule fois —
    // jamais en republiant un contenu déjà publié.
    if (r.status === 'draft' && newStatus === 'published')
      await awardPublishRecipe(req.user.id, r.id, b.tags, b.category);

    const updated = await db.get('SELECT * FROM recipes WHERE id=$1', [r.id]);
    res.json({ recipe: await decorateRecipe(updated, req.user.id) });
  })
);

router.delete(
  '/recipes/:id',
  idParam,
  auth(),
  asyncHandler(async (req, res) => {
    const r = await db.get('SELECT * FROM recipes WHERE id=$1', [req.id]);
    if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
    if (r.author_id !== req.user.id) return apiError(res, 403, 'Non autorisé', 'FORBIDDEN');
    await db.run('DELETE FROM recipes WHERE id=$1', [r.id]);
    res.json({ ok: true });
  })
);

// ---------- Likes ----------
router.post(
  '/recipes/:id/like',
  idParam,
  auth(),
  likeLimiter,
  asyncHandler(async (req, res) => {
    const r = await db.get('SELECT * FROM recipes WHERE id=$1', [req.id]);
    if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
    const exists = await db.get('SELECT 1 FROM likes WHERE recipe_id=$1 AND user_id=$2', [
      r.id,
      req.user.id,
    ]);
    if (exists) {
      await db.run('DELETE FROM likes WHERE recipe_id=$1 AND user_id=$2', [r.id, req.user.id]);
      // Retire les points donnés au like pour éviter tout « farming » like/unlike
      if (r.author_id !== req.user.id) {
        await award(req.user.id, -POINTS.GIVE_LIKE, 'Like retiré');
        await award(r.author_id, -POINTS.RECEIVE_LIKE, 'Un like a été retiré');
      }
    } else {
      await db.run('INSERT INTO likes (recipe_id,user_id) VALUES ($1,$2)', [r.id, req.user.id]);
      // Un like sur sa propre recette ne rapporte ni points ni notification (anti-abus)
      if (r.author_id !== req.user.id) {
        // Plafonné par jour côté auteur pour limiter le farming (voir gamification.js) ; liker
        // lui-même ne rapporte plus de points du tout (POINTS.GIVE_LIKE = 0).
        await awardCapped(r.author_id, POINTS.RECEIVE_LIKE, REASONS.RECEIVE_LIKE);
        await notify(
          r.author_id,
          req.user.id,
          'like',
          r.id,
          `${req.user.username} a aimé « ${r.title} »`
        );
      }
    }
    const likesRow = await db.get('SELECT COUNT(*) c FROM likes WHERE recipe_id=$1', [r.id]);
    res.json({ likes: Number(likesRow.c), liked: !exists });
  })
);

// ---------- Favoris / carnet de recettes ----------
router.post(
  '/recipes/:id/bookmark',
  idParam,
  auth(),
  asyncHandler(async (req, res) => {
    const r = await db.get('SELECT * FROM recipes WHERE id=$1', [req.id]);
    if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
    const exists = await db.get('SELECT 1 FROM bookmarks WHERE recipe_id=$1 AND user_id=$2', [
      r.id,
      req.user.id,
    ]);
    if (exists)
      await db.run('DELETE FROM bookmarks WHERE recipe_id=$1 AND user_id=$2', [r.id, req.user.id]);
    else
      await db.run('INSERT INTO bookmarks (recipe_id,user_id) VALUES ($1,$2)', [r.id, req.user.id]);
    res.json({ bookmarked: !exists });
  })
);

router.get(
  '/bookmarks',
  auth(),
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `
    SELECT r.* FROM recipes r JOIN bookmarks b ON b.recipe_id=r.id
    WHERE b.user_id=$1 AND r.is_hidden=0 AND r.status='published' ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ recipes: await decorateRecipes(rows, req.user.id) });
  })
);

// ---------- Commentaires ----------
router.post(
  '/recipes/:id/comments',
  idParam,
  auth(),
  commentLimiter,
  validate(commentSchema),
  asyncHandler(async (req, res) => {
    const r = await db.get('SELECT * FROM recipes WHERE id=$1', [req.id]);
    if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
    const body = req.valid.body;
    await db.run('INSERT INTO comments (user_id,recipe_id,body) VALUES ($1,$2,$3)', [
      req.user.id,
      r.id,
      body,
    ]);
    if (r.author_id !== req.user.id) {
      // Un commentaire trop court ("ok", "nice"...) est publié normalement mais ne rapporte pas
      // de points — évite de farmer des points avec des commentaires creux (Lot 9).
      if (body.length >= MIN_COMMENT_FOR_POINTS)
        await awardCapped(req.user.id, POINTS.COMMENT, REASONS.COMMENT);
      await notify(
        r.author_id,
        req.user.id,
        'comment',
        r.id,
        `${req.user.username} a commenté « ${r.title} »`
      );
    }
    const list = await db.all(
      `
    SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=$1 AND c.is_hidden=0 ORDER BY c.created_at DESC
  `,
      [r.id]
    );
    res.json({ comments: list });
  })
);

module.exports = router;
