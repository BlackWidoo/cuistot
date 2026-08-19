// bootstrap.js — actions exécutées une fois au démarrage : remplissage initial de la base et
// promotion admin. Séparé de server.js pour garder la composition root lisible.
const db = require('./db');

async function runBootstrap() {
  // Auto-remplissage de la base au premier démarrage (utile pour l'hébergement en ligne)
  try {
    const row = await db.get('SELECT COUNT(*) c FROM users');
    if (Number(row.c) === 0) {
      const { seedData } = require('./seed-core');
      const r = await seedData(db);
      console.log(`🌱 Base initialisée : ${r.users} utilisateurs, ${r.recipes} recettes.`);
    }
  } catch (e) {
    console.error('Seed auto ignoré :', e.message);
  }

  // Bootstrap admin : si ADMIN_EMAIL est définie, le compte correspondant devient admin au
  // démarrage (idempotent, sans effet si le compte n'existe pas encore — retentera au prochain
  // redémarrage une fois qu'il existera). Aucun compte externe requis, juste une variable
  // d'environnement choisie par l'exploitant du service.
  if (process.env.ADMIN_EMAIL) {
    try {
      const r = await db.run('UPDATE users SET is_admin=1 WHERE email=$1', [
        process.env.ADMIN_EMAIL.trim().toLowerCase(),
      ]);
      if (r.changes) console.log(`👑 ${process.env.ADMIN_EMAIL} promu administrateur.`);
    } catch (e) {
      console.error('Bootstrap admin ignoré :', e.message);
    }
  }
}

module.exports = runBootstrap;
