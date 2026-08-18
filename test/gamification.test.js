// Tests unitaires purs (pas de serveur, pas de DB réelle) pour les règles de niveaux.
process.env.DB_PATH = ':memory:'; // gamification.js importe db.js, qui ouvre une connexion au chargement

const test = require('node:test');
const assert = require('node:assert/strict');
const { levelFor, LEVELS, awardCapped, REASONS } = require('../gamification');
const db = require('../db');

test('un nouvel utilisateur (0 point) est niveau 1 Marmiton', () => {
  const lvl = levelFor(0);
  assert.equal(lvl.level, 1);
  assert.equal(lvl.name, 'Marmiton');
  assert.equal(lvl.progress, 0);
  assert.equal(lvl.next.name, 'Commis');
});

test('la progression est calculée entre le palier courant et le suivant', () => {
  // Commis commence à 100, Cuisinier à 300 : à 150 pts on est à 25% du palier
  const lvl = levelFor(150);
  assert.equal(lvl.level, 2);
  assert.equal(lvl.next.level, 3);
  assert.equal(lvl.progress, 25);
});

test('au niveau maximum, progress vaut 100 et il n\'y a plus de palier suivant', () => {
  const top = LEVELS[LEVELS.length - 1];
  const lvl = levelFor(top.min + 5000);
  assert.equal(lvl.level, top.level);
  assert.equal(lvl.next, null);
  assert.equal(lvl.progress, 100);
});

test('awardCapped plafonne les gains quotidiens pour une raison donnée (anti-farming, Lot 9)', () => {
  const info = db.prepare('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)')
    .run('capuser', 'cap@test.fr', 'hash');
  const userId = info.lastInsertRowid;

  // Plafond RECEIVE_LIKE = 100 pts ; 20 appels à 5 pts chacun doivent être intégralement accordés
  for (let i = 0; i < 20; i++) awardCapped(userId, 5, REASONS.RECEIVE_LIKE);
  assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(userId).points, 100);

  // Le 21e appel ne doit plus rien ajouter : le plafond du jour est atteint
  awardCapped(userId, 5, REASONS.RECEIVE_LIKE);
  assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(userId).points, 100);
});
