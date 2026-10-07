import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SecurityResult } from "../types/validation";

// ─── Errors ───────────────────────────────────────────────────────────────────

export type CryptoErrorCode =
  | "CRYPTO_KEYS_UNAVAILABLE"
  | "CRYPTO_BAD_SIGNATURE_ENCODING";

export class CryptoServiceError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CryptoServiceError";
    this.code = code;
  }
}

// ─── Key management ───────────────────────────────────────────────────────────
//
// Public keys are loaded from public-keys.json at the project root.
// The file is read once and cached so the disk is not hit on every request.
// In a production deployment you would refresh this cache on a schedule or
// watch the file; for Phase 4 an in-process cache is sufficient.

interface PublicKeyEntry {
  id: string;
  upiId: string;
  algorithm: string;
  /** PEM with literal \n instead of real newlines (JSON-safe encoding) */
  publicKey: string;
  addedAt: string;
}

interface PublicKeysFile {
  comment: string;
  keys: PublicKeyEntry[];
}

// Path is relative to the compiled/executed file. In both `tsx` (dev) and
// `node dist/` (prod) the repo root is at ../../ from api/src/services/.
const KEYS_FILE_PATH = path.resolve(__dirname, "..", "..", "..", "public-keys.json");

let keyCache: Map<string, crypto.KeyObject> | null = null;

function loadPublicKeys(): Map<string, crypto.KeyObject> {
  if (keyCache) return keyCache;

  let raw: string;
  try {
    raw = fs.readFileSync(KEYS_FILE_PATH, "utf-8");
  } catch (error) {
    throw new CryptoServiceError(
      "CRYPTO_KEYS_UNAVAILABLE",
      `Could not read public-keys.json: ${(error as Error).message}`,
      { cause: error }
    );
  }

  let parsed: PublicKeysFile;
  try {
    parsed = JSON.parse(raw) as PublicKeysFile;
  } catch (error) {
    throw new CryptoServiceError(
      "CRYPTO_KEYS_UNAVAILABLE",
      "public-keys.json is not valid JSON",
      { cause: error }
    );
  }

  if (!Array.isArray(parsed.keys)) {
    throw new CryptoServiceError(
      "CRYPTO_KEYS_UNAVAILABLE",
      "public-keys.json is missing a \"keys\" array"
    );
  }

  const map = new Map<string, crypto.KeyObject>();

  for (const entry of parsed.keys) {
    // The generator tool stores \n as literal \\n for JSON safety — restore them.
    const pem = entry.publicKey.replace(/\\n/g, "\n");
    try {
      const keyObj = crypto.createPublicKey({ key: pem, format: "pem" });
      map.set(entry.upiId, keyObj);
    } catch (error) {
      // A malformed key in the file should not crash the whole service —
      // just log and skip it. The specific VPA will get "invalid" signature.
      // eslint-disable-next-line no-console
      console.warn(`[crypto] Skipping malformed key for ${entry.upiId}: ${(error as Error).message}`);
    }
  }

  keyCache = map;
  return map;
}

/** Drops the cached key map — used by tests after modifying the key file. */
export function resetKeyCache(): void {
  keyCache = null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CryptoInput {
  /** Raw QR payload string exactly as decoded from the QR code. */
  payload: string;
  /** Base64-encoded RSA-SHA256 signature, or undefined if QR had no signature. */
  signature: string | undefined;
  /** Normalized UPI ID used to look up the merchant's public key. */
  upiId: string;
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verifies the cryptographic signature of a UPI QR payload.
 *
 * Algorithm: RSA-2048, digest SHA-256, signature base64-encoded.
 *
 * Returns:
 *   - { status: "pending" }    when no signature is present in the QR
 *   - { status: "verified" }   when the signature matches the payload
 *   - { status: "invalid"  }   when signature is present but does not match
 *
 * Throws CryptoServiceError when the key file cannot be read or
 * when the base64 signature cannot be decoded — callers map this to 503.
 */
export async function verifySignature(input: CryptoInput): Promise<SecurityResult> {
  // No signature embedded in the QR — pending is honest and backward compatible.
  if (!input.signature) {
    return {
      signatureValid: null,
      status: "pending",
      reason: "No cryptographic signature was included in the QR code",
    };
  }

  // Decode the base64 signature before accessing the key map so a bad
  // encoding is caught before doing any disk I/O.
  let sigBuffer: Buffer;
  try {
    sigBuffer = Buffer.from(input.signature, "base64");
  } catch (error) {
    throw new CryptoServiceError(
      "CRYPTO_BAD_SIGNATURE_ENCODING",
      "Signature could not be decoded as base64",
      { cause: error }
    );
  }

  // Look up the merchant's public key. If no key is registered, the QR
  // cannot be considered verified — return invalid rather than pending, so
  // the decision engine does not issue a false Green badge.
  const keys = loadPublicKeys();
  const publicKey = keys.get(input.upiId);

  if (!publicKey) {
    return {
      signatureValid: false,
      status: "invalid",
      reason: `No public key registered for ${input.upiId}`,
    };
  }

  // Node's crypto.verify never throws on a bad signature — it returns false.
  // It only throws when the key or signature is structurally unusable.
  let valid: boolean;
  try {
    valid = crypto.verify(
      "sha256",
      Buffer.from(input.payload),
      publicKey,
      sigBuffer
    );
  } catch (error) {
    // The signature bytes are structurally wrong (wrong length, wrong format).
    return {
      signatureValid: false,
      status: "invalid",
      reason: "Signature format is not valid for this key algorithm",
    };
  }

  if (valid) {
    return {
      signatureValid: true,
      status: "verified",
      reason: "RSA-SHA256 signature is valid — payload has not been tampered with",
    };
  }

  return {
    signatureValid: false,
    status: "invalid",
    reason: "Signature does not match the QR payload — the QR code may have been tampered with",
  };
}