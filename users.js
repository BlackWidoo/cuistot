// services/users.js
const db = require('../db');
const { levelFor, badgesFor } = require('../gamification');

// Icônes proposées comme avatar de profil : les unes sont libres, les autres se débloquent
// en obtenant le badge correspondant (voir gamification.js pour le détail des conditions).
const AVATAR_ICONS_FREE = new Set(['pan', 'leaf', 'flame', 'user', 'coffee', 'sun', 'moon', 'fish', 'bolt', 'heart']);
const AVATAR_UNLOCKS = { star: 'star', users: 'popular', medal: 'challenger', crown: 'legend', book: 'prolific' };
const AVATAR_ICONS = new Set([...AVATAR_ICONS_FREE, ...Object.keys(AVATAR_UNLOCKS)]);
const AVATAR_COLORS = new Set(['cream', 'terracotta', 'gold', 'olive', 'berry', 'teal']);

// Valide le choix d'avatar d'un utilisateur : clé connue, et débloquée s'il s'agit d'une icône à mérite
function sanitizeAvatar(v, userId) {
  if (!AVATAR_ICONS.has(v)) return 'user';
  const requiredBadge = AVATAR_UNLOCKS[v];
  if (requiredBadge && !badgesFor(userId).some((b) => b.key === requiredBadge && b.unlocked)) return null;
  return v;
}
function sanitizeAvatarColor(v) { return AVATAR_COLORS.has(v) ? v : 'cream'; }

function publicUser(u) {
  if (!u) return null;
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(u.id).c;
  const following = db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id=?').get(u.id).c;
  const recipes = db.prepare('SELECT COUNT(*) c FROM recipes WHERE author_id=?').get(u.id).c;
  return {
    id: u.id, username: u.username, bio: u.bio, avatar: u.avatar, avatar_color: u.avatar_color,
    points: u.points, level: levelFor(u.points),
    followers, following, recipes,
    is_admin: !!u.is_admin,
  };
}

module.exports = {
  publicUser, sanitizeAvatar, sanitizeAvatarColor,
  AVATAR_ICONS_FREE, AVATAR_UNLOCKS, AVATAR_COLORS,
};
