// middleware/rateLimit.js — anti-abus
// Limiteur maison (pas de dépendance externe) : n tentatives max par fenêtre glissante.
// Par défaut la clé est l'IP ; keyFn permet de limiter par utilisateur authentifié à la place
// (plus juste que l'IP pour des actions déjà protégées par auth(), évite de punir tout un
// réseau partagé pour l'abus d'un seul compte).
// Limite du modèle : en mémoire process, donc par instance. Reste suffisant pour une seule
// instance (cas actuel) ; à déplacer vers Redis/Upstash avant toute mise à l'échelle
// horizontale (plusieurs instances derrière un load balancer) — voir REDIS_URL dans .env.example.
const { apiError } = require('./errors');

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
      return apiError(
        res,
        429,
        message || 'Trop de tentatives, réessaie plus tard.',
        'RATE_LIMITED'
      );
    // Nettoyage paresseux pour ne pas laisser grossir la Map indéfiniment
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    next();
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Trop de tentatives de connexion. Réessaie dans 15 minutes.',
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  // Le limiteur est par IP (pas d'utilisateur authentifié à cette étape) : la suite de tests
  // d'intégration crée des dizaines de comptes depuis la même IP locale dans un seul run.
  // Limite réelle inchangée en production, relevée seulement en environnement de test.
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  message: 'Trop de comptes créés depuis cette adresse. Réessaie plus tard.',
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: 'Trop de demandes. Réessaie dans 15 minutes.',
});
const recipeCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Trop de recettes publiées récemment. Réessaie plus tard.',
  keyFn: (req) => `recipe:${req.user?.id}`,
});
const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Trop de commentaires récemment. Réessaie plus tard.',
  keyFn: (req) => `comment:${req.user?.id}`,
});
const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Doucement sur les likes !',
  keyFn: (req) => `like:${req.user?.id}`,
});
// Note : le farming like/unlike est déjà neutralisé (les points sont retirés au unlike), et un
// like sur sa propre recette ne rapporte ni points ni notification (voir la route /like).
// La détection de réseaux d'échange de likes (A like B qui like A en boucle) demanderait une
// analyse du graphe d'interactions — hors scope de ce lot, à traiter avec de vraies données
// d'usage plutôt qu'à l'aveugle.

module.exports = {
  rateLimit,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  recipeCreateLimiter,
  commentLimiter,
  likeLimiter,
};
