// db.js — Connexion et schéma PostgreSQL pour Cuistot
const { Pool, types } = require('pg');
const { IS_PROD } = require('./config');

// pg renvoie par défaut les colonnes timestamp/timestamptz sous forme d'objets Date JS. On les
// garde en chaîne de caractères (comme le faisait SQLite) pour ne pas avoir à changer tout le
// code qui manipule created_at/expires_at comme du texte (ex: `.slice(0, 10)` dans routes/seo.js).
types.setTypeParser(1114, (v) => v); // timestamp without time zone
types.setTypeParser(1184, (v) => v); // timestamp with time zone

if (!process.env.DATABASE_URL) {
  if (IS_PROD) {
    console.error(
      "❌ DATABASE_URL manquant en production. Configure la variable d'environnement avant de démarrer."
    );
    process.exit(1);
  }
  console.error(
    '❌ DATABASE_URL manquant. Configure une base PostgreSQL locale (voir .env.example) avant de démarrer.'
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // La plupart des fournisseurs hébergés (Render, Neon, Supabase...) exigent TLS mais
  // présentent un certificat que Node ne peut pas valider dans une chaîne standard.
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
});

async function get(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

async function all(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function run(sql, params = []) {
  const { rowCount, rows } = await pool.query(sql, params);
  return { changes: rowCount, rows };
}

// Exécute fn(tx) dans une transaction (BEGIN/COMMIT/ROLLBACK), tx exposant la même API get/all/run
// que le module, mais liée à une connexion unique le temps de la transaction.
async function transaction(fn) {
  const client = await pool.connect();
  const tx = {
    get: async (sql, params = []) => (await client.query(sql, params)).rows[0],
    all: async (sql, params = []) => (await client.query(sql, params)).rows,
    run: async (sql, params = []) => {
      const { rowCount, rows } = await client.query(sql, params);
      return { changes: rowCount, rows };
    },
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
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
      is_admin      INTEGER DEFAULT 0,
      is_suspended  INTEGER DEFAULT 0,
      last_login_award_date TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id           SERIAL PRIMARY KEY,
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
      is_hidden    INTEGER DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS likes (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      is_hidden  INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (follower_id, following_id)
    );

    -- Journal de points : chaque gain/dépense est tracé
    CREATE TABLE IF NOT EXISTS point_events (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount     INTEGER NOT NULL,      -- positif = gain, négatif = dépense
      reason     TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rewards (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon        TEXT DEFAULT 'gift',
      cost        INTEGER NOT NULL,
      stock       INTEGER DEFAULT -1    -- -1 = illimité
    );

    CREATE TABLE IF NOT EXISTS redemptions (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reward_id  INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
      code       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon        TEXT DEFAULT 'trophy',
      reward_pts  INTEGER DEFAULT 50,
      tag         TEXT DEFAULT '',       -- tag/catégorie qui valide le défi
      ends_at     TEXT
    );

    CREATE TABLE IF NOT EXISTS challenge_entries (
      id           SERIAL PRIMARY KEY,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(challenge_id, user_id)
    );

    -- Recettes sauvegardées (carnet « à cuisiner »)
    CREATE TABLE IF NOT EXISTS bookmarks (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, recipe_id)
    );

    -- Notifications (like / commentaire / abonnement / défi)
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- destinataire
      actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,           -- qui a déclenché
      type       TEXT NOT NULL,        -- 'like' | 'comment' | 'follow' | 'challenge'
      recipe_id  INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
      text       TEXT DEFAULT '',
      is_read     INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Jetons de réinitialisation de mot de passe (hashés, courte durée de vie, usage unique)
    CREATE TABLE IF NOT EXISTS password_resets (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Signalements (recette / commentaire / profil)
    CREATE TABLE IF NOT EXISTS reports (
      id          SERIAL PRIMARY KEY,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,   -- 'recipe' | 'comment' | 'user'
      target_id   INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      status      TEXT DEFAULT 'open',  -- 'open' | 'resolved' | 'dismissed'
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    -- Blocages entre utilisateurs
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    );

    -- Journal des actions de modération (accountabilité admin)
    CREATE TABLE IF NOT EXISTS admin_actions (
      id          SERIAL PRIMARY KEY,
      admin_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   INTEGER,
      note        TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT NOW()
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
}

// Toutes les routes/services attendent que le schéma existe avant la première requête. server.js
// et les tests attendent cette promesse (voir bootstrap.js) avant d'accepter du trafic.
const ready = initSchema();

module.exports = { get, all, run, transaction, ready, pool };
