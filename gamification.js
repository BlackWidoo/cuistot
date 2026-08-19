// gamification.js — Règles de points, niveaux et badges
const db = require('./db');

// Barème de points
const POINTS = {
  PUBLISH_RECIPE: 25, // publier une recette
  RECEIVE_LIKE: 5, // un de tes plats reçoit un like
  GIVE_LIKE: 0, // liker ne rapporte plus rien (évitait le farming like/unlike) — Lot 9
  COMMENT: 3, // tu commentes (sous réserve d'un commentaire non trivial, voir server.js)
  RECEIVE_FOLLOW: 10, // quelqu'un te suit
  COMPLETE_CHALLENGE: 50, // valeur par défaut (override par défi)
  DAILY_LOGIN: 5,
};

// Raisons de points soumises à un plafond quotidien (Lot 9 — anti-farming). L'action elle-même
// (recevoir un like, commenter) n'est jamais bloquée : seul l'octroi de points au-delà du
// plafond du jour est silencieusement ignoré.
const REASONS = {
  RECEIVE_LIKE: 'Ta recette a été likée',
  COMMENT: 'Commentaire posté',
};
const DAILY_CAPS = {
  [REASONS.RECEIVE_LIKE]: 100, // ~20 likes reçus/jour avant plafond, au barème actuel
  [REASONS.COMMENT]: 30, // ~10 commentaires/jour avant plafond, au barème actuel
};

// Niveaux — seuils cumulés
const LEVELS = [
  { level: 1, name: 'Marmiton', min: 0 },
  { level: 2, name: 'Commis', min: 100 },
  { level: 3, name: 'Cuisinier', min: 300 },
  { level: 4, name: 'Chef de partie', min: 700 },
  { level: 5, name: 'Sous-chef', min: 1500 },
  { level: 6, name: 'Chef étoilé', min: 3000 },
  { level: 7, name: 'Grand Chef', min: 6000 },
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

// Attribue des points à un utilisateur et journalise l'événement. Le solde ne descend jamais
// sous 0 (ex: un retrait de like plafonné par le farming-cap ne doit pas passer l'auteur en
// négatif) ; l'événement journalisé garde le montant nominal demandé, pour un historique lisible.
async function award(userId, amount, reason) {
  if (!amount) return;
  await db.transaction(async (tx) => {
    await tx.run('UPDATE users SET points = GREATEST(0, points + $1) WHERE id = $2', [
      amount,
      userId,
    ]);
    await tx.run('INSERT INTO point_events (user_id, amount, reason) VALUES ($1,$2,$3)', [
      userId,
      amount,
      reason,
    ]);
  });
}

// Total déjà gagné aujourd'hui (dernières 24h glissantes) pour une raison donnée
async function dailyEarned(userId, reason) {
  const row = await db.get(
    `
    SELECT COALESCE(SUM(amount),0) c FROM point_events
    WHERE user_id=$1 AND reason=$2 AND amount>0 AND created_at >= NOW() - INTERVAL '1 day'
  `,
    [userId, reason]
  );
  return Number(row.c);
}

// Comme award(), mais plafonne le total gagné par jour pour les raisons listées dans
// DAILY_CAPS. Utiliser award() directement pour tout ce qui ne doit pas être plafonné
// (publication de recette, défis, abonnés...).
async function awardCapped(userId, amount, reason) {
  const cap = DAILY_CAPS[reason];
  if (cap) {
    const already = await dailyEarned(userId, reason);
    if (already >= cap) return;
    amount = Math.min(amount, cap - already);
  }
  await award(userId, amount, reason);
}

// Badges calculés dynamiquement à partir de l'activité
async function badgesFor(userId) {
  const stats = await db.get(
    `
    SELECT
      (SELECT COUNT(*) FROM recipes WHERE author_id = $1)                       AS recipes,
      (SELECT COUNT(*) FROM likes l JOIN recipes r ON r.id = l.recipe_id
         WHERE r.author_id = $1)                                                AS likes_received,
      (SELECT COUNT(*) FROM comments WHERE user_id = $1)                        AS comments,
      (SELECT COUNT(*) FROM follows WHERE following_id = $1)                    AS followers,
      (SELECT COUNT(*) FROM challenge_entries WHERE user_id = $1)               AS challenges,
      (SELECT points FROM users WHERE id = $1)                                  AS points
  `,
    [userId]
  );
  stats.recipes = Number(stats.recipes);
  stats.likes_received = Number(stats.likes_received);
  stats.comments = Number(stats.comments);
  stats.followers = Number(stats.followers);
  stats.challenges = Number(stats.challenges);
  stats.points = Number(stats.points);

  const defs = [
    {
      key: 'first_recipe',
      icon: 'pan',
      name: 'Première recette',
      desc: 'Publier ta 1ʳᵉ recette',
      ok: stats.recipes >= 1,
    },
    {
      key: 'prolific',
      icon: 'book',
      name: 'Livre de recettes',
      desc: 'Publier 5 recettes',
      ok: stats.recipes >= 5,
    },
    {
      key: 'loved',
      icon: 'heart',
      name: 'Coup de cœur',
      desc: 'Recevoir 10 likes',
      ok: stats.likes_received >= 10,
    },
    {
      key: 'star',
      icon: 'star',
      name: 'Star des fourneaux',
      desc: 'Recevoir 50 likes',
      ok: stats.likes_received >= 50,
    },
    {
      key: 'social',
      icon: 'comment',
      name: 'Bavard gourmand',
      desc: 'Laisser 10 commentaires',
      ok: stats.comments >= 10,
    },
    {
      key: 'popular',
      icon: 'users',
      name: 'Populaire',
      desc: 'Avoir 5 abonnés',
      ok: stats.followers >= 5,
    },
    {
      key: 'challenger',
      icon: 'medal',
      name: 'Challenger',
      desc: 'Participer à un défi',
      ok: stats.challenges >= 1,
    },
    {
      key: 'legend',
      icon: 'crown',
      name: 'Légende',
      desc: 'Atteindre 3000 points',
      ok: stats.points >= 3000,
    },
  ];
  return defs.map((d) => ({ ...d, unlocked: d.ok }));
}

module.exports = { POINTS, LEVELS, REASONS, levelFor, award, awardCapped, badgesFor };
