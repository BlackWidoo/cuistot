// server.js — point d'entrée. Assemble middlewares globaux et routers, ne contient plus de
// logique métier ni de schémas de validation (Lot 5 — refonte d'architecture) : ce fichier
// faisait ~1000 lignes avant cette refonte ; il est maintenant découpé par responsabilité :
//   config.js       — lecture de l'environnement (une seule fois, une seule source de vérité)
//   middleware/      — auth, CSRF, rate limit, erreurs/validation, en-têtes de sécurité
//   services/        — règles métier partagées entre plusieurs routes (recettes, users, notifs)
//   schemas/         — schémas de validation Zod
//   routes/          — un routeur Express par domaine (auth, recipes, social, moderation...)
//   bootstrap.js     — remplissage initial de la base + promotion admin (une fois au démarrage)
// Pas de couche "repository" séparée au-dessus de db.js : better-sqlite3 est déjà une API
// synchrone simple (prepared statements), et une abstraction supplémentaire n'aurait ajouté
// que du risque de bug (impossible à exécuter/tester ici) sans bénéfice clair.
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { PORT } = require('./config');
const runBootstrap = require('./bootstrap');
const { securityHeaders, permissionsPolicy } = require('./middleware/security');
const { ensureCsrfCookie, csrfProtect } = require('./middleware/csrf');
const staticGuard = require('./middleware/staticGuard');

const app = express();

// Nécessaire pour que req.secure / req.ip reflètent le vrai client derrière le proxy de Render
app.set('trust proxy', 1);

// ---------- En-têtes de sécurité (Lot 4) ----------
app.use(securityHeaders);
app.use(permissionsPolicy);

// CORS : volontairement absent. Le front est servi par ce même serveur (même origine), il
// n'y a donc rien à autoriser depuis un domaine tiers. À ajouter seulement si un jour le
// front est hébergé ailleurs — jamais Access-Control-Allow-Origin: * avec des cookies.

app.use(express.json({ limit: '8mb' })); // marge pour les photos (compressées côté client)
app.use(cookieParser());

// ---------- CSRF (cookie + header, "double submit") ----------
app.use(ensureCsrfCookie);
app.use('/api', csrfProtect);

// ---------- Santé / infra (Lot 0) ----------
app.use(require('./routes/health'));

// ---------- SEO : méta-tags par recette, sitemap, robots.txt (Lot 11) ----------
app.use(require('./routes/seo'));

// Actions à exécuter une fois au démarrage (seed + bootstrap admin)
runBootstrap();

// Ne jamais exposer les fichiers du serveur (structure à plat pour un déploiement mobile facile)
app.use(staticGuard);
app.use(express.static(__dirname));

// ---------- Routes API ----------
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/recipes'));
app.use('/api', require('./routes/social'));
app.use('/api', require('./routes/moderation'));
app.use('/api', require('./routes/rewards'));
app.use('/api', require('./routes/challenges'));
app.use('/api', require('./routes/misc'));

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
