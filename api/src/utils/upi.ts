// Utilities for normalizing and validating UPI/QR input.
// Kept separate so the handler stays clean and these can be unit-tested independently.

// UPI VPA format: localpart@provider
// Allows letters, digits, dots, hyphens in the local part; letters in the provider.
const UPI_ID_PATTERN = /^[a-zA-Z0-9.\-_]+@[a-zA-Z]{2,}$/;

export function isValidUpiId(upiId: string): boolean {
  return UPI_ID_PATTERN.test(upiId.trim());
}

/** Returns a lowercase, trimmed UPI ID suitable for lookups. */
export function normalizeUpiId(upiId: string): string {
  return upiId.trim().toLowerCase();
}

/** Basic check that a QR payload is a non-empty string. */
export function isValidPayload(payload: string): boolean {
  return typeof payload === "string" && payload.trim().length > 0;
}
