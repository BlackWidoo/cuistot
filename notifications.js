// services/notifications.js
const db = require('../db');

// Crée une notification (jamais pour soi-même)
function notify(userId, actorId, type, recipeId, text) {
  if (!userId || userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id,actor_id,type,recipe_id,text) VALUES (?,?,?,?,?)')
    .run(userId, actorId || null, type, recipeId || null, text || '');
}

module.exports = { notify };
