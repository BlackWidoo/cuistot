// services/users.js
const db = require('../db');
const { levelFor, badgesFor } = require('../gamification');

// Icônes proposées comme avatar de profil : les unes sont libres, les autres se débloquent
// en obtenant le badge correspondant (voir gamification.js pour le détail des conditions).
const AVATAR_ICONS_FREE = new Set([
  'pan',
  'leaf',
  'flame',
  'user',
  'coffee',
  'sun',
  'moon',
  'fish',
  'bolt',
  'heart',
]);
const AVATAR_UNLOCKS = {
  star: 'star',
  users: 'popular',
  medal: 'challenger',
  crown: 'legend',
  book: 'prolific',
};
const AVATAR_ICONS = new Set([...AVATAR_ICONS_FREE, ...Object.keys(AVATAR_UNLOCKS)]);
const AVATAR_COLORS = new Set(['cream', 'terracotta', 'gold', 'olive', 'berry', 'teal']);

// Valide le choix d'avatar d'un utilisateur : clé connue, et débloquée s'il s'agit d'une icône à mérite
async function sanitizeAvatar(v, userId) {
  if (!AVATAR_ICONS.has(v)) return 'user';
  const requiredBadge = AVATAR_UNLOCKS[v];
  if (
    requiredBadge &&
    !(await badgesFor(userId)).some((b) => b.key === requiredBadge && b.unlocked)
  )
    return null;
  return v;
}
function sanitizeAvatarColor(v) {
  return AVATAR_COLORS.has(v) ? v : 'cream';
}

async function publicUser(u) {
  if (!u) return null;
  const followers = await db.get('SELECT COUNT(*) c FROM follows WHERE following_id=$1', [u.id]);
  const following = await db.get('SELECT COUNT(*) c FROM follows WHERE follower_id=$1', [u.id]);
  const recipes = await db.get('SELECT COUNT(*) c FROM recipes WHERE author_id=$1', [u.id]);
  return {
    id: u.id,
    username: u.username,
    bio: u.bio,
    avatar: u.avatar,
    avatar_color: u.avatar_color,
    points: u.points,
    level: levelFor(u.points),
    followers: Number(followers.c),
    following: Number(following.c),
    recipes: Number(recipes.c),
    is_admin: !!u.is_admin,
  };
}

module.exports = {
  publicUser,
  sanitizeAvatar,
  sanitizeAvatarColor,
  AVATAR_ICONS_FREE,
  AVATAR_UNLOCKS,
  AVATAR_COLORS,
};
