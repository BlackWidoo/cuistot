// server.js — API Cuistot (Express + SQLite)
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { POINTS, levelFor, award, badgesFor } = require('./gamification');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// En production le secret DOIT venir de l'environnement (Render le génère automatiquement,
// voir render.yaml). On refuse de démarrer plutôt que de tourner avec un secret connu de tous.
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant en production. Configure la variable d\'environnement avant de démarrer.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || 'cuistot-dev-secret-change-me';

// Nécessaire pour que req.secure / req.ip reflètent le vrai client derrière le proxy de Render
app.set('trust proxy', 1);

app.use(express.json({ limit: '8mb' })); // marge pour les photos (compressées côté client)
app.use(cookieParser());

// Limiteur maison (pas de dépendance externe) : n tentatives max par fenêtre glissante, par IP
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max)
      return res.status(429).json({ error: message || 'Trop de tentatives, réessaie plus tard.' });
    // Nettoyage paresseux pour ne pas laisser grossir la Map indéfiniment
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    next();
  };
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Trop de tentatives de connexion. Réessaie dans 15 minutes.' });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Trop de comptes créés depuis cette adresse. Réessaie plus tard.' });
const forgotPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 6, message: 'Trop de demandes. Réessaie dans 15 minutes.' });

// Auto-remplissage de la base au premier démarrage (utile pour l'hébergement en ligne)
try {
  const empty = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  if (empty) {
    const { seedData } = require('./seed-core');
    const r = seedData(db);
    console.log(`🌱 Base initialisée : ${r.users} utilisateurs, ${r.recipes} recettes.`);
  }
} catch (e) { console.error('Seed auto ignoré :', e.message); }

// Ne jamais exposer les fichiers du serveur (structure à plat pour un déploiement mobile facile)
const PRIVATE = new Set(['/server.js', '/db.js', '/seed-core.js', '/gamification.js', '/package.json', '/package-lock.json']);
app.use((req, res, next) => {
  if (PRIVATE.has(req.path) || /\.(db|db-wal|db-shm|db-journal)$/.test(req.path))
    return res.status(404).send('Not found');
  next();
});
app.use(express.static(__dirname));

// ---------- Helpers ----------
const json = (v) => { try { return JSON.parse(v); } catch { return []; } };

// Clés d'icônes SVG connues côté client (voir ICONS dans app.js). On valide toute valeur
// venant du client contre cette liste : avant ce garde-fou, le champ "image" d'une recette
// était inséré tel quel dans le HTML du fil sans être échappé (faille XSS stockée).
const DISH_ICONS = new Set(['plate','pot','pasta','bowl','salad','pizza','taco','burger','pan','croissant','pancake','cake','cupcake','donut','icecream','drink']);
function sanitizeDishIcon(v) { return DISH_ICONS.has(v) ? v : 'plate'; }

// Icônes proposées comme avatar de profil : les unes sont libres, les autres se débloquent
// en obtenant le badge correspondant (voir gamification.js pour le détail des conditions).
const AVATAR_ICONS_FREE = new Set(['pan', 'leaf', 'flame', 'user', 'coffee', 'sun', 'moon', 'fish', 'bolt', 'heart']);
const AVATAR_UNLOCKS = { star: 'star', users: 'popular', medal: 'challenger', crown: 'legend', book: 'prolific' };
const AVATAR_ICONS = new Set([...AVATAR_ICONS_FREE, ...Object.keys(AVATAR_UNLOCKS)]);
const AVATAR_COLORS = new Set(['cream', 'terracotta', 'gold', 'olive', 'berry', 'teal']);

// Valide le choix d'avatar d'un utilisateur : clé connue, et débloquée s'il s'agit d'une icône à mérite
function sanitizeAvatar(v, userId) {
  if (!AVATAR_ICONS.has(v)) return 'user';
  const requiredBadge = AVATAR_UNLOCKS[v];
  if (requiredBadge && !badgesFor(userId).some((b) => b.key === requiredBadge && b.unlocked)) return null;
  return v;
}
function sanitizeAvatarColor(v) { return AVATAR_COLORS.has(v) ? v : 'cream'; }

// Valide/normalise une photo : data URL image (compressée côté client) ou chemin local
function sanitizePhoto(p) {
  if (typeof p !== 'string' || !p) return '';
  if (p.startsWith('/photos/')) return p;
  // La compression côté client (resizeImage) vise ~1280px/qualité 0.82, donc quelques
  // centaines de Ko en JPEG ; 3 Mo laisse une marge large sans pour autant permettre
  // n'importe quel binaire encodé en base64 de saturer la base SQLite.
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(p) && p.length < 3_000_000) return p;
  return '';
}

// Crée une notification (jamais pour soi-même)
function notify(userId, actorId, type, recipeId, text) {
  if (!userId || userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id,actor_id,type,recipe_id,text) VALUES (?,?,?,?,?)')
    .run(userId, actorId || null, type, recipeId || null, text || '');
}

// Point d'envoi de l'email de réinitialisation. Pas de fournisseur d'email branché ici :
// on journalise le lien côté serveur. Pour une vraie livraison en prod, remplace le corps
// de cette fonction par un appel à un service comme Resend/Postmark (un simple fetch HTTPS
// avec une clé API suffit, pas besoin de SMTP).
async function sendPasswordResetEmail(email, link) {
  console.log(`✉️  Lien de réinitialisation pour ${email} : ${link}`);
}

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 864e5 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function auth(required = true) {
  return (req, res, next) => {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      if (required) return res.status(401).json({ error: 'Non connecté' });
      req.user = null;
      return next();
    }
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      if (required) return res.status(401).json({ error: 'Session expirée' });
      req.user = null;
      next();
    }
  };
}

function publicUser(u) {
  if (!u) return null;
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(u.id).c;
  const following = db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id=?').get(u.id).c;
  const recipes = db.prepare('SELECT COUNT(*) c FROM recipes WHERE author_id=?').get(u.id).c;
  return {
    id: u.id, username: u.username, bio: u.bio, avatar: u.avatar, avatar_color: u.avatar_color,
    points: u.points, level: levelFor(u.points),
    followers, following, recipes,
  };
}

function shapeRecipe(r, author, likes, comments, liked, bookmarked, viewerId) {
  return {
    id: r.id, title: r.title, description: r.description, category: r.category,
    difficulty: r.difficulty, prep_minutes: r.prep_minutes, servings: r.servings,
    image: r.image, photo: r.photo || '',
    ingredients: json(r.ingredients), steps: json(r.steps),
    tags: json(r.tags), created_at: r.created_at,
    author: author ? { id: author.id, username: author.username, avatar: author.avatar, avatar_color: author.avatar_color } : null,
    likes, comments, liked, bookmarked,
    is_mine: viewerId === r.author_id,
  };
}

// Enrichit UNE recette avec auteur, likes, commentaires (page détail : un seul appel, pas de souci de perf)
function decorateRecipe(r, viewerId) {
  const author = db.prepare('SELECT * FROM users WHERE id=?').get(r.author_id);
  const likes = db.prepare('SELECT COUNT(*) c FROM likes WHERE recipe_id=?').get(r.id).c;
  const comments = db.prepare('SELECT COUNT(*) c FROM comments WHERE recipe_id=?').get(r.id).c;
  const liked = viewerId
    ? !!db.prepare('SELECT 1 FROM likes WHERE recipe_id=? AND user_id=?').get(r.id, viewerId)
    : false;
  const bookmarked = viewerId
    ? !!db.prepare('SELECT 1 FROM bookmarks WHERE recipe_id=? AND user_id=?').get(r.id, viewerId)
    : false;
  return shapeRecipe(r, author, likes, comments, liked, bookmarked, viewerId);
}

// Enrichit une LISTE de recettes en un nombre constant de requêtes (au lieu d'une poignée
// de requêtes par recette) : indispensable dès que le fil ou un profil contient beaucoup de recettes.
function decorateRecipes(rows, viewerId) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.id))];
  const idPh = ids.map(() => '?').join(',');
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const authorPh = authorIds.map(() => '?').join(',');

  const authorMap = new Map(
    db.prepare(`SELECT id, username, avatar, avatar_color FROM users WHERE id IN (${authorPh})`).all(...authorIds)
      .map((a) => [a.id, a])
  );
  const likeMap = new Map(
    db.prepare(`SELECT recipe_id, COUNT(*) c FROM likes WHERE recipe_id IN (${idPh}) GROUP BY recipe_id`).all(...ids)
      .map((l) => [l.recipe_id, l.c])
  );
  const commentMap = new Map(
    db.prepare(`SELECT recipe_id, COUNT(*) c FROM comments WHERE recipe_id IN (${idPh}) GROUP BY recipe_id`).all(...ids)
      .map((c) => [c.recipe_id, c.c])
  );
  let likedSet = new Set(), bookmarkedSet = new Set();
  if (viewerId) {
    likedSet = new Set(
      db.prepare(`SELECT recipe_id FROM likes WHERE user_id=? AND recipe_id IN (${idPh})`).all(viewerId, ...ids)
        .map((r) => r.recipe_id)
    );
    bookmarkedSet = new Set(
      db.prepare(`SELECT recipe_id FROM bookmarks WHERE user_id=? AND recipe_id IN (${idPh})`).all(viewerId, ...ids)
        .map((r) => r.recipe_id)
    );
  }
  return rows.map((r) => shapeRecipe(
    r, authorMap.get(r.author_id),
    likeMap.get(r.id) || 0, commentMap.get(r.id) || 0,
    likedSet.has(r.id), bookmarkedSet.has(r.id), viewerId
  ));
}

// ---------- Auth ----------
app.post('/api/register', registerLimiter, (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Champs manquants' });
  const cleanUsername = String(username).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  if (cleanUsername.length < 3 || cleanUsername.length > 24)
    return res.status(400).json({ error: 'Le pseudo doit faire entre 3 et 24 caractères' });
  if (!EMAIL_RE.test(cleanEmail))
    return res.status(400).json({ error: 'Adresse email invalide' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min. 6)' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, email, password_hash, avatar) VALUES (?,?,?,?)'
    ).run(cleanUsername, cleanEmail, hash, 'pan');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    award(user.id, POINTS.DAILY_LOGIN, 'Bienvenue sur Cuistot !');
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const token = sign(fresh);
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ user: publicUser(fresh) });
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      return res.status(409).json({ error: 'Nom ou email déjà utilisé' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const identifier = (email || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE email=? OR LOWER(username)=?')
    .get(identifier.toLowerCase(), identifier.toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = sign(user);
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
  res.json({ ok: true });
});

app.get('/api/me', auth(false), (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), badges: badgesFor(u.id) });
});

// Choix de l'avatar (icône + couleur du profil)
app.patch('/api/me', auth(), (req, res) => {
  const b = req.body || {};
  const updates = {};
  if (b.avatar !== undefined) {
    const avatar = sanitizeAvatar(b.avatar, req.user.id);
    if (!avatar) return res.status(403).json({ error: 'Avatar pas encore débloqué' });
    updates.avatar = avatar;
  }
  if (b.avatar_color !== undefined) updates.avatar_color = sanitizeAvatarColor(b.avatar_color);
  if (updates.avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(updates.avatar, req.user.id);
  if (updates.avatar_color !== undefined) db.prepare('UPDATE users SET avatar_color=? WHERE id=?').run(updates.avatar_color, req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), badges: badgesFor(u.id) });
});

// ---------- Mot de passe oublié ----------
app.post('/api/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Réponse identique que le compte existe ou non, pour ne pas révéler quels emails sont inscrits
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
      .run(user.id, tokenHash, expiresAt);
    const link = `${req.protocol}://${req.get('host')}/?reset=${token}`;
    try { await sendPasswordResetEmail(user.email, link); } catch (e) { console.error('Envoi email échoué :', e.message); }
    res.json({ ok: true, ...(IS_PROD ? {} : { devToken: token }) });
  } else {
    res.json({ ok: true });
  }
});

app.post('/api/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6)' });
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const row = db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND expires_at >= datetime('now')").get(tokenHash);
  if (!row) return res.status(400).json({ error: 'Lien invalide ou expiré' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, row.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id);
  res.json({ ok: true });
});

// ---------- Recettes / Feed ----------
app.get('/api/recipes', auth(false), (req, res) => {
  const { q, category, sort, author, feed } = req.query;
  let sql = 'SELECT * FROM recipes WHERE 1=1';
  const params = {};
  if (category && category !== 'Tout') { sql += ' AND category=@category'; params.category = category; }
  if (author) { sql += ' AND author_id=@author'; params.author = Number(author); }
  if (q) {
    sql += ' AND (LOWER(title) LIKE @q OR LOWER(description) LIKE @q OR LOWER(ingredients) LIKE @q OR LOWER(tags) LIKE @q)';
    params.q = '%' + q.toLowerCase() + '%';
  }
  if (feed === '1' && req.user) {
    sql += ` AND author_id IN (SELECT following_id FROM follows WHERE follower_id=@viewer)`;
    params.viewer = req.user.id;
  }
  sql += ' ORDER BY created_at DESC';
  let rows = db.prepare(sql).all(params);
  let list = decorateRecipes(rows, req.user?.id);
  if (sort === 'popular') list.sort((a, b) => b.likes - a.likes);
  if (sort === 'trending') list.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 60);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const page = list.slice(offset, offset + limit);
  res.json({ recipes: page, hasMore: offset + limit < list.length, total: list.length });
});

app.get('/api/recipes/:id', auth(false), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Recette introuvable' });
  const recipe = decorateRecipe(r, req.user?.id);
  recipe.commentList = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=? ORDER BY c.created_at DESC
  `).all(r.id);
  res.json({ recipe });
});

// Limites de longueur pour éviter des textes absurdement longs (UI + stockage)
const MAX_TITLE = 120, MAX_DESC = 2000, MAX_COMMENT = 1000;

app.post('/api/recipes', auth(), (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Titre requis' });
  if (String(b.title).length > MAX_TITLE) return res.status(400).json({ error: `Titre trop long (max ${MAX_TITLE} caractères)` });
  if (b.description && String(b.description).length > MAX_DESC) return res.status(400).json({ error: `Description trop longue (max ${MAX_DESC} caractères)` });
  const info = db.prepare(`
    INSERT INTO recipes (author_id, title, description, category, difficulty,
      prep_minutes, servings, image, photo, ingredients, steps, tags)
    VALUES (@author_id,@title,@description,@category,@difficulty,@prep_minutes,
      @servings,@image,@photo,@ingredients,@steps,@tags)
  `).run({
    author_id: req.user.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: Number(b.prep_minutes) || 15, servings: Number(b.servings) || 2,
    image: sanitizeDishIcon(b.image), photo: sanitizePhoto(b.photo),
    ingredients: JSON.stringify(b.ingredients || []),
    steps: JSON.stringify(b.steps || []),
    tags: JSON.stringify(b.tags || []),
  });
  award(req.user.id, POINTS.PUBLISH_RECIPE, 'Publication d\'une recette');

  // Vérifie si la recette valide un défi (par tag/catégorie)
  const recipeTags = (b.tags || []).map((t) => String(t).toLowerCase());
  const cat = (b.category || '').toLowerCase();
  // Un défi ne doit plus rapporter de points une fois sa date de fin passée
  const open = db.prepare("SELECT * FROM challenges WHERE ends_at IS NULL OR ends_at >= datetime('now')").all();
  for (const ch of open) {
    if (!ch.tag) continue;
    const t = ch.tag.toLowerCase();
    const already = db.prepare('SELECT 1 FROM challenge_entries WHERE challenge_id=? AND user_id=?')
      .get(ch.id, req.user.id);
    if (already) continue;
    if (recipeTags.includes(t) || cat === t) {
      db.prepare('INSERT INTO challenge_entries (challenge_id,user_id,recipe_id) VALUES (?,?,?)')
        .run(ch.id, req.user.id, info.lastInsertRowid);
      award(req.user.id, ch.reward_pts, 'Défi validé : ' + ch.title);
      notify(req.user.id, null, 'challenge', info.lastInsertRowid,
        `Défi « ${ch.title} » validé ! +${ch.reward_pts} points`);
    }
  }
  res.json({ recipe: decorateRecipe(db.prepare('SELECT * FROM recipes WHERE id=?').get(info.lastInsertRowid), req.user.id) });
});

app.put('/api/recipes/:id', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  if (r.author_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Titre requis' });
  if (String(b.title).length > MAX_TITLE) return res.status(400).json({ error: `Titre trop long (max ${MAX_TITLE} caractères)` });
  if (b.description && String(b.description).length > MAX_DESC) return res.status(400).json({ error: `Description trop longue (max ${MAX_DESC} caractères)` });
  db.prepare(`UPDATE recipes SET title=@title, description=@description, category=@category,
      difficulty=@difficulty, prep_minutes=@prep_minutes, servings=@servings, image=@image,
      photo=@photo, ingredients=@ingredients, steps=@steps, tags=@tags WHERE id=@id`).run({
    id: r.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: Number(b.prep_minutes) || 15, servings: Number(b.servings) || 2,
    image: sanitizeDishIcon(b.image), photo: b.photo !== undefined ? sanitizePhoto(b.photo) : (r.photo || ''),
    ingredients: JSON.stringify(b.ingredients || []),
    steps: JSON.stringify(b.steps || []),
    tags: JSON.stringify(b.tags || []),
  });
  res.json({ recipe: decorateRecipe(db.prepare('SELECT * FROM recipes WHERE id=?').get(r.id), req.user.id) });
});

app.delete('/api/recipes/:id', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  if (r.author_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  db.prepare('DELETE FROM recipes WHERE id=?').run(r.id);
  res.json({ ok: true });
});

// ---------- Likes ----------
app.post('/api/recipes/:id/like', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
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
    if (r.author_id !== req.user.id) {
      award(req.user.id, POINTS.GIVE_LIKE, 'Like donné');
      award(r.author_id, POINTS.RECEIVE_LIKE, 'Ta recette a été likée');
      notify(r.author_id, req.user.id, 'like', r.id, `${req.user.username} a aimé « ${r.title} »`);
    }
  }
  const likes = db.prepare('SELECT COUNT(*) c FROM likes WHERE recipe_id=?').get(r.id).c;
  res.json({ likes, liked: !exists });
});

// ---------- Favoris / carnet de recettes ----------
app.post('/api/recipes/:id/bookmark', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  const exists = db.prepare('SELECT 1 FROM bookmarks WHERE recipe_id=? AND user_id=?').get(r.id, req.user.id);
  if (exists) db.prepare('DELETE FROM bookmarks WHERE recipe_id=? AND user_id=?').run(r.id, req.user.id);
  else db.prepare('INSERT INTO bookmarks (recipe_id,user_id) VALUES (?,?)').run(r.id, req.user.id);
  res.json({ bookmarked: !exists });
});

app.get('/api/bookmarks', auth(), (req, res) => {
  const rows = db.prepare(`
    SELECT r.* FROM recipes r JOIN bookmarks b ON b.recipe_id=r.id
    WHERE b.user_id=? ORDER BY b.created_at DESC`).all(req.user.id);
  res.json({ recipes: decorateRecipes(rows, req.user.id) });
});

// ---------- Commentaires ----------
app.post('/api/recipes/:id/comments', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Commentaire vide' });
  if (body.length > MAX_COMMENT) return res.status(400).json({ error: `Commentaire trop long (max ${MAX_COMMENT} caractères)` });
  db.prepare('INSERT INTO comments (user_id,recipe_id,body) VALUES (?,?,?)')
    .run(req.user.id, r.id, body);
  if (r.author_id !== req.user.id) {
    award(req.user.id, POINTS.COMMENT, 'Commentaire posté');
    notify(r.author_id, req.user.id, 'comment', r.id, `${req.user.username} a commenté « ${r.title} »`);
  }
  const list = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.username, u.avatar, u.avatar_color
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=? ORDER BY c.created_at DESC
  `).all(r.id);
  res.json({ comments: list });
});

// ---------- Follow ----------
app.post('/api/users/:id/follow', auth(), (req, res) => {
  const target = Number(req.params.id);
  if (target === req.user.id) return res.status(400).json({ error: 'Impossible de se suivre soi-même' });
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(target);
  if (!t) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, target);
  if (exists) {
    db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.user.id, target);
  } else {
    db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run(req.user.id, target);
    award(target, POINTS.RECEIVE_FOLLOW, 'Nouvel abonné');
    notify(target, req.user.id, 'follow', null, `${req.user.username} s'est abonné·e à toi`);
  }
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(target).c;
  res.json({ following: !exists, followers });
});

// ---------- Profils / Utilisateurs ----------
app.get('/api/users/:id', auth(false), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Introuvable' });
  const isFollowing = req.user
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, u.id)
    : false;
  const recipes = decorateRecipes(
    db.prepare('SELECT * FROM recipes WHERE author_id=? ORDER BY created_at DESC').all(u.id),
    req.user?.id
  );
  res.json({ user: publicUser(u), badges: badgesFor(u.id), recipes, isFollowing });
});

// Classement
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY points DESC LIMIT 20').all();
  res.json({ users: rows.map((u, i) => ({ rank: i + 1, ...publicUser(u) })) });
});

// ---------- Boutique de récompenses ----------
app.get('/api/rewards', auth(false), (req, res) => {
  const rewards = db.prepare('SELECT * FROM rewards ORDER BY cost ASC').all();
  const mine = req.user
    ? db.prepare(`SELECT r.*, red.code, red.created_at redeemed_at
         FROM redemptions red JOIN rewards r ON r.id=red.reward_id
         WHERE red.user_id=? ORDER BY red.created_at DESC`).all(req.user.id)
    : [];
  res.json({ rewards, redeemed: mine });
});

app.post('/api/rewards/:id/redeem', auth(), (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Récompense introuvable' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (user.points < reward.cost)
    return res.status(400).json({ error: 'Pas assez de points' });
  if (reward.stock === 0) return res.status(400).json({ error: 'Épuisé' });
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

// ---------- Défis ----------
app.get('/api/challenges', auth(false), (req, res) => {
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

// ---------- Journal de points ----------
app.get('/api/points/history', auth(), (req, res) => {
  const events = db.prepare('SELECT amount, reason, created_at FROM point_events WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id);
  res.json({ events });
});

// ---------- Notifications ----------
app.get('/api/notifications', auth(), (req, res) => {
  const items = db.prepare(`
    SELECT n.id, n.type, n.text, n.recipe_id, n.is_read, n.created_at, u.username actor, u.avatar actor_avatar
    FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
    WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 40`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ notifications: items, unread });
});

app.post('/api/notifications/read', auth(), (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// Catégories dispo
app.get('/api/categories', (req, res) => {
  res.json({ categories: ['Entrée', 'Plat', 'Dessert', 'Petit-déj', 'Végétarien', 'Healthy', 'Boisson', 'Autre'] });
});

// Fallback SPA
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// N'écoute le réseau que si ce fichier est lancé directement (node server.js / npm start).
// Les tests font `require('../server')` pour récupérer l'app Express sans ouvrir de port fixe.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🍽️  Cuistot tourne sur le port ${PORT}\n`);
  });
}
module.exports = app;
