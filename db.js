// db.js — Connexion et schéma SQLite pour Cuistot
const Database = require('better-sqlite3');
const path = require('path');

// Configurable pour les tests (DB_PATH=":memory:") sans toucher au fichier de prod
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'cuistot.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio           TEXT DEFAULT '',
    avatar        TEXT DEFAULT 'pan',
    avatar_color  TEXT DEFAULT 'cream',
    points        INTEGER DEFAULT 0,
    is_premium         INTEGER DEFAULT 0,
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    category     TEXT DEFAULT 'Autre',
    difficulty   TEXT DEFAULT 'Facile',
    prep_minutes INTEGER DEFAULT 15,
    servings     INTEGER DEFAULT 2,
    image        TEXT DEFAULT 'plate',
    photo        TEXT DEFAULT '',     -- URL locale ou data URL (photo réelle, optionnelle)
    ingredients  TEXT DEFAULT '[]',   -- JSON array (chaînes legacy ou {qty,unit,label})
    steps        TEXT DEFAULT '[]',   -- JSON array
    tags         TEXT DEFAULT '[]',   -- JSON array
    calories     INTEGER,             -- par portion
    protein_g    REAL,
    carbs_g      REAL,
    fat_g        REAL,
    fiber_g      REAL,
    cost_cents   INTEGER,             -- coût par portion, centimes d'euro
    storage_instructions TEXT DEFAULT '',
    reheat_instructions  TEXT DEFAULT '',
    status       TEXT DEFAULT 'published', -- 'draft' | 'published'
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS likes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, recipe_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
  );

  -- Journal de points : chaque gain/dépense est tracé
  CREATE TABLE IF NOT EXISTS point_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     INTEGER NOT NULL,      -- positif = gain, négatif = dépense
    reason     TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rewards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon        TEXT DEFAULT 'gift',
    cost        INTEGER NOT NULL,
    stock       INTEGER DEFAULT -1    -- -1 = illimité
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id  INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon        TEXT DEFAULT 'trophy',
    reward_pts  INTEGER DEFAULT 50,
    tag         TEXT DEFAULT '',       -- tag/catégorie qui valide le défi
    ends_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS challenge_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    created_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(challenge_id, user_id)
  );

  -- Recettes sauvegardées (carnet « à cuisiner »)
  CREATE TABLE IF NOT EXISTS bookmarks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, recipe_id)
  );

  -- Notifications (like / commentaire / abonnement / défi)
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- destinataire
    actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,           -- qui a déclenché
    type       TEXT NOT NULL,        -- 'like' | 'comment' | 'follow' | 'challenge'
    recipe_id  INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
    text       TEXT DEFAULT '',
    is_read     INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Jetons de réinitialisation de mot de passe (hashés, courte durée de vie, usage unique)
  CREATE TABLE IF NOT EXISTS password_resets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Signalements (recette / commentaire / profil)
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,   -- 'recipe' | 'comment' | 'user'
    target_id   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT DEFAULT 'open',  -- 'open' | 'resolved' | 'dismissed'
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Blocages entre utilisateurs
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (blocker_id, blocked_id)
  );

  -- Journal des actions de modération (accountabilité admin)
  CREATE TABLE IF NOT EXISTS admin_actions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   INTEGER,
    note        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_resets(user_id);
  CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_id);
  CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
  CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
`);

// Migration douce : ajoute la colonne photo aux bases déjà existantes
try {
  const cols = db.prepare("PRAGMA table_info(recipes)").all();
  if (!cols.some((c) => c.name === 'photo')) {
    db.exec("ALTER TABLE recipes ADD COLUMN photo TEXT DEFAULT ''");
  }
} catch {}

// Migration douce : ajoute la couleur d'avatar aux bases déjà existantes
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.some((c) => c.name === 'avatar_color')) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT 'cream'");
  }
} catch {}

// Migration douce : statut premium / identifiants Stripe (fonctionnalité pas encore branchée
// côté routes — colonnes ajoutées par anticipation, cf. discussion avatars premium)
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const names = cols.map((c) => c.name);
  if (!names.includes('is_premium')) db.exec('ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0');
  if (!names.includes('stripe_customer_id')) db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT');
  if (!names.includes('stripe_subscription_id')) db.exec('ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT');
} catch {}

// Migration douce : modération (admin, suspension, contenu masqué) et série de connexion
try {
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!userCols.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
  if (!userCols.includes('is_suspended')) db.exec('ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0');
  if (!userCols.includes('last_login_award_date')) db.exec('ALTER TABLE users ADD COLUMN last_login_award_date TEXT');

  const recipeCols = db.prepare("PRAGMA table_info(recipes)").all().map((c) => c.name);
  if (!recipeCols.includes('is_hidden')) db.exec('ALTER TABLE recipes ADD COLUMN is_hidden INTEGER DEFAULT 0');

  const commentCols = db.prepare("PRAGMA table_info(comments)").all().map((c) => c.name);
  if (!commentCols.includes('is_hidden')) db.exec('ALTER TABLE comments ADD COLUMN is_hidden INTEGER DEFAULT 0');
} catch {}

// Migration douce : macros/coût/conservation/brouillons (Lot 8)
try {
  const recipeCols = db.prepare("PRAGMA table_info(recipes)").all().map((c) => c.name);
  const addIfMissing = (name, def) => { if (!recipeCols.includes(name)) db.exec(`ALTER TABLE recipes ADD COLUMN ${def}`); };
  addIfMissing('calories', 'calories INTEGER');
  addIfMissing('protein_g', 'protein_g REAL');
  addIfMissing('carbs_g', 'carbs_g REAL');
  addIfMissing('fat_g', 'fat_g REAL');
  addIfMissing('fiber_g', 'fiber_g REAL');
  addIfMissing('cost_cents', 'cost_cents INTEGER');
  addIfMissing('storage_instructions', "storage_instructions TEXT DEFAULT ''");
  addIfMissing('reheat_instructions', "reheat_instructions TEXT DEFAULT ''");
  addIfMissing('status', "status TEXT DEFAULT 'published'");
} catch {}

// Ces migrations "douces" au démarrage sont un raccourci propre à SQLite/MVP. Le Lot 1 du
// brief (migration PostgreSQL) les remplacera par un vrai système de migrations versionnées
// et idempotentes (dossier db/migrations/, exécuté explicitement, pas au chargement du module).

module.exports = db;
