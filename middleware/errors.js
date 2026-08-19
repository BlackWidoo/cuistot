// middleware/errors.js — réponses d'erreur cohérentes + validation Zod + validation d':id
// Toutes les erreurs API suivent la même forme : { error, code, fields? } — voir le brief.
function apiError(res, status, message, code, fields) {
  const body = { error: message, code: code || 'ERROR' };
  if (fields) body.fields = fields;
  return res.status(status).json(body);
}

// Middleware de validation Zod : parse req.body, renvoie une erreur structurée sinon.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return apiError(res, 400, 'Requête invalide', 'VALIDATION_ERROR', fields);
    }
    req.valid = result.data;
    next();
  };
}

// Valide un :id d'URL (entier positif) avant de toucher la base.
function idParam(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return apiError(res, 400, 'Identifiant invalide', 'VALIDATION_ERROR');
  req.id = id;
  next();
}

// Les handlers de routes sont désormais async (accès base PostgreSQL) : Express 4 ne rattrape
// pas nativement une promesse rejetée dans un handler, ce qui ferait planter le process. Ce
// wrapper convertit tout rejet en erreur 500 propre au lieu d'un crash.
function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => {
      console.error(e);
      apiError(res, 500, 'Erreur serveur', 'SERVER_ERROR');
    });
}

module.exports = { apiError, validate, idParam, asyncHandler };
