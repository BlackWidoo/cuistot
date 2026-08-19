// schemas/recipes.js — validation Zod pour recettes et commentaires
const { z } = require('zod');

// Limites de longueur pour éviter des textes absurdement longs (UI + stockage)
const MAX_TITLE = 120,
  MAX_DESC = 2000,
  MAX_COMMENT = 1000;

const recipeSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Titre requis')
    .max(MAX_TITLE, `Titre trop long (max ${MAX_TITLE} caractères)`),
  description: z
    .string()
    .max(MAX_DESC, `Description trop longue (max ${MAX_DESC} caractères)`)
    .optional(),
  category: z.string().max(40).optional(),
  difficulty: z.string().max(40).optional(),
  // .catch() plutôt que .optional() : un champ vidé par erreur (input number effacé) retombe
  // sur la valeur par défaut au lieu de faire échouer toute la validation, comme avant Zod.
  prep_minutes: z.coerce.number().int().min(1).max(1440).catch(15),
  servings: z.coerce.number().int().min(1).max(100).catch(2),
  image: z.string().max(30).optional(),
  photo: z.string().max(3_100_000).optional(),
  // Un ingrédient est soit une chaîne libre (recettes créées avant le Lot 8, tolérance en
  // écriture aussi au cas où), soit structuré {qty, unit, label} pour permettre le recalcul
  // des quantités quand on ajuste le nombre de portions.
  ingredients: z
    .array(
      z.union([
        z.string().max(200),
        z.object({
          qty: z.coerce.number().min(0).max(100000).nullable().optional(),
          unit: z.string().max(20).optional(),
          label: z.string().trim().min(1).max(200),
        }),
      ])
    )
    .max(60)
    .optional(),
  steps: z.array(z.string().max(1000)).max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  // Macros/coût par portion — tous optionnels
  calories: z.coerce.number().int().min(0).max(20000).nullable().optional(),
  protein_g: z.coerce.number().min(0).max(2000).nullable().optional(),
  carbs_g: z.coerce.number().min(0).max(2000).nullable().optional(),
  fat_g: z.coerce.number().min(0).max(2000).nullable().optional(),
  fiber_g: z.coerce.number().min(0).max(500).nullable().optional(),
  cost_cents: z.coerce.number().int().min(0).max(100000).nullable().optional(), // jusqu'à 1000€/portion
  storage_instructions: z.string().max(500).optional(),
  reheat_instructions: z.string().max(500).optional(),
  status: z.enum(['draft', 'published']).optional(),
});
const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Commentaire vide')
    .max(MAX_COMMENT, `Commentaire trop long (max ${MAX_COMMENT} caractères)`),
});

module.exports = { recipeSchema, commentSchema, MAX_TITLE, MAX_DESC, MAX_COMMENT };
