import { SecurityResult } from "../types/validation";

// ─── Crypto service — Phase 4 integration point ───────────────────────────────
//
// This file is intentionally minimal in Phase 1.
//
// Phase 4 (Member C) will:
//   1. Load public-keys.json
//   2. Implement verifySignature() using the Web Crypto API
//   3. Return a real SecurityResult
//
// Until then, every call returns { signatureValid: null, status: "pending" }
// so the decision engine knows not to issue a green badge.
//
// Do NOT return "verified" here just to make the demo look complete.
// A pending status is honest and correct for Phase 1.

export interface CryptoInput {
  payload: string;
  signature: string | undefined;
}

/**
 * Verifies the cryptographic signature of a QR payload.
 *
 * Phase 1: always returns "pending" — not implemented yet.
 * Phase 4: replace the body of this function with a real implementation.
 *          The return type and signature must not change.
 */
export async function verifySignature(
  _input: CryptoInput
): Promise<SecurityResult> {
  // Implementation deferred to Phase 4.
  return {
    signatureValid: null,
    status: "pending",
    reason: "Cryptographic verification is not yet implemented (Phase 4)",
  };
}
