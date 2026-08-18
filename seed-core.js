// seed-core.js — Logique de remplissage de la base (réutilisable)
// Utilisée au démarrage du serveur si la base est vide (déploiement en ligne).
const bcrypt = require('bcryptjs');

function seedData(db) {
  const hash = (p) => bcrypt.hashSync(p, 10);

  const users = [
    { username: 'chef_camille', email: 'camille@cuistot.fr', avatar: 'pan',   bio: 'Amoureuse de la cuisine du sud, huile d\'olive à volonté' },
    { username: 'leo_gourmand',  email: 'leo@cuistot.fr',     avatar: 'pan',   bio: 'Pâtissier du dimanche, mais tous les jours en vrai' },
    { username: 'nadia_veggie',  email: 'nadia@cuistot.fr',   avatar: 'leaf',  bio: '100% végétarien, 200% de goût' },
    { username: 'tom_bbq',       email: 'tom@cuistot.fr',     avatar: 'flame', bio: 'Roi du barbecue et des plats mijotés' },
    { username: 'demo',          email: 'demo@cuistot.fr',    avatar: 'user',  bio: 'Compte de démonstration — connecte-toi avec demo@cuistot.fr / demo123' },
  ];

  const insUser = db.prepare('INSERT INTO users (username,email,password_hash,avatar,bio,points) VALUES (?,?,?,?,?,?)');
  const uid = {};
  users.forEach((u) => {
    const pwd = u.username === 'demo' ? 'demo123' : 'password';
    const info = insUser.run(u.username, u.email, hash(pwd), u.avatar, u.bio, 0);
    uid[u.username] = info.lastInsertRowid;
  });

  const P = 'https://www.themealdb.com/images/media/meals/';
  const recipes = [
    { author: 'chef_camille', title: 'Ratatouille provençale', category: 'Plat', difficulty: 'Facile', prep: 45, servings: 4, image: 'salad', photo: P + 'wrpwuu1511786491.jpg',
      desc: 'La vraie ratatouille mijotée, comme à Nice. Chaque légume cuit séparément pour garder tout son goût.',
      ingredients: ['2 aubergines', '3 courgettes', '2 poivrons', '4 tomates', '2 oignons', 'Thym & laurier', 'Huile d\'olive'],
      steps: ['Couper tous les légumes en cubes.', 'Faire revenir chaque légume séparément.', 'Réunir dans une cocotte avec les herbes.', 'Laisser mijoter 30 min à feu doux.'],
      tags: ['végétarien', 'provence', 'mijoté'] },
    { author: 'leo_gourmand', title: 'Fondant au chocolat coulant', category: 'Dessert', difficulty: 'Facile', prep: 25, servings: 6, image: 'cake', photo: P + 'twspvx1511784937.jpg',
      desc: 'Le dessert qui fait toujours son effet : croûte fine, cœur coulant.',
      ingredients: ['200g chocolat noir', '150g beurre', '150g sucre', '3 œufs', '50g farine'],
      steps: ['Faire fondre chocolat + beurre.', 'Battre œufs et sucre.', 'Mélanger le tout avec la farine.', 'Cuire 10 min à 200°C — pas plus !'],
      tags: ['chocolat', 'gourmand', 'rapide'] },
    { author: 'nadia_veggie', title: 'Buddha bowl arc-en-ciel', category: 'Healthy', difficulty: 'Facile', prep: 20, servings: 2, image: 'salad', photo: P + '02s6gc1763799560.jpg',
      desc: 'Coloré, nourrissant et prêt en 20 minutes. Le déjeuner parfait.',
      ingredients: ['Quinoa', 'Pois chiches rôtis', 'Avocat', 'Chou rouge', 'Carotte râpée', 'Sauce tahini'],
      steps: ['Cuire le quinoa.', 'Rôtir les pois chiches au four avec épices.', 'Dresser tous les ingrédients dans un bol.', 'Napper de sauce tahini.'],
      tags: ['healthy', 'végétarien', 'bowl'] },
    { author: 'tom_bbq', title: 'Bœuf bourguignon', category: 'Plat', difficulty: 'Moyen', prep: 180, servings: 6, image: 'pot', photo: P + 'vtqxtu1511784197.jpg',
      desc: 'Un classique qui mijote tranquillement. La viande fond en bouche.',
      ingredients: ['1kg bœuf à braiser', '200g lardons', '500ml vin rouge', 'Carottes', 'Champignons', 'Bouquet garni'],
      steps: ['Saisir la viande.', 'Ajouter lardons, légumes et vin.', 'Mijoter 3h à feu très doux.', 'Servir avec des pommes de terre vapeur.'],
      tags: ['mijoté', 'traditionnel', 'hiver'] },
    { author: 'leo_gourmand', title: 'Pancakes moelleux', category: 'Petit-déj', difficulty: 'Facile', prep: 20, servings: 4, image: 'pancake', photo: P + 'rwuyqx1511383174.jpg',
      desc: 'Épais et moelleux à l\'américaine. Sirop d\'érable obligatoire.',
      ingredients: ['250g farine', '2 œufs', '30cl lait', '1 sachet levure', '2 c. sucre'],
      steps: ['Mélanger secs et liquides séparément.', 'Réunir sans trop travailler la pâte.', 'Cuire à la poêle 2 min par face.'],
      tags: ['petit-déj', 'sucré', 'brunch'] },
    { author: 'chef_camille', title: 'Soupe de courge à la châtaigne', category: 'Entrée', difficulty: 'Facile', prep: 40, servings: 4, image: 'pot', photo: P + '1brbso1763585098.jpg',
      desc: 'Veloutée et réconfortante, avec une pointe de crème.',
      ingredients: ['1 courge butternut', '200g châtaignes', '1 oignon', 'Bouillon de légumes', 'Crème fraîche'],
      steps: ['Faire revenir l\'oignon.', 'Ajouter courge, châtaignes et bouillon.', 'Cuire 25 min puis mixer.', 'Ajouter une cuillère de crème.'],
      tags: ['automne', 'végétarien', 'velouté'] },
    { author: 'nadia_veggie', title: 'Curry de lentilles corail', category: 'Végétarien', difficulty: 'Facile', prep: 30, servings: 4, image: 'bowl', photo: P + 'uwxqwy1483389553.jpg',
      desc: 'Onctueux, épicé, plein de protéines végétales.',
      ingredients: ['250g lentilles corail', '400ml lait de coco', 'Curry', 'Gingembre', 'Épinards', 'Tomates concassées'],
      steps: ['Faire revenir gingembre et épices.', 'Ajouter lentilles, tomates et lait de coco.', 'Mijoter 20 min.', 'Incorporer les épinards en fin de cuisson.'],
      tags: ['végétarien', 'épicé', 'healthy'] },
  ];

  const insRecipe = db.prepare(`INSERT INTO recipes
    (author_id,title,description,category,difficulty,prep_minutes,servings,image,photo,ingredients,steps,tags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rid = [];
  recipes.forEach((r) => {
    const info = insRecipe.run(uid[r.author], r.title, r.desc, r.category, r.difficulty,
      r.prep, r.servings, r.image, r.photo || '', JSON.stringify(r.ingredients), JSON.stringify(r.steps), JSON.stringify(r.tags));
    rid.push(info.lastInsertRowid);
  });

  // Likes croisés (déterministes pour éviter Math.random dans certains environnements)
  const insLike = db.prepare('INSERT OR IGNORE INTO likes (user_id,recipe_id) VALUES (?,?)');
  const allU = Object.values(uid);
  rid.forEach((r, i) => {
    for (let k = 0; k <= (i % 3) + 1; k++) insLike.run(allU[(i + k) % allU.length], r);
  });

  // Commentaires
  const insComment = db.prepare('INSERT INTO comments (user_id,recipe_id,body) VALUES (?,?,?)');
  const samples = ['Testé hier soir, un régal !', 'Merci pour la recette, je garde !', 'Ça a l\'air délicieux !', 'Je vais tester ce week-end.', 'Mes enfants ont adoré.'];
  rid.forEach((r, i) => insComment.run(allU[(i + 2) % allU.length], r, samples[i % samples.length]));

  // Follows
  const insFollow = db.prepare('INSERT OR IGNORE INTO follows (follower_id,following_id) VALUES (?,?)');
  [[uid.demo, uid.chef_camille], [uid.demo, uid.leo_gourmand], [uid.leo_gourmand, uid.chef_camille],
   [uid.nadia_veggie, uid.chef_camille], [uid.tom_bbq, uid.leo_gourmand], [uid.chef_camille, uid.nadia_veggie]]
    .forEach(([a, b]) => insFollow.run(a, b));

  // Points de départ
  [[320, uid.chef_camille], [510, uid.leo_gourmand], [180, uid.nadia_veggie], [95, uid.tom_bbq], [140, uid.demo]]
    .forEach(([p, id]) => db.prepare('UPDATE users SET points=? WHERE id=?').run(p, id));

  // Boutique de récompenses
  const insReward = db.prepare('INSERT INTO rewards (title,description,icon,cost,stock) VALUES (?,?,?,?,?)');
  [
    ['Badge « Gourmet » exclusif', 'Un badge doré affiché sur ton profil.', 'medal', 100, -1],
    ['Sticker pack Cuistot', 'Pack de stickers cuisine à imprimer.', 'palette', 150, -1],
    ['Fiche recette premium', 'Débloque une recette de chef étoilé.', 'scroll', 250, -1],
    ['Tablier Cuistot brodé', 'Le vrai tablier de la communauté (édition limitée).', 'pan', 800, 20],
    ['Livre de recettes PDF', 'Le best-of de la communauté en PDF.', 'book', 400, -1],
    ['Mise en avant 1 semaine', 'Ta recette en tête du fil pendant 7 jours.', 'rocket', 600, 10],
    ['Bon d\'achat 10€ épicerie', 'À valoir chez nos partenaires.', 'cart', 1200, 5],
  ].forEach((r) => insReward.run(...r));

  // Défis
  const insCh = db.prepare('INSERT INTO challenges (title,description,icon,reward_pts,tag,ends_at) VALUES (?,?,?,?,?,?)');
  const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  [
    ['Semaine végétarienne', 'Publie une recette 100% végétarienne cette semaine.', 'leaf', 60, 'végétarien', inDays(7)],
    ['Défi chocolat', 'Une recette qui contient du chocolat, et on est preneurs.', 'chocolate', 50, 'chocolat', inDays(10)],
    ['Cuisine d\'automne', 'Mets à l\'honneur les saveurs de saison.', 'leaf', 70, 'automne', inDays(14)],
    ['Plat réconfortant', 'Un bon petit plat mijoté pour se réchauffer.', 'pot', 55, 'mijoté', inDays(12)],
  ].forEach((c) => insCh.run(...c));

  return { users: users.length, recipes: recipes.length };
}

module.exports = { seedData };
