// middleware/security.js — en-têtes de sécurité (Lot 4)
// CSP volontairement restrictive : pas de script inline (les quelques onclick="" du HTML
// généré ont été remplacés par de vrais écouteurs d'événements pour que ça tienne), mais
// 'unsafe-inline' est gardé pour les styles car l'app utilise beaucoup d'attributs
// style="" — les basculer en classes CSS est un chantier séparé (design system), et une CSP
// sans script inline reste la protection qui compte vraiment contre le XSS.
const helmet = require('helmet');
const { IS_PROD } = require('../config');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // themealdb.com / upload.wikimedia.org : photos des recettes de démo (seed-core.js). À
      // retirer si le Lot 2 (upload médias externe) remplace ces URLs de démonstration.
      // blob: : nécessaire à l'aperçu/compression client d'une photo avant envoi (resizeImage
      // dans app.js charge le fichier choisi via URL.createObjectURL avant de le redimensionner
      // sur un <canvas>) — sans ça, le navigateur bloque le chargement et l'ajout de photo
      // échoue silencieusement avec « Impossible de lire cette image ».
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://www.themealdb.com',
        'https://upload.wikimedia.org',
      ],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(IS_PROD ? {} : { upgradeInsecureRequests: null }), // pas de https forcé en dev local
    },
  },
});

// Helmet ne pose pas Permissions-Policy par défaut : l'app n'utilise aucune de ces API,
// autant le dire explicitement au navigateur.
function permissionsPolicy(req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=()'
  );
  next();
}

module.exports = { securityHeaders, permissionsPolicy };
