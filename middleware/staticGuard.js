// middleware/staticGuard.js — ne jamais exposer les fichiers du serveur (structure à plat,
// pratique pour un déploiement mobile, mais qui veut dire que le code serveur est dans le
// même dossier que les fichiers publics servis par express.static).
const PRIVATE = new Set(['/server.js', '/db.js', '/seed-core.js', '/gamification.js', '/package.json', '/package-lock.json']);

function staticGuard(req, res, next) {
  // .env* (sauf .env.example, volontairement documentaire) : ne doit jamais être servi même
  // si le fichier existe par accident sur le disque du serveur — le .gitignore l'empêche déjà
  // d'être commité, ceci est une deuxième barrière côté runtime.
  if (/\/\.env($|\.(?!example$))/.test(req.path))
    return res.status(404).send('Not found');
  if (PRIVATE.has(req.path) || /\.(db|db-wal|db-shm|db-journal)$/.test(req.path))
    return res.status(404).send('Not found');
  next();
}

module.exports = staticGuard;
