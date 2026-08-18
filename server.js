// server.js — API Cuistot (Express + SQLite)
require('dotenv').config(); // charge .env en local ; sans effet si le fichier n'existe pas (ex: sur Render)
const express = require('express');
const helmet = require('helmet');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { POINTS, levelFor, award, awardCapped, badgesFor, REASONS } = require('./gamification');

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

// ---------- En-têtes de sécurité (Lot 4) ----------
// CSP volontairement restrictive : pas de script inline (les quelques onclick="" du HTML
// généré ont été remplacés par de vrais écouteurs d'événements pour que ça tienne), mais
// 'unsafe-inline' est gardé pour les styles car l'app utilise beaucoup d'attributs
// style="" — les basculer en classes CSS est un chantier séparé (Lot 6, design system),
// et une CSP sans script inline reste la protection qui compte vraiment contre le XSS.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // themealdb.com : photos des recettes de démo (seed-core.js). À retirer si le Lot 2
      // (upload médias externe) remplace ces URLs de démonstration.
      imgSrc: ["'self'", 'data:', 'https://www.themealdb.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(IS_PROD ? {} : { upgradeInsecureRequests: null }), // pas de https forcé en dev local
    },
  },
}));
app.use((req, res, next) => {
  // Helmet ne pose pas Permissions-Policy par défaut : l'app n'utilise aucune de ces API,
  // autant le dire explicitement au navigateur.
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  next();
});

// CORS : volontairement absent. Le front est servi par ce même serveur (même origine), il
// n'y a donc rien à autoriser depuis un domaine tiers. À ajouter seulement si un jour le
// front est hébergé ailleurs — jamais Access-Control-Allow-Origin: * avec des cookies.

app.use(express.json({ limit: '8mb' })); // marge pour les photos (compressées côté client)
app.use(cookieParser());

// ---------- Réponses d'erreur cohérentes ----------
// Toutes les erreurs API suivent la même forme : { error, code, fields? } — voir le brief.
function apiError(res, status, message, code, fields) {
  const body = { error: message, code: code || 'ERROR' };
  if (fields) body.fields = fields;
  return res.status(status).json(body);
}

// Middleware de validation Zod : parse req.body, renvoie une erreur structurée sinon.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return apiError(res, 400, 'Requête invalide', 'VALIDATION_ERROR', fields);
    }
    req.valid = result.data;
    next();
  };
}

// Valide un :id d'URL (entier positif) avant de toucher la base.
function idParam(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return apiError(res, 400, 'Identifiant invalide', 'VALIDATION_ERROR');
  req.id = id;
  next();
}

// ---------- CSRF (cookie + header, "double submit") ----------
// L'authentification repose sur un cookie envoyé automatiquement par le navigateur : sans
// protection supplémentaire, un site tiers pourrait déclencher une requête au nom de
// l'utilisateur connecté (like, suppression de recette...). Le jeton CSRF est lisible en JS
// (pas httpOnly) : un site tiers ne peut pas le lire à cause de la same-origin policy, donc
// ne peut pas le renvoyer dans le header personnalisé — seule notre propre app le peut.
function ensureCsrfCookie(req, res, next) {
  if (!req.cookies.csrf_token) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 864e5 });
    req.cookies.csrf_token = token; // dispo tout de suite si cette même requête est aussi vérifiée
  }
  next();
}
app.use(ensureCsrfCookie);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const header = req.headers['x-csrf-token'];
  if (!header || header !== req.cookies.csrf_token) {
    return apiError(res, 403, 'Requête refusée (jeton de sécurité manquant ou invalide)', 'CSRF_INVALID');
  }
  next();
}
app.use('/api', csrfProtect);

// ---------- Anti-abus ----------
// Limiteur maison (pas de dépendance externe) : n tentatives max par fenêtre glissante.
// Par défaut la clé est l'IP ; keyFn permet de limiter par utilisateur authentifié à la place
// (plus juste que l'IP pour des actions déjà protégées par auth(), évite de punir tout un
// réseau partagé pour l'abus d'un seul compte).
// Limite du modèle : en mémoire process, donc par instance. Reste suffisant pour une seule
// instance (cas actuel) ; à déplacer vers Redis/Upstash avant toute mise à l'échelle
// horizontale (plusieurs instances derrière un load balancer) — voir REDIS_URL dans .env.example.
function rateLimit({ windowMs, max, message, keyFn }) {
  const hits = new Map(); // clé -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : req.ip;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max)
      return apiError(res, 429, message || 'Trop de tentatives, réessaie plus tard.', 'RATE_LIMITED');
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
const recipeCreateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'Trop de recettes publiées récemment. Réessaie plus tard.', keyFn: (req) => `recipe:${req.user?.id}` });
const commentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: 'Trop de commentaires récemment. Réessaie plus tard.', keyFn: (req) => `comment:${req.user?.id}` });
const likeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Doucement sur les likes !', keyFn: (req) => `like:${req.user?.id}` });
// Note : le farming like/unlike est déjà neutralisé (les points sont retirés au unlike), et un
// like sur sa propre recette ne rapporte ni points ni notification (voir la route /like plus
// bas). La détection de réseaux d'échange de likes (A like B qui like A en boucle) demanderait
// une analyse du graphe d'interactions — hors scope de ce lot, à traiter avec de vraies
// données d'usage plutôt qu'à l'aveugle.

// ---------- Santé / infra (Lot 0) ----------
const START_TIME = Date.now();

// Sonde publique et légère : uptime monitors, load balancer, etc. Ne touche pas la base.
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'cuistot', timestamp: new Date().toISOString() });
});

// Sonde "readiness" : vérifie réellement la connectivité DB (et médias, une fois le
// stockage externe branché au Lot 2). Réservée en interne via une clé partagée pour ne
// pas exposer de détails d'infra publiquement ; en dev, accessible sans clé pour tester vite.
app.get('/health/ready', (req, res) => {
  if (IS_PROD) {
    const key = req.headers['x-health-key'];
    if (!process.env.HEALTH_CHECK_KEY || key !== process.env.HEALTH_CHECK_KEY) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
  const checks = { database: 'unknown', media: 'local (base64 en base — migration prévue au Lot 2)' };
  try {
    db.prepare('SELECT 1').get();
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  const ok = checks.database === 'ok';
  res.status(ok ? 200 : 503).json({ ok, uptime_s: Math.round((Date.now() - START_TIME) / 1000), checks });
});

// Auto-remplissage de la base au premier démarrage (utile pour l'hébergement en ligne)
try {
  const empty = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  if (empty) {
    const { seedData } = require('./seed-core');
    const r = seedData(db);
    console.log(`🌱 Base initialisée : ${r.users} utilisateurs, ${r.recipes} recettes.`);
  }
} catch (e) { console.error('Seed auto ignoré :', e.message); }

// Bootstrap admin : si ADMIN_EMAIL est définie, le compte correspondant devient admin au
// démarrage (idempotent, sans effet si le compte n'existe pas encore — retentera au prochain
// redémarrage une fois qu'il existera). Aucun compte externe requis, juste une variable
// d'environnement choisie par l'exploitant du service.
if (process.env.ADMIN_EMAIL) {
  try {
    const r = db.prepare('UPDATE users SET is_admin=1 WHERE email=?').run(process.env.ADMIN_EMAIL.trim().toLowerCase());
    if (r.changes) console.log(`👑 ${process.env.ADMIN_EMAIL} promu administrateur.`);
  } catch (e) { console.error('Bootstrap admin ignoré :', e.message); }
}

// Ne jamais exposer les fichiers du serveur (structure à plat pour un déploiement mobile facile)
const PRIVATE = new Set(['/server.js', '/db.js', '/seed-core.js', '/gamification.js', '/package.json', '/package-lock.json']);
app.use((req, res, next) => {
  // .env* (sauf .env.example, volontairement documentaire) : ne doit jamais être servi même
  // si le fichier existe par accident sur le disque du serveur — le .gitignore l'empêche déjà
  // d'être commité, ceci est une deuxième barrière côté runtime.
  if (/\/\.env($|\.(?!example$))/.test(req.path))
    return res.status(404).send('Not found');
  if (PRIVATE.has(req.path) || /\.(db|db-wal|db-shm|db-journal)$/.test(req.path))
    return res.status(404).send('Not found');
  next();
});
app.use(express.static(__dirname));

// ---------- Helpers ----------
const json = (v) => { try { return JSON.parse(v); } catch { return []; } };

// Limites de longueur pour éviter des textes absurdement longs (UI + stockage + schémas Zod)
const MAX_TITLE = 120, MAX_DESC = 2000, MAX_COMMENT = 1000;
const MIN_COMMENT_FOR_POINTS = 8; // en dessous, le commentaire est publié mais ne rapporte pas de points (Lot 9)

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

function auth(required = true) {
  return (req, res, next) => {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      if (required) return apiError(res, 401, 'Non connecté', 'UNAUTHORIZED');
      req.user = null;
      return next();
    }
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      if (required) return apiError(res, 401, 'Session expirée', 'UNAUTHORIZED');
      req.user = null;
      next();
    }
  };
}

// À placer après auth() sur une route : exige que l'utilisateur connecté soit admin.
function requireAdmin(req, res, next) {
  const u = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.user.id);
  if (!u?.is_admin) return apiError(res, 403, 'Réservé aux administrateurs', 'FORBIDDEN');
  next();
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
    is_admin: !!u.is_admin,
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

// ---------- Schémas de validation (Zod) ----------
// Mot de passe : 10 caractères minimum (relevé depuis 6 — recommandation du brief, Lot 3).
const passwordSchema = z.string().min(10, 'Minimum 10 caractères').max(200);

const registerSchema = z.object({
  username: z.string().trim().min(3, 'Le pseudo doit faire entre 3 et 24 caractères').max(24, 'Le pseudo doit faire entre 3 et 24 caractères'),
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(254),
  password: passwordSchema,
});
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Champ requis').max(254), // email OU pseudo, pas de .email() ici
  password: z.string().min(1, 'Champ requis').max(200),
});
const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(254),
});
const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
const avatarPatchSchema = z.object({
  avatar: z.string().max(30).optional(),
  avatar_color: z.string().max(30).optional(),
}).refine((d) => d.avatar !== undefined || d.avatar_color !== undefined, { message: 'Rien à mettre à jour' });
const recipeSchema = z.object({
  title: z.string().trim().min(1, 'Titre requis').max(MAX_TITLE, `Titre trop long (max ${MAX_TITLE} caractères)`),
  description: z.string().max(MAX_DESC, `Description trop longue (max ${MAX_DESC} caractères)`).optional(),
  category: z.string().max(40).optional(),
  difficulty: z.string().max(40).optional(),
  // .catch() plutôt que .optional() : un champ vidé par erreur (input number effacé) retombe
  // sur la valeur par défaut au lieu de faire échouer toute la validation, comme avant Zod.
  prep_minutes: z.coerce.number().int().min(1).max(1440).catch(15),
  servings: z.coerce.number().int().min(1).max(100).catch(2),
  image: z.string().max(30).optional(),
  photo: z.string().max(3_100_000).optional(),
  ingredients: z.array(z.string().max(200)).max(60).optional(),
  steps: z.array(z.string().max(1000)).max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
const commentSchema = z.object({
  body: z.string().trim().min(1, 'Commentaire vide').max(MAX_COMMENT, `Commentaire trop long (max ${MAX_COMMENT} caractères)`),
});
const reportSchema = z.object({
  target_type: z.enum(['recipe', 'comment', 'user']),
  target_id: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, 'Explique un peu plus').max(500),
});
const resolveReportSchema = z.object({
  action: z.enum(['hide', 'dismiss', 'suspend_user']),
});
const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis').max(200),
});

// ---------- Auth ----------
app.post('/api/register', registerLimiter, validate(registerSchema), (req, res) => {
  const { username, email, password } = req.valid;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (username, email, password_hash, avatar) VALUES (?,?,?,?)'
    ).run(username, email, hash, 'pan');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    award(user.id, POINTS.DAILY_LOGIN, 'Bienvenue sur Cuistot !');
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const token = sign(fresh);
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ user: publicUser(fresh) });
  } catch (e) {
    if (String(e).includes('UNIQUE'))
      return apiError(res, 409, 'Nom ou email déjà utilisé', 'CONFLICT');
    apiError(res, 500, 'Erreur serveur', 'SERVER_ERROR');
  }
});

app.post('/api/login', loginLimiter, validate(loginSchema), (req, res) => {
  const identifier = req.valid.email.trim();
  const user = db.prepare('SELECT * FROM users WHERE email=? OR LOWER(username)=?')
    .get(identifier.toLowerCase(), identifier.toLowerCase());
  if (!user || !bcrypt.compareSync(req.valid.password, user.password_hash))
    return apiError(res, 401, 'Identifiants incorrects', 'UNAUTHORIZED');
  if (user.is_suspended) return apiError(res, 403, 'Ce compte a été suspendu', 'SUSPENDED');

  // Bonus de connexion quotidien : série "souple", pas de pénalité si elle casse — un bonus
  // fixe la première fois qu'on se connecte un jour donné, c'est tout.
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_login_award_date !== today) {
    award(user.id, POINTS.DAILY_LOGIN, 'Connexion quotidienne');
    db.prepare('UPDATE users SET last_login_award_date=? WHERE id=?').run(today, user.id);
  }

  const token = sign(user);
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
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
app.patch('/api/me', auth(), validate(avatarPatchSchema), (req, res) => {
  const b = req.valid;
  const updates = {};
  if (b.avatar !== undefined) {
    const avatar = sanitizeAvatar(b.avatar, req.user.id);
    if (!avatar) return apiError(res, 403, 'Avatar pas encore débloqué', 'FORBIDDEN');
    updates.avatar = avatar;
  }
  if (b.avatar_color !== undefined) updates.avatar_color = sanitizeAvatarColor(b.avatar_color);
  if (updates.avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(updates.avatar, req.user.id);
  if (updates.avatar_color !== undefined) db.prepare('UPDATE users SET avatar_color=? WHERE id=?').run(updates.avatar_color, req.user.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u), badges: badgesFor(u.id) });
});

// ---------- Mot de passe oublié ----------
app.post('/api/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), async (req, res) => {
  const email = req.valid.email;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Réponse identique que le compte existe ou non, pour ne pas révéler quels emails sont inscrits
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
      .run(user.id, tokenHash, expiresAt);
    // APP_URL plutôt que reconstruire depuis les headers de la requête, qui ne sont pas fiables
    // (Host peut être falsifié par un client) — voir .env.example.
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/?reset=${token}`;
    try { await sendPasswordResetEmail(user.email, link); } catch (e) { console.error('Envoi email échoué :', e.message); }
    res.json({ ok: true, ...(IS_PROD ? {} : { devToken: token }) });
  } else {
    res.json({ ok: true });
  }
});

app.post('/api/reset-password', validate(resetPasswordSchema), (req, res) => {
  const { token, password } = req.valid;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND expires_at >= datetime('now')").get(tokenHash);
  if (!row) return apiError(res, 400, 'Lien invalide ou expiré', 'INVALID_TOKEN');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, row.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id);
  // TODO (Lot 3 complet) : invalider les sessions actives de l'utilisateur ici (nécessite un
  // identifiant de session / une table sessions — les JWT actuels sont sans état donc ne
  // peuvent pas être révoqués individuellement avant leur expiration naturelle de 30 jours).
  res.json({ ok: true });
});

// ---------- Recettes / Feed ----------
app.get('/api/recipes', auth(false), (req, res) => {
  const { q, category, sort, author, feed } = req.query;
  // Masque le contenu retiré par la modération et celui des comptes suspendus, partout.
  let sql = "SELECT * FROM recipes WHERE is_hidden=0 AND author_id NOT IN (SELECT id FROM users WHERE is_suspended=1)";
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

app.get('/api/recipes/:id', idParam, auth(false), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Recette introuvable', 'NOT_FOUND');
  if (r.is_hidden && r.author_id !== req.user?.id) {
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

app.post('/api/recipes', auth(), recipeCreateLimiter, validate(recipeSchema), (req, res) => {
  const b = req.valid;
  const info = db.prepare(`
    INSERT INTO recipes (author_id, title, description, category, difficulty,
      prep_minutes, servings, image, photo, ingredients, steps, tags)
    VALUES (@author_id,@title,@description,@category,@difficulty,@prep_minutes,
      @servings,@image,@photo,@ingredients,@steps,@tags)
  `).run({
    author_id: req.user.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: b.prep_minutes || 15, servings: b.servings || 2,
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

app.put('/api/recipes/:id', idParam, auth(), validate(recipeSchema), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  if (r.author_id !== req.user.id) return apiError(res, 403, 'Non autorisé', 'FORBIDDEN');
  const b = req.valid;
  db.prepare(`UPDATE recipes SET title=@title, description=@description, category=@category,
      difficulty=@difficulty, prep_minutes=@prep_minutes, servings=@servings, image=@image,
      photo=@photo, ingredients=@ingredients, steps=@steps, tags=@tags WHERE id=@id`).run({
    id: r.id,
    title: b.title, description: b.description || '',
    category: b.category || 'Autre', difficulty: b.difficulty || 'Facile',
    prep_minutes: b.prep_minutes || 15, servings: b.servings || 2,
    image: sanitizeDishIcon(b.image), photo: b.photo !== undefined ? sanitizePhoto(b.photo) : (r.photo || ''),
    ingredients: JSON.stringify(b.ingredients || []),
    steps: JSON.stringify(b.steps || []),
    tags: JSON.stringify(b.tags || []),
  });
  res.json({ recipe: decorateRecipe(db.prepare('SELECT * FROM recipes WHERE id=?').get(r.id), req.user.id) });
});

app.delete('/api/recipes/:id', idParam, auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  if (r.author_id !== req.user.id) return apiError(res, 403, 'Non autorisé', 'FORBIDDEN');
  db.prepare('DELETE FROM recipes WHERE id=?').run(r.id);
  res.json({ ok: true });
});

// ---------- Likes ----------
app.post('/api/recipes/:id/like', idParam, auth(), likeLimiter, (req, res) => {
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
app.post('/api/recipes/:id/bookmark', idParam, auth(), (req, res) => {
  const r = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.id);
  if (!r) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
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
app.post('/api/recipes/:id/comments', idParam, auth(), commentLimiter, validate(commentSchema), (req, res) => {
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

// ---------- Follow ----------
app.post('/api/users/:id/follow', idParam, auth(), (req, res) => {
  const target = req.id;
  if (target === req.user.id) return apiError(res, 400, 'Impossible de se suivre soi-même', 'VALIDATION_ERROR');
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(target);
  if (!t) return apiError(res, 404, 'Utilisateur introuvable', 'NOT_FOUND');
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

// ---------- Blocage ----------
app.post('/api/users/:id/block', idParam, auth(), (req, res) => {
  const target = req.id;
  if (target === req.user.id) return apiError(res, 400, 'Impossible de se bloquer soi-même', 'VALIDATION_ERROR');
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(target);
  if (!t) return apiError(res, 404, 'Utilisateur introuvable', 'NOT_FOUND');
  const exists = db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(req.user.id, target);
  if (exists) {
    db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(req.user.id, target);
  } else {
    db.prepare('INSERT INTO blocks (blocker_id,blocked_id) VALUES (?,?)').run(req.user.id, target);
    // Bloquer coupe aussi les abonnements dans les deux sens
    db.prepare('DELETE FROM follows WHERE (follower_id=? AND following_id=?) OR (follower_id=? AND following_id=?)')
      .run(req.user.id, target, target, req.user.id);
  }
  res.json({ blocked: !exists });
});

app.get('/api/blocked', auth(), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.avatar_color FROM blocks b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id=? ORDER BY b.created_at DESC`).all(req.user.id);
  res.json({ users: rows });
});

// ---------- Signalements ----------
app.post('/api/reports', auth(), validate(reportSchema), (req, res) => {
  const { target_type, target_id, reason } = req.valid;
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?,?,?,?)')
    .run(req.user.id, target_type, target_id, reason);
  res.json({ ok: true });
});

// ---------- Modération (admin) ----------
app.get('/api/admin/reports', auth(), requireAdmin, (req, res) => {
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

app.post('/api/admin/reports/:id/resolve', idParam, auth(), requireAdmin, validate(resolveReportSchema), (req, res) => {
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

// ---------- Compte : export et suppression ----------
app.get('/api/me/export', auth(), (req, res) => {
  const uid = req.user.id;
  const data = {
    user: db.prepare('SELECT id, username, email, bio, avatar, avatar_color, points, created_at FROM users WHERE id=?').get(uid),
    recipes: db.prepare('SELECT * FROM recipes WHERE author_id=?').all(uid),
    comments: db.prepare('SELECT * FROM comments WHERE user_id=?').all(uid),
    likes_given: db.prepare('SELECT recipe_id, created_at FROM likes WHERE user_id=?').all(uid),
    following: db.prepare('SELECT following_id, created_at FROM follows WHERE follower_id=?').all(uid),
    points_history: db.prepare('SELECT amount, reason, created_at FROM point_events WHERE user_id=?').all(uid),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="cuistot-mes-donnees.json"');
  res.json(data);
});

app.delete('/api/me', auth(), validate(deleteAccountSchema), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(req.valid.password, user.password_hash))
    return apiError(res, 401, 'Mot de passe incorrect', 'UNAUTHORIZED');
  // Toutes les tables liées ont ON DELETE CASCADE (recettes, likes, commentaires, follows,
  // favoris, notifications, historique de points, redemptions, participations aux défis...)
  db.prepare('DELETE FROM users WHERE id=?').run(user.id);
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
  res.json({ ok: true });
});

// ---------- Profils / Utilisateurs ----------
app.get('/api/users/:id', idParam, auth(false), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.id);
  if (!u) return apiError(res, 404, 'Introuvable', 'NOT_FOUND');
  const isFollowing = req.user
    ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, u.id)
    : false;
  const isBlocked = req.user
    ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(req.user.id, u.id)
    : false;
  const recipes = decorateRecipes(
    db.prepare('SELECT * FROM recipes WHERE author_id=? AND is_hidden=0 ORDER BY created_at DESC').all(u.id),
    req.user?.id
  );
  res.json({ user: publicUser(u), badges: badgesFor(u.id), recipes, isFollowing, isBlocked });
});

// Classement
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT * FROM users WHERE is_suspended=0 ORDER BY points DESC LIMIT 20').all();
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

app.post('/api/rewards/:id/redeem', idParam, auth(), (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id=?').get(req.id);
  if (!reward) return apiError(res, 404, 'Récompense introuvable', 'NOT_FOUND');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (user.points < reward.cost)
    return apiError(res, 400, 'Pas assez de points', 'INSUFFICIENT_POINTS');
  if (reward.stock === 0) return apiError(res, 400, 'Épuisé', 'OUT_OF_STOCK');
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
