// db.js — Connexion et schéma SQLite pour Cuistot
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'cuistot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio           TEXT DEFAULT '',
    avatar        TEXT DEFAULT '🧑‍🍳',
    points        INTEGER DEFAULT 0,
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
    image        TEXT DEFAULT '🍽️',
    photo        TEXT DEFAULT '',     -- URL locale ou data URL (photo réelle, optionnelle)
    ingredients  TEXT DEFAULT '[]',   -- JSON array
    steps        TEXT DEFAULT '[]',   -- JSON array
    tags         TEXT DEFAULT '[]',   -- JSON array
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
    icon        TEXT DEFAULT '🎁',
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
    icon        TEXT DEFAULT '🏆',
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

  CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_id);
  CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
  CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
`);

// Migration douce : ajoute la colonne photo aux bases déjà existantes
try {
  const cols = db.prepare("PRAGMA table_info(recipes)").all();
  if (!cols.some((c) => c.name === 'photo')) {
    db.exec("ALTER TABLE recipes ADD COLUMN photo TEXT DEFAULT ''");
  }
} catch {}

module.exports = db;
