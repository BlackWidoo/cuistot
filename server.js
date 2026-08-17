// server.js — API Cuistot (Express + SQLite)
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db');
const { POINTS, levelFor, award, badgesFor } = require('./gamification');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cuistot-dev-secret-change-me';

app.use(express.json({ limit: '8mb' })); // marge pour les photos (compressées côté client)
app.use(cookieParser());

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

// Valide/normalise une photo : data URL image (compressée côté client) ou chemin local
function sanitizePhoto(p) {
  if (typeof p !== 'string' || !p) return '';
  if (p.startsWith('/photos/')) return p;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(p) && p.length < 7_000_000) return p;
  return '';
}

// Crée une notification (jamais pour soi-même)
function notify(userId, actorId, type, recipeId, text) {
  if (!userId || userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id,actor_id,type,recipe_id,text) VALUES (?,?,?,?,?)')
    .run(userId, actorId || null, type, recipeId || null, text || '');
}

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

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
    id: u.id, username: u.username, bio: u.bio, avatar: u.avatar,
    points: u.points, level: levelFor(u.points),
    followers, following, recipes,
  };
}

// Enrichit une recette avec auteur, likes, commentaires
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
  return {
    id: r.id, title: r.title, description: r.description, category: r.category,
    difficulty: r.difficulty, prep_minutes: r.prep_minutes, servings: r.servings,
    image: r.image, photo: r.photo || '',
    ingredients: json(r.ingredients), steps: json(r.steps),
    tags: json(r.tags), created_at: r.created_at,
    author: { id: author.id, username: author.username, avatar: author.avatar },
    likes, comments, liked, bookmarked,
    is_mine: viewerId === r.author_id,
  };
}

// ---------- Auth ----------
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Champs manquants' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min. 6)' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, email, password_hash, avatar) VALUES (?,?,?,?)'
    ).run(username.trim(), email.trim().toLowerCase(), hash, '🧑‍🍳');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    award(user.id, POINTS.DAILY_LOGIN, 'Bienvenue sur Cuistot 🎉');
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const token = sign(fresh);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 864e5 });
    res.json({ token, user: publicUser(fresh) });
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      return res.status(409).json({ error: 'Nom ou email déjà utilisé' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=? OR username=?')
    .get((email || '').trim().toLowerCase(), (email || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = sign(user);
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 864e5 });
  res.json({ token, user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth(false), (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), badges: badgesFor(u.id) });
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
  let list = rows.map((r) => decorateRecipe(r, req.user?.id));
  if (sort === 'popular') list.sort((a, b) => b.likes - a.likes);
  if (sort === 'trending') list.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));
  res.json({ recipes: list });
});

app.get('/api/recipes/:id', auth(false), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Recette introuvable' });
  const recipe = decorateRecipe(r, req.user?.id);
  recipe.commentList = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.username, u.avatar
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.recipe_id=? ORDER BY c.created_at DESC
  `).all(r.id);
  res.json({ recipe });
});

app.post('/api/recipes', auth(), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Titre requis' });
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
    image: b.image || '🍽️', photo: sanitizePhoto(b.photo),
    ingredients: JSON.stringify(b.ingredients || []),
    steps: JSON.stringify(b.steps || []),
    tags: JSON.stringify(b.tags || []),
  });
  award(req.user.id, POINTS.PUBLISH_RECIPE, 'Publication d\'une recette');

  // Vérifie si la recette valide un défi (par tag/catégorie)
  const recipeTags = (b.tags || []).map((t) => String(t).toLowerCase());
  const cat = (b.category || '').toLowerCase();
  const open = db.prepare('SELECT * FROM challenges').all();
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
        `Défi « ${ch.title} » validé ! +${ch.reward_pts} points ${ch.icon}`);
    }
  }
  res.json({ recipe: decorateRecipe(db.prepare('SELECT * FROM recipes WHERE id=?').get(info.lastInsertRowid), req.user.id) });
});

app.put('/api/recipes/:id', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  if (r.author_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Titre requis' });
  db.prepare(`UPDATE recipes SET title=@title, description=@description, category=@category,
      difficulty=@difficulty, prep_minutes=@prep_minutes, servings=@servings, image=@image,
      photo=@photo, ingredients=@ingredients, steps=@steps, tags=@tags WHERE id=@id`).run({
    id: r.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: Number(b.prep_minutes) || 15, servings: Number(b.servings) || 2,
    image: b.image || '🍽️', photo: b.photo !== undefined ? sanitizePhoto(b.photo) : (r.photo || ''),
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
      notify(r.author_id, req.user.id, 'like', r.id, `${req.user.username} a aimé « ${r.title} » ❤️`);
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
  res.json({ recipes: rows.map((r) => decorateRecipe(r, req.user.id)) });
});

// ---------- Commentaires ----------
app.post('/api/recipes/:id/comments', auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Commentaire vide' });
  db.prepare('INSERT INTO comments (user_id,recipe_id,body) VALUES (?,?,?)')
    .run(req.user.id, r.id, body);
  if (r.author_id !== req.user.id) {
    award(req.user.id, POINTS.COMMENT, 'Commentaire posté');
    notify(r.author_id, req.user.id, 'comment', r.id, `${req.user.username} a commenté « ${r.title} » 💬`);
  }
  const list = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.username, u.avatar
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
    notify(target, req.user.id, 'follow', null, `${req.user.username} s'est abonné·e à toi 👥`);
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
  const recipes = db.prepare('SELECT * FROM recipes WHERE author_id=? ORDER BY created_at DESC')
    .all(u.id).map((r) => decorateRecipe(r, req.user?.id));
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

app.listen(PORT, () => {
  console.log(`\n🍽️  Cuistot tourne sur le port ${PORT}\n`);
});
