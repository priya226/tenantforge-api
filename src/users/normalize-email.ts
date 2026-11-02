// Emails are stored lowercased and trimmed (V2 has a CHECK constraint for it).
// Use this before every save and every lookup, so "Priya@X.com " and "priya@x.com" are the same user.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
