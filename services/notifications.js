// services/notifications.js
const db = require('../db');

// Crée une notification (jamais pour soi-même)
async function notify(userId, actorId, type, recipeId, text) {
  if (!userId || userId === actorId) return;
  await db.run(
    'INSERT INTO notifications (user_id,actor_id,type,recipe_id,text) VALUES ($1,$2,$3,$4,$5)',
    [userId, actorId || null, type, recipeId || null, text || '']
  );
}

module.exports = { notify };
