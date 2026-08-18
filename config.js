// config.js — configuration centrale lue depuis l'environnement, une seule fois au démarrage.
// Isolé du reste pour que tous les modules (middleware, routes) lisent la même source de
// vérité au lieu de relire process.env chacun de leur côté.
require('dotenv').config(); // charge .env en local ; sans effet si le fichier n'existe pas (ex: sur Render)

const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// En production le secret DOIT venir de l'environnement (Render le génère automatiquement,
// voir render.yaml). On refuse de démarrer plutôt que de tourner avec un secret connu de tous.
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant en production. Configure la variable d\'environnement avant de démarrer.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || 'cuistot-dev-secret-change-me';

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 864e5 };

module.exports = { IS_PROD, PORT, JWT_SECRET, COOKIE_OPTS };
