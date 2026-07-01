export const ALLOWED_GOOGLE_EMAILS = [
  "holzer.wolfgang@gmail.com",
  "nawolaju@gmail.com"
];

export const ALLOW_ANONYMOUS_TEST_MODE = true;

function normalizedEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isWhitelistConfigured() {
  return ALLOWED_GOOGLE_EMAILS.some(email => normalizedEmail(email) && normalizedEmail(email) !== "deine.email@example.com");
}

export function isAllowedFirebaseUser(user) {
  if (!user) return false;
  if (user.isAnonymous) return ALLOW_ANONYMOUS_TEST_MODE;
  if (!isWhitelistConfigured()) return false;

  const allowed = ALLOWED_GOOGLE_EMAILS.map(normalizedEmail);
  return allowed.includes(normalizedEmail(user.email));
}

export function firebaseAccessDeniedMessage(user) {
  if (!user) return "Keine Anmeldung gefunden.";
  if (!isWhitelistConfigured()) {
    return "Whitelist noch nicht konfiguriert. Bitte deine Google-Mail in firebase-access.js und in den Firebase Rules eintragen.";
  }
  return `Dieses Google-Konto ist nicht freigegeben: ${user.email || "ohne E-Mail"}`;
}
