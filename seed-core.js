// seed-core.js — Logique de remplissage de la base (réutilisable)
// Utilisée au démarrage du serveur si la base est vide (déploiement en ligne).
const bcrypt = require('bcryptjs');

async function seedData(db) {
  const hash = (p) => bcrypt.hashSync(p, 10);

  const users = [
    {
      username: 'chef_camille',
      email: 'camille@cuistot.fr',
      avatar: 'pan',
      bio: "Amoureuse de la cuisine du sud, huile d'olive à volonté",
    },
    {
      username: 'leo_gourmand',
      email: 'leo@cuistot.fr',
      avatar: 'pan',
      bio: 'Pâtissier du dimanche, mais tous les jours en vrai',
    },
    {
      username: 'nadia_veggie',
      email: 'nadia@cuistot.fr',
      avatar: 'leaf',
      bio: '100% végétarien, 200% de goût',
    },
    {
      username: 'tom_bbq',
      email: 'tom@cuistot.fr',
      avatar: 'flame',
      bio: 'Roi du barbecue et des plats mijotés',
    },
    {
      username: 'julien_pain',
      email: 'julien@cuistot.fr',
      avatar: 'coffee',
      bio: 'Boulanger amateur, obsédé par le levain maison',
    },
    {
      username: 'sofia_tapas',
      email: 'sofia@cuistot.fr',
      avatar: 'sun',
      bio: 'Cuisine espagnole, tapas et paella les dimanches en famille',
    },
    {
      username: 'marc_sushi',
      email: 'marc@cuistot.fr',
      avatar: 'fish',
      bio: 'Cuisine japonaise maison, du sushi au ramen',
    },
    {
      username: 'lea_patisserie',
      email: 'lea@cuistot.fr',
      avatar: 'heart',
      bio: 'Pâtissière précise, entremets et tartes soignées',
    },
    {
      username: 'karim_epices',
      email: 'karim@cuistot.fr',
      avatar: 'bolt',
      bio: 'Cuisine du Maghreb, épices et tajines mijotés',
    },
    {
      username: 'clara_vegan',
      email: 'clara@cuistot.fr',
      avatar: 'leaf',
      bio: "100% vegan, des alternatives qui n'ont rien à envier à l'original",
    },
    {
      username: 'demo',
      email: 'demo@cuistot.fr',
      avatar: 'user',
      bio: 'Compte de démonstration — connecte-toi avec demo@cuistot.fr / demo123',
    },
  ];

  const uid = {};
  for (const u of users) {
    const pwd = u.username === 'demo' ? 'demo123' : 'password';
    const { rows } = await db.run(
      'INSERT INTO users (username,email,password_hash,avatar,bio,points) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [u.username, u.email, hash(pwd), u.avatar, u.bio, 0]
    );
    uid[u.username] = rows[0].id;
  }

  // Photos : TheMealDB pour les recettes historiques, Wikimedia Commons (via l'API REST
  // Wikipedia, chaque URL vérifiée) pour les nouvelles — les deux domaines sont autorisés dans
  // la CSP img-src (middleware/security.js). "Curry vegan de courge" n'a pas de photo assignée :
  // aucune image libre de droit trouvée qui corresponde (viande sur les résultats "curry"
  // génériques, inapproprié pour une recette végane) — reste sur l'illustration SVG + le
  // dégradé de catégorie, le rendu par défaut pour toute recette sans photo.
  const P = 'https://www.themealdb.com/images/media/meals/';
  const recipes = [
    {
      author: 'chef_camille',
      title: 'Ratatouille provençale',
      category: 'Plat',
      difficulty: 'Facile',
      prep: 45,
      servings: 4,
      image: 'salad',
      photo: P + 'wrpwuu1511786491.jpg',
      desc: 'La vraie ratatouille mijotée, comme à Nice. Chaque légume cuit séparément pour garder tout son goût.',
      ingredients: [
        '2 aubergines',
        '3 courgettes',
        '2 poivrons',
        '4 tomates',
        '2 oignons',
        'Thym & laurier',
        "Huile d'olive",
      ],
      steps: [
        'Couper tous les légumes en cubes.',
        'Faire revenir chaque légume séparément.',
        'Réunir dans une cocotte avec les herbes.',
        'Laisser mijoter 30 min à feu doux.',
      ],
      tags: ['végétarien', 'provence', 'mijoté'],
    },
    {
      author: 'leo_gourmand',
      title: 'Fondant au chocolat coulant',
      category: 'Dessert',
      difficulty: 'Facile',
      prep: 25,
      servings: 6,
      image: 'cake',
      photo: P + 'twspvx1511784937.jpg',
      desc: 'Le dessert qui fait toujours son effet : croûte fine, cœur coulant.',
      ingredients: ['200g chocolat noir', '150g beurre', '150g sucre', '3 œufs', '50g farine'],
      steps: [
        'Faire fondre chocolat + beurre.',
        'Battre œufs et sucre.',
        'Mélanger le tout avec la farine.',
        'Cuire 10 min à 200°C — pas plus !',
      ],
      tags: ['chocolat', 'gourmand', 'rapide'],
    },
    {
      author: 'nadia_veggie',
      title: 'Buddha bowl arc-en-ciel',
      category: 'Healthy',
      difficulty: 'Facile',
      prep: 20,
      servings: 2,
      image: 'salad',
      photo: P + '02s6gc1763799560.jpg',
      desc: 'Coloré, nourrissant et prêt en 20 minutes. Le déjeuner parfait.',
      ingredients: [
        'Quinoa',
        'Pois chiches rôtis',
        'Avocat',
        'Chou rouge',
        'Carotte râpée',
        'Sauce tahini',
      ],
      steps: [
        'Cuire le quinoa.',
        'Rôtir les pois chiches au four avec épices.',
        'Dresser tous les ingrédients dans un bol.',
        'Napper de sauce tahini.',
      ],
      tags: ['healthy', 'végétarien', 'bowl'],
    },
    {
      author: 'tom_bbq',
      title: 'Bœuf bourguignon',
      category: 'Plat',
      difficulty: 'Moyen',
      prep: 180,
      servings: 6,
      image: 'pot',
      photo: P + 'vtqxtu1511784197.jpg',
      desc: 'Un classique qui mijote tranquillement. La viande fond en bouche.',
      ingredients: [
        '1kg bœuf à braiser',
        '200g lardons',
        '500ml vin rouge',
        'Carottes',
        'Champignons',
        'Bouquet garni',
      ],
      steps: [
        'Saisir la viande.',
        'Ajouter lardons, légumes et vin.',
        'Mijoter 3h à feu très doux.',
        'Servir avec des pommes de terre vapeur.',
      ],
      tags: ['mijoté', 'traditionnel', 'hiver'],
    },
    {
      author: 'leo_gourmand',
      title: 'Pancakes moelleux',
      category: 'Petit-déj',
      difficulty: 'Facile',
      prep: 20,
      servings: 4,
      image: 'pancake',
      photo: P + 'rwuyqx1511383174.jpg',
      desc: "Épais et moelleux à l'américaine. Sirop d'érable obligatoire.",
      ingredients: ['250g farine', '2 œufs', '30cl lait', '1 sachet levure', '2 c. sucre'],
      steps: [
        'Mélanger secs et liquides séparément.',
        'Réunir sans trop travailler la pâte.',
        'Cuire à la poêle 2 min par face.',
      ],
      tags: ['petit-déj', 'sucré', 'brunch'],
    },
    {
      author: 'chef_camille',
      title: 'Soupe de courge à la châtaigne',
      category: 'Entrée',
      difficulty: 'Facile',
      prep: 40,
      servings: 4,
      image: 'pot',
      photo: P + '1brbso1763585098.jpg',
      desc: 'Veloutée et réconfortante, avec une pointe de crème.',
      ingredients: [
        '1 courge butternut',
        '200g châtaignes',
        '1 oignon',
        'Bouillon de légumes',
        'Crème fraîche',
      ],
      steps: [
        "Faire revenir l'oignon.",
        'Ajouter courge, châtaignes et bouillon.',
        'Cuire 25 min puis mixer.',
        'Ajouter une cuillère de crème.',
      ],
      tags: ['automne', 'végétarien', 'velouté'],
    },
    {
      author: 'nadia_veggie',
      title: 'Curry de lentilles corail',
      category: 'Végétarien',
      difficulty: 'Facile',
      prep: 30,
      servings: 4,
      image: 'bowl',
      photo: P + 'uwxqwy1483389553.jpg',
      desc: 'Onctueux, épicé, plein de protéines végétales.',
      ingredients: [
        '250g lentilles corail',
        '400ml lait de coco',
        'Curry',
        'Gingembre',
        'Épinards',
        'Tomates concassées',
      ],
      steps: [
        'Faire revenir gingembre et épices.',
        'Ajouter lentilles, tomates et lait de coco.',
        'Mijoter 20 min.',
        'Incorporer les épinards en fin de cuisson.',
      ],
      tags: ['végétarien', 'épicé', 'healthy'],
    },
    // ---- Nouvelles recettes (ingrédients structurés {qty,unit,label}) ----
    {
      author: 'karim_epices',
      title: "Tajine d'agneau aux abricots",
      category: 'Plat',
      difficulty: 'Moyen',
      prep: 150,
      servings: 6,
      image: 'pot',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Tajine-marocain-un-plat-varie-et-sain_%28cropped%29.jpg/330px-Tajine-marocain-un-plat-varie-et-sain_%28cropped%29.jpg',
      desc: 'Sucré-salé, épicé en douceur : le tajine du dimanche qui parfume toute la maison.',
      ingredients: [
        { qty: 800, unit: 'g', label: "épaule d'agneau" },
        { qty: 200, unit: 'g', label: 'abricots secs' },
        { qty: 2, unit: '', label: 'oignons' },
        { qty: 2, unit: 'c. à café', label: 'ras el hanout' },
        { qty: 1, unit: '', label: 'bâton de cannelle' },
        { qty: 30, unit: 'g', label: 'amandes effilées' },
      ],
      steps: [
        'Faire dorer la viande avec les oignons.',
        "Ajouter les épices et couvrir d'eau à hauteur.",
        'Mijoter 2h à feu doux, ajouter les abricots 30 min avant la fin.',
        "Parsemer d'amandes effilées avant de servir.",
      ],
      tags: ['tajine', 'mijoté', 'épicé'],
      cost_cents: 450,
      storage_instructions: '3 jours au frigo dans un plat couvert.',
      reheat_instructions: "10 min à la cocotte à feu doux, avec un peu d'eau.",
    },
    {
      author: 'julien_pain',
      title: 'Pain au levain maison',
      category: 'Autre',
      difficulty: 'Difficile',
      prep: 90,
      servings: 8,
      image: 'croissant',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Home_made_sour_dough_bread.jpg/330px-Home_made_sour_dough_bread.jpg',
      desc: 'Croûte craquante, mie alvéolée : le vrai pain, celui qui demande un peu de patience.',
      ingredients: [
        { qty: 500, unit: 'g', label: 'farine de blé T65' },
        { qty: 150, unit: 'g', label: 'levain actif' },
        { qty: 350, unit: 'ml', label: 'eau tiède' },
        { qty: 10, unit: 'g', label: 'sel' },
      ],
      steps: [
        'Mélanger farine, eau et levain, laisser reposer 30 min (autolyse).',
        'Ajouter le sel, pétrir puis laisser pousser 4h avec des rabats réguliers.',
        'Façonner et laisser pousser au frais toute une nuit.',
        'Cuire 40 min à 240°C avec de la vapeur au début.',
      ],
      tags: ['pain', 'levain', 'boulange'],
      storage_instructions: '3-4 jours dans un torchon propre, à température ambiante.',
    },
    {
      author: 'sofia_tapas',
      title: 'Paella valenciana',
      category: 'Plat',
      difficulty: 'Moyen',
      prep: 60,
      servings: 6,
      image: 'pan',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/01_Paella_Valenciana_original.jpg/330px-01_Paella_Valenciana_original.jpg',
      desc: 'La vraie paella, celle qui se partage au centre de la table, à même le plat.',
      ingredients: [
        { qty: 400, unit: 'g', label: 'riz rond' },
        { qty: 500, unit: 'g', label: 'poulet en morceaux' },
        { qty: 200, unit: 'g', label: 'haricots verts' },
        { qty: 1, unit: 'pincée', label: 'safran' },
        { qty: 1.2, unit: 'L', label: 'bouillon de volaille' },
        { qty: 2, unit: '', label: 'tomates râpées' },
      ],
      steps: [
        'Faire dorer le poulet dans la paellera.',
        'Ajouter les légumes puis le riz, bien enrober.',
        'Verser le bouillon safrané, ne plus remuer.',
        'Cuire 20 min à feu moyen puis laisser reposer 5 min.',
      ],
      tags: ['espagne', 'riz', 'convivial'],
    },
    {
      author: 'sofia_tapas',
      title: 'Patatas bravas maison',
      category: 'Entrée',
      difficulty: 'Facile',
      prep: 35,
      servings: 4,
      image: 'bowl',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Patatas_bravas_madrid.jpg/330px-Patatas_bravas_madrid.jpg',
      desc: "Pommes de terre croustillantes, sauce piquante généreuse. L'apéro qui ne fait pas semblant.",
      ingredients: [
        { qty: 800, unit: 'g', label: 'pommes de terre' },
        { qty: 2, unit: 'c. à soupe', label: 'concentré de tomate' },
        { qty: 1, unit: 'c. à café', label: 'paprika fumé' },
        { qty: 1, unit: 'pincée', label: 'piment de Cayenne' },
        { qty: 3, unit: 'c. à soupe', label: "huile d'olive" },
      ],
      steps: [
        'Couper les pommes de terre en cubes, cuire au four bien croustillantes.',
        'Préparer la sauce : tomate, paprika, piment, huile.',
        'Napper les pommes de terre chaudes de sauce.',
        'Servir immédiatement avec des piques.',
      ],
      tags: ['espagne', 'apéro', 'végétarien'],
    },
    {
      author: 'marc_sushi',
      title: 'Maki avocat concombre',
      category: 'Entrée',
      difficulty: 'Moyen',
      prep: 40,
      servings: 4,
      image: 'bowl',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Sushi_platter.jpg/330px-Sushi_platter.jpg',
      desc: 'Frais, croquant, parfait pour se lancer dans les makis faits maison.',
      ingredients: [
        { qty: 300, unit: 'g', label: 'riz à sushi' },
        { qty: 2, unit: '', label: 'feuilles de nori' },
        { qty: 1, unit: '', label: 'avocat' },
        { qty: 0.5, unit: '', label: 'concombre' },
        { qty: 3, unit: 'c. à soupe', label: 'vinaigre de riz' },
      ],
      steps: [
        "Cuire le riz puis l'assaisonner au vinaigre de riz.",
        'Étaler le riz sur la feuille de nori.',
        'Disposer avocat et concombre en bâtonnets, rouler serré.',
        'Couper en 8 avec un couteau humide.',
      ],
      tags: ['japon', 'frais', 'apéro'],
    },
    {
      author: 'marc_sushi',
      title: 'Ramen miso maison',
      category: 'Plat',
      difficulty: 'Difficile',
      prep: 120,
      servings: 2,
      image: 'bowl',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Shoyu_Ramen%EF%BC%88Tokyo_Ramen%EF%BC%89_-_01.jpg/330px-Shoyu_Ramen%EF%BC%88Tokyo_Ramen%EF%BC%89_-_01.jpg',
      desc: 'Bouillon riche et parfumé, œuf mollet, le réconfort version japonaise.',
      ingredients: [
        { qty: 1.5, unit: 'L', label: 'bouillon de volaille' },
        { qty: 3, unit: 'c. à soupe', label: 'pâte miso' },
        { qty: 200, unit: 'g', label: 'nouilles ramen' },
        { qty: 2, unit: '', label: 'œufs' },
        { qty: 100, unit: 'g', label: 'pousses de soja' },
        { qty: 1, unit: '', label: 'oignon nouveau' },
      ],
      steps: [
        'Faire mijoter le bouillon avec le miso 45 min.',
        'Cuire les œufs 6 min30, écaler et couper en deux.',
        'Cuire les nouilles séparément.',
        'Dresser : nouilles, bouillon chaud, garnitures et demi-œuf.',
      ],
      tags: ['japon', 'mijoté', 'réconfortant'],
      calories: 480,
      protein_g: 24,
      carbs_g: 58,
      fat_g: 14,
    },
    {
      author: 'lea_patisserie',
      title: 'Entremets framboise-pistache',
      category: 'Dessert',
      difficulty: 'Difficile',
      prep: 90,
      servings: 8,
      image: 'cake',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Entremets_simples.jpg/330px-Entremets_simples.jpg',
      desc: 'Biscuit moelleux, crémeux pistache, insert framboise : la pâtisserie du dimanche qui impressionne.',
      ingredients: [
        { qty: 250, unit: 'g', label: 'framboises' },
        { qty: 100, unit: 'g', label: 'pâte de pistache' },
        { qty: 300, unit: 'g', label: 'crème liquide entière' },
        { qty: 3, unit: '', label: 'œufs' },
        { qty: 120, unit: 'g', label: 'sucre' },
        { qty: 6, unit: 'g', label: 'gélatine' },
      ],
      steps: [
        "Préparer l'insert framboise et le passer au congélateur.",
        'Cuire le biscuit moelleux.',
        'Monter la crème pistache avec la gélatine fondue.',
        'Assembler en cercle : biscuit, insert, crème pistache, réserver au froid 4h minimum.',
      ],
      tags: ['pâtisserie', 'gourmand', 'fête'],
    },
    {
      author: 'lea_patisserie',
      title: 'Tarte au citron meringuée',
      category: 'Dessert',
      difficulty: 'Moyen',
      prep: 70,
      servings: 8,
      image: 'cake',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Theres_always_room_for_pie_%287859650026%29.jpg/330px-Theres_always_room_for_pie_%287859650026%29.jpg',
      desc: 'Acidulée sous une meringue légère et dorée : un classique qui ne déçoit jamais.',
      ingredients: [
        { qty: 1, unit: '', label: 'pâte sablée' },
        { qty: 4, unit: '', label: 'citrons' },
        { qty: 4, unit: '', label: 'œufs' },
        { qty: 150, unit: 'g', label: 'sucre' },
        { qty: 80, unit: 'g', label: 'beurre' },
      ],
      steps: [
        'Cuire la pâte à blanc.',
        'Préparer la crème au citron et la faire épaissir sur feu doux.',
        'Garnir la pâte refroidie.',
        'Pocher la meringue et dorer au chalumeau ou sous le grill.',
      ],
      tags: ['pâtisserie', 'citron', 'classique'],
    },
    {
      author: 'clara_vegan',
      title: 'Curry vegan de courge',
      category: 'Végétarien',
      difficulty: 'Facile',
      prep: 35,
      servings: 4,
      image: 'bowl',
      desc: 'Doux, réconfortant, 100% végétal — même les plus carnivores en redemandent.',
      ingredients: [
        { qty: 600, unit: 'g', label: 'courge butternut' },
        { qty: 400, unit: 'ml', label: 'lait de coco' },
        { qty: 2, unit: 'c. à soupe', label: 'pâte de curry' },
        { qty: 1, unit: '', label: 'oignon' },
        { qty: 200, unit: 'g', label: 'pois chiches cuits' },
      ],
      steps: [
        "Faire revenir l'oignon et la pâte de curry.",
        'Ajouter la courge en cubes et le lait de coco.',
        "Mijoter 20 min jusqu'à ce que la courge soit fondante.",
        'Ajouter les pois chiches en fin de cuisson.',
      ],
      tags: ['végétarien', 'automne', 'vegan'],
      calories: 320,
      protein_g: 9,
      carbs_g: 34,
      fat_g: 17,
      fiber_g: 8,
    },
    {
      author: 'clara_vegan',
      title: 'Burger vegan aux haricots noirs',
      category: 'Plat',
      difficulty: 'Facile',
      prep: 35,
      servings: 4,
      image: 'burger',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/%D7%94%D7%9E%D7%91%D7%95%D7%A8%D7%92%D7%A8_%D7%98%D7%91%D7%A2%D7%95%D7%A0%D7%99.jpg/330px-%D7%94%D7%9E%D7%91%D7%95%D7%A8%D7%92%D7%A8_%D7%98%D7%91%D7%A2%D7%95%D7%A0%D7%99.jpg',
      desc: "Un steak végétal qui tient vraiment en bouche, entre le fumé et l'épicé.",
      ingredients: [
        { qty: 400, unit: 'g', label: 'haricots noirs cuits' },
        { qty: 80, unit: 'g', label: 'chapelure' },
        { qty: 1, unit: 'c. à café', label: 'cumin' },
        { qty: 1, unit: 'c. à café', label: 'paprika fumé' },
        { qty: 4, unit: '', label: 'pains à burger' },
        { qty: 1, unit: '', label: 'avocat' },
      ],
      steps: [
        'Écraser les haricots noirs avec les épices.',
        'Ajouter la chapelure, former des steaks.',
        'Cuire à la poêle 4 min par face.',
        "Garnir le pain avec le steak, l'avocat et les crudités.",
      ],
      tags: ['végétarien', 'vegan', 'burger'],
      cost_cents: 280,
    },
    {
      author: 'nadia_veggie',
      title: 'Smoothie bowl mangue-passion',
      category: 'Petit-déj',
      difficulty: 'Facile',
      prep: 10,
      servings: 1,
      image: 'drink',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Kiwi_Smoothie.jpg/330px-Kiwi_Smoothie.jpg',
      desc: 'Frais et vitaminé, prêt en 10 minutes pour bien commencer la journée.',
      ingredients: [
        { qty: 1, unit: '', label: 'mangue congelée' },
        { qty: 1, unit: '', label: 'banane' },
        { qty: 100, unit: 'ml', label: 'lait végétal' },
        { qty: 1, unit: '', label: 'fruit de la passion' },
        { qty: 2, unit: 'c. à soupe', label: 'granola' },
      ],
      steps: [
        "Mixer mangue, banane et lait végétal jusqu'à consistance épaisse.",
        'Verser dans un bol.',
        'Garnir de fruit de la passion et de granola.',
      ],
      tags: ['healthy', 'petit-déj', 'végétarien'],
      calories: 310,
      protein_g: 6,
      carbs_g: 62,
      fat_g: 4,
      fiber_g: 7,
    },
    {
      author: 'karim_epices',
      title: 'Houmous maison et légumes croquants',
      category: 'Entrée',
      difficulty: 'Facile',
      prep: 15,
      servings: 4,
      image: 'bowl',
      photo:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Lebanese_style_hummus.jpg/330px-Lebanese_style_hummus.jpg',
      desc: 'Onctueux et parfumé au tahini, prêt en 15 minutes sans cuisson.',
      ingredients: [
        { qty: 400, unit: 'g', label: 'pois chiches cuits' },
        { qty: 2, unit: 'c. à soupe', label: 'tahini' },
        { qty: 1, unit: '', label: 'citron' },
        { qty: 1, unit: 'gousse', label: 'ail' },
        { qty: 3, unit: 'c. à soupe', label: "huile d'olive" },
      ],
      steps: [
        'Mixer pois chiches, tahini, jus de citron et ail.',
        "Ajouter l'huile d'olive petit à petit pour lisser.",
        "Rectifier l'assaisonnement.",
        'Servir avec des bâtonnets de légumes crus.',
      ],
      tags: ['végétarien', 'apéro', 'sans cuisson'],
      cost_cents: 180,
    },
  ];

  const rid = [];
  for (const r of recipes) {
    const { rows } = await db.run(
      `INSERT INTO recipes
      (author_id,title,description,category,difficulty,prep_minutes,servings,image,photo,ingredients,steps,tags,
       calories,protein_g,carbs_g,fat_g,fiber_g,cost_cents,storage_instructions,reheat_instructions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [
        uid[r.author],
        r.title,
        r.desc,
        r.category,
        r.difficulty,
        r.prep,
        r.servings,
        r.image,
        r.photo || '',
        JSON.stringify(r.ingredients),
        JSON.stringify(r.steps),
        JSON.stringify(r.tags),
        r.calories ?? null,
        r.protein_g ?? null,
        r.carbs_g ?? null,
        r.fat_g ?? null,
        r.fiber_g ?? null,
        r.cost_cents ?? null,
        r.storage_instructions || '',
        r.reheat_instructions || '',
      ]
    );
    rid.push(rows[0].id);
  }

  // Likes croisés (déterministes pour éviter Math.random dans certains environnements)
  const allU = Object.values(uid);
  for (let i = 0; i < rid.length; i++) {
    for (let k = 0; k <= (i % 3) + 1; k++) {
      await db.run('INSERT INTO likes (user_id,recipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        allU[(i + k) % allU.length],
        rid[i],
      ]);
    }
  }

  // Commentaires
  const samples = [
    'Testé hier soir, un régal !',
    'Merci pour la recette, je garde !',
    "Ça a l'air délicieux !",
    'Je vais tester ce week-end.',
    'Mes enfants ont adoré.',
  ];
  for (let i = 0; i < rid.length; i++) {
    await db.run('INSERT INTO comments (user_id,recipe_id,body) VALUES ($1,$2,$3)', [
      allU[(i + 2) % allU.length],
      rid[i],
      samples[i % samples.length],
    ]);
  }

  // Follows
  const followPairs = [
    [uid.demo, uid.chef_camille],
    [uid.demo, uid.leo_gourmand],
    [uid.leo_gourmand, uid.chef_camille],
    [uid.nadia_veggie, uid.chef_camille],
    [uid.tom_bbq, uid.leo_gourmand],
    [uid.chef_camille, uid.nadia_veggie],
    [uid.demo, uid.karim_epices],
    [uid.demo, uid.marc_sushi],
    [uid.lea_patisserie, uid.julien_pain],
    [uid.clara_vegan, uid.nadia_veggie],
    [uid.sofia_tapas, uid.karim_epices],
    [uid.marc_sushi, uid.sofia_tapas],
  ];
  for (const [a, b] of followPairs) {
    await db.run(
      'INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [a, b]
    );
  }

  // Points de départ
  const startingPoints = [
    [320, uid.chef_camille],
    [510, uid.leo_gourmand],
    [180, uid.nadia_veggie],
    [95, uid.tom_bbq],
    [140, uid.demo],
    [265, uid.julien_pain],
    [410, uid.sofia_tapas],
    [340, uid.marc_sushi],
    [590, uid.lea_patisserie],
    [225, uid.karim_epices],
    [160, uid.clara_vegan],
  ];
  for (const [p, id] of startingPoints) {
    await db.run('UPDATE users SET points=$1 WHERE id=$2', [p, id]);
  }

  // Boutique de récompenses
  const rewards = [
    ['Badge « Gourmet » exclusif', 'Un badge doré affiché sur ton profil.', 'medal', 100, -1],
    ['Sticker pack Cuistot', 'Pack de stickers cuisine à imprimer.', 'palette', 150, -1],
    ['Fiche recette premium', 'Débloque une recette de chef étoilé.', 'scroll', 250, -1],
    [
      'Tablier Cuistot brodé',
      'Le vrai tablier de la communauté (édition limitée).',
      'pan',
      800,
      20,
    ],
    ['Livre de recettes PDF', 'Le best-of de la communauté en PDF.', 'book', 400, -1],
    ['Mise en avant 1 semaine', 'Ta recette en tête du fil pendant 7 jours.', 'rocket', 600, 10],
    ["Bon d'achat 10€ épicerie", 'À valoir chez nos partenaires.', 'cart', 1200, 5],
  ];
  for (const r of rewards) {
    await db.run(
      'INSERT INTO rewards (title,description,icon,cost,stock) VALUES ($1,$2,$3,$4,$5)',
      r
    );
  }

  // Défis
  const inDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const challengesSeed = [
    [
      'Semaine végétarienne',
      'Publie une recette 100% végétarienne cette semaine.',
      'leaf',
      60,
      'végétarien',
      inDays(7),
    ],
    [
      'Défi chocolat',
      'Une recette qui contient du chocolat, et on est preneurs.',
      'chocolate',
      50,
      'chocolat',
      inDays(10),
    ],
    [
      "Cuisine d'automne",
      "Mets à l'honneur les saveurs de saison.",
      'leaf',
      70,
      'automne',
      inDays(14),
    ],
    [
      'Plat réconfortant',
      'Un bon petit plat mijoté pour se réchauffer.',
      'pot',
      55,
      'mijoté',
      inDays(12),
    ],
  ];
  for (const c of challengesSeed) {
    await db.run(
      'INSERT INTO challenges (title,description,icon,reward_pts,tag,ends_at) VALUES ($1,$2,$3,$4,$5,$6)',
      c
    );
  }

  return { users: users.length, recipes: recipes.length };
}

module.exports = { seedData };
