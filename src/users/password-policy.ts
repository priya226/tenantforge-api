// One place for the password rules, used by the HTTP DTO and by the seed command.
// Length is what makes a password strong (NIST guidance), so there are no "must contain a symbol" rules.
// The maximum stops a huge "password" from making argon2 burn CPU.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
