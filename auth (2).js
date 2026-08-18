// schemas/auth.js — validation Zod pour l'inscription/connexion/compte
const { z } = require('zod');

// Mot de passe : 10 caractères minimum (relevé depuis 6 — recommandation du brief, Lot 3).
const passwordSchema = z.string().min(10, 'Minimum 10 caractères').max(200);

const registerSchema = z.object({
  username: z.string().trim().min(3, 'Le pseudo doit faire entre 3 et 24 caractères').max(24, 'Le pseudo doit faire entre 3 et 24 caractères'),
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(254),
  password: passwordSchema,
});
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Champ requis').max(254), // email OU pseudo, pas de .email() ici
  password: z.string().min(1, 'Champ requis').max(200),
});
const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(254),
});
const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
const avatarPatchSchema = z.object({
  avatar: z.string().max(30).optional(),
  avatar_color: z.string().max(30).optional(),
}).refine((d) => d.avatar !== undefined || d.avatar_color !== undefined, { message: 'Rien à mettre à jour' });
const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis').max(200),
});

module.exports = {
  passwordSchema, registerSchema, loginSchema,
  forgotPasswordSchema, resetPasswordSchema,
  avatarPatchSchema, deleteAccountSchema,
};
