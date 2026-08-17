// gamification.js — Règles de points, niveaux et badges
const db = require('./db');

// Barème de points
const POINTS = {
  PUBLISH_RECIPE: 25,   // publier une recette
  RECEIVE_LIKE:   5,    // un de tes plats reçoit un like
  GIVE_LIKE:      1,    // tu likes un plat
  COMMENT:        3,    // tu commentes
  RECEIVE_FOLLOW: 10,   // quelqu'un te suit
  COMPLETE_CHALLENGE: 50, // valeur par défaut (override par défi)
  DAILY_LOGIN:    5,
};

// Niveaux — seuils cumulés
const LEVELS = [
  { level: 1, name: 'Marmiton',        min: 0 },
  { level: 2, name: 'Commis',          min: 100 },
  { level: 3, name: 'Cuisinier',       min: 300 },
  { level: 4, name: 'Chef de partie',  min: 700 },
  { level: 5, name: 'Sous-chef',       min: 1500 },
  { level: 6, name: 'Chef étoilé',     min: 3000 },
  { level: 7, name: 'Grand Chef',      min: 6000 },
];

function levelFor(points) {
  let current = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) current = l;
  const next = LEVELS.find((l) => l.min > points) || null;
  const progress = next
    ? Math.round(((points - current.min) / (next.min - current.min)) * 100)
    : 100;
  return { ...current, next, progress, points };
}

// Attribue des points à un utilisateur et journalise l'événement
function award(userId, amount, reason) {
  if (!amount) return;
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(amount, userId);
    db.prepare('INSERT INTO point_events (user_id, amount, reason) VALUES (?,?,?)')
      .run(userId, amount, reason);
  });
  tx();
}

// Badges calculés dynamiquement à partir de l'activité
function badgesFor(userId) {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM recipes WHERE author_id = @id)                       AS recipes,
      (SELECT COUNT(*) FROM likes l JOIN recipes r ON r.id = l.recipe_id
         WHERE r.author_id = @id)                                                AS likes_received,
      (SELECT COUNT(*) FROM comments WHERE user_id = @id)                        AS comments,
      (SELECT COUNT(*) FROM follows WHERE following_id = @id)                    AS followers,
      (SELECT COUNT(*) FROM challenge_entries WHERE user_id = @id)               AS challenges,
      (SELECT points FROM users WHERE id = @id)                                  AS points
  `).get({ id: userId });

  const defs = [
    { key: 'first_recipe', icon: '🍳', name: 'Première recette',  desc: 'Publier ta 1ʳᵉ recette',      ok: stats.recipes >= 1 },
    { key: 'prolific',     icon: '📚', name: 'Livre de recettes', desc: 'Publier 5 recettes',          ok: stats.recipes >= 5 },
    { key: 'loved',        icon: '❤️', name: 'Coup de cœur',      desc: 'Recevoir 10 likes',           ok: stats.likes_received >= 10 },
    { key: 'star',         icon: '🌟', name: 'Star des fourneaux',desc: 'Recevoir 50 likes',           ok: stats.likes_received >= 50 },
    { key: 'social',       icon: '💬', name: 'Bavard gourmand',   desc: 'Laisser 10 commentaires',     ok: stats.comments >= 10 },
    { key: 'popular',      icon: '👥', name: 'Populaire',         desc: 'Avoir 5 abonnés',             ok: stats.followers >= 5 },
    { key: 'challenger',   icon: '🏅', name: 'Challenger',        desc: 'Participer à un défi',        ok: stats.challenges >= 1 },
    { key: 'legend',       icon: '👑', name: 'Légende',           desc: 'Atteindre 3000 points',       ok: stats.points >= 3000 },
  ];
  return defs.map((d) => ({ ...d, unlocked: d.ok }));
}

module.exports = { POINTS, LEVELS, levelFor, award, badgesFor };
