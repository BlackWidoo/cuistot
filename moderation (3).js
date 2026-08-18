// schemas/moderation.js — validation Zod pour signalements/modération
const { z } = require('zod');

const reportSchema = z.object({
  target_type: z.enum(['recipe', 'comment', 'user']),
  target_id: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, 'Explique un peu plus').max(500),
});
const resolveReportSchema = z.object({
  action: z.enum(['hide', 'dismiss', 'suspend_user']),
});

module.exports = { reportSchema, resolveReportSchema };
