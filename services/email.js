// services/email.js
// Point d'envoi de l'email de réinitialisation. Pas de fournisseur d'email branché ici :
// on journalise le lien côté serveur. Pour une vraie livraison en prod, remplace le corps
// de cette fonction par un appel à un service comme Resend/Postmark (un simple fetch HTTPS
// avec une clé API suffit, pas besoin de SMTP).
async function sendPasswordResetEmail(email, link) {
  console.log(`✉️  Lien de réinitialisation pour ${email} : ${link}`);
}

module.exports = { sendPasswordResetEmail };
