// services/recipes.js
const db = require('../db');
const { POINTS, award } = require('../gamification');
const { notify } = require('./notifications');

const json = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
};

// Clés d'icônes SVG connues côté client (voir ICONS dans app.js). On valide toute valeur
// venant du client contre cette liste : avant ce garde-fou, le champ "image" d'une recette
// était inséré tel quel dans le HTML du fil sans être échappé (faille XSS stockée).
const DISH_ICONS = new Set([
  'plate',
  'pot',
  'pasta',
  'bowl',
  'salad',
  'pizza',
  'taco',
  'burger',
  'pan',
  'croissant',
  'pancake',
  'cake',
  'cupcake',
  'donut',
  'icecream',
  'drink',
]);
function sanitizeDishIcon(v) {
  return DISH_ICONS.has(v) ? v : 'plate';
}

// Valide/normalise une photo : data URL image (compressée côté client) ou chemin local
function sanitizePhoto(p) {
  if (typeof p !== 'string' || !p) return '';
  if (p.startsWith('/photos/')) return p;
  // La compression côté client (resizeImage) vise ~1280px/qualité 0.82, donc quelques
  // centaines de Ko en JPEG ; 3 Mo laisse une marge large sans pour autant permettre
  // n'importe quel binaire encodé en base64 de saturer la base.
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(p) && p.length < 3_000_000) return p;
  return '';
}

function shapeRecipe(r, author, likes, comments, liked, bookmarked, viewerId) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    difficulty: r.difficulty,
    prep_minutes: r.prep_minutes,
    servings: r.servings,
    image: r.image,
    photo: r.photo || '',
    ingredients: json(r.ingredients),
    steps: json(r.steps),
    tags: json(r.tags),
    created_at: r.created_at,
    calories: r.calories ?? null,
    protein_g: r.protein_g ?? null,
    carbs_g: r.carbs_g ?? null,
    fat_g: r.fat_g ?? null,
    fiber_g: r.fiber_g ?? null,
    cost_cents: r.cost_cents ?? null,
    storage_instructions: r.storage_instructions || '',
    reheat_instructions: r.reheat_instructions || '',
    status: r.status || 'published',
    author: author
      ? {
          id: author.id,
          username: author.username,
          avatar: author.avatar,
          avatar_color: author.avatar_color,
        }
      : null,
    likes,
    comments,
    liked,
    bookmarked,
    is_mine: viewerId === r.author_id,
  };
}

// Enrichit UNE recette avec auteur, likes, commentaires (page détail : un seul appel, pas de souci de perf)
async function decorateRecipe(r, viewerId) {
  const author = await db.get('SELECT * FROM users WHERE id=$1', [r.author_id]);
  const likes = await db.get('SELECT COUNT(*) c FROM likes WHERE recipe_id=$1', [r.id]);
  const comments = await db.get('SELECT COUNT(*) c FROM comments WHERE recipe_id=$1', [r.id]);
  const liked = viewerId
    ? !!(await db.get('SELECT 1 FROM likes WHERE recipe_id=$1 AND user_id=$2', [r.id, viewerId]))
    : false;
  const bookmarked = viewerId
    ? !!(await db.get('SELECT 1 FROM bookmarks WHERE recipe_id=$1 AND user_id=$2', [
        r.id,
        viewerId,
      ]))
    : false;
  return shapeRecipe(r, author, Number(likes.c), Number(comments.c), liked, bookmarked, viewerId);
}

// Enrichit une LISTE de recettes en un nombre constant de requêtes (au lieu d'une poignée
// de requêtes par recette) : indispensable dès que le fil ou un profil contient beaucoup de recettes.
async function decorateRecipes(rows, viewerId) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.id))];
  const idPh = ids.map((_, i) => `$${i + 1}`).join(',');
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const authorPh = authorIds.map((_, i) => `$${i + 1}`).join(',');

  const authorRows = await db.all(
    `SELECT id, username, avatar, avatar_color FROM users WHERE id IN (${authorPh})`,
    authorIds
  );
  const authorMap = new Map(authorRows.map((a) => [a.id, a]));

  const likeRows = await db.all(
    `SELECT recipe_id, COUNT(*) c FROM likes WHERE recipe_id IN (${idPh}) GROUP BY recipe_id`,
    ids
  );
  const likeMap = new Map(likeRows.map((l) => [l.recipe_id, Number(l.c)]));

  const commentRows = await db.all(
    `SELECT recipe_id, COUNT(*) c FROM comments WHERE recipe_id IN (${idPh}) GROUP BY recipe_id`,
    ids
  );
  const commentMap = new Map(commentRows.map((c) => [c.recipe_id, Number(c.c)]));

  let likedSet = new Set(),
    bookmarkedSet = new Set();
  if (viewerId) {
    const idPhOffset = ids.map((_, i) => `$${i + 2}`).join(',');
    const likedRows = await db.all(
      `SELECT recipe_id FROM likes WHERE user_id=$1 AND recipe_id IN (${idPhOffset})`,
      [viewerId, ...ids]
    );
    likedSet = new Set(likedRows.map((r) => r.recipe_id));
    const bookmarkedRows = await db.all(
      `SELECT recipe_id FROM bookmarks WHERE user_id=$1 AND recipe_id IN (${idPhOffset})`,
      [viewerId, ...ids]
    );
    bookmarkedSet = new Set(bookmarkedRows.map((r) => r.recipe_id));
  }
  return rows.map((r) =>
    shapeRecipe(
      r,
      authorMap.get(r.author_id),
      likeMap.get(r.id) || 0,
      commentMap.get(r.id) || 0,
      likedSet.has(r.id),
      bookmarkedSet.has(r.id),
      viewerId
    )
  );
}

// Points de publication + vérification des défis, déclenchés à la publication d'une recette
// (création directe en "published", ou publication d'un brouillon) — jamais deux fois pour
// la même recette (voir les appels dans POST/PUT /api/recipes).
async function awardPublishRecipe(userId, recipeId, tags, category) {
  await award(userId, POINTS.PUBLISH_RECIPE, "Publication d'une recette");
  const recipeTags = (tags || []).map((t) => String(t).toLowerCase());
  const cat = (category || '').toLowerCase();
  // ends_at est une date (TEXT 'YYYY-MM-DD') : un défi reste ouvert jusqu'à la fin de son jour de fin.
  const open = await db.all(
    'SELECT * FROM challenges WHERE ends_at IS NULL OR ends_at::date >= CURRENT_DATE'
  );
  for (const ch of open) {
    if (!ch.tag) continue;
    const t = ch.tag.toLowerCase();
    const already = await db.get(
      'SELECT 1 FROM challenge_entries WHERE challenge_id=$1 AND user_id=$2',
      [ch.id, userId]
    );
    if (already) continue;
    if (recipeTags.includes(t) || cat === t) {
      await db.run(
        'INSERT INTO challenge_entries (challenge_id,user_id,recipe_id) VALUES ($1,$2,$3)',
        [ch.id, userId, recipeId]
      );
      await award(userId, ch.reward_pts, 'Défi validé : ' + ch.title);
      await notify(
        userId,
        null,
        'challenge',
        recipeId,
        `Défi « ${ch.title} » validé ! +${ch.reward_pts} points`
      );
    }
  }
}

module.exports = {
  json,
  DISH_ICONS,
  sanitizeDishIcon,
  sanitizePhoto,
  shapeRecipe,
  decorateRecipe,
  decorateRecipes,
  awardPublishRecipe,
};
