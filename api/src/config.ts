import dotenv from "dotenv";

dotenv.config();

// Central place for all environment-sourced config.
// Callers read from here; they never read process.env directly.

// Reads a positive integer from the environment, falling back when unset,
// empty, or not a usable number. Never throws at import time — a bad value
// must not stop the process from booting.
function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    // eslint-disable-next-line no-console
    console.warn(`[config] ${name} is not a non-negative integer ("${raw}") — using ${fallback}`);
    return fallback;
  }
  return parsed;
}

export const config = {
  port: readInt("PORT", 3001),

  // ─── Merchant service (Phase 2) ────────────────────────────────────────────
  //
  // The real merchant provider is provider-agnostic: the endpoint, auth header
  // and response field names are all configurable, so switching vendors is a
  // configuration change rather than a code change.
  //
  // When merchantApiUrl is empty, the mock provider is used automatically.

  /** Base URL of the merchant verification endpoint, e.g. https://api.vendor.com/v1/merchants */
  merchantApiUrl: process.env.MERCHANT_API_URL ?? "",
  /** Credential sent to the merchant provider. Required when merchantApiUrl is set. */
  npciApiKey: process.env.NPCI_API_KEY ?? "",
  /** Header the credential is sent in. */
  merchantAuthHeader: process.env.MERCHANT_AUTH_HEADER ?? "Authorization",
  /** Prefix placed before the credential, e.g. "Bearer" for `Bearer <key>`. Empty for a raw key. */
  merchantAuthScheme: process.env.MERCHANT_AUTH_SCHEME ?? "Bearer",
  /** Query-string parameter used to send the UPI ID to the provider. */
  merchantUpiParam: process.env.MERCHANT_UPI_PARAM ?? "upiId",
  /** Dot-path to the boolean verification flag in the provider response, e.g. "data.verified". */
  merchantVerifiedPath: process.env.MERCHANT_VERIFIED_PATH ?? "verified",
  /** Dot-path to the merchant name in the provider response, e.g. "data.merchantName". */
  merchantNamePath: process.env.MERCHANT_NAME_PATH ?? "name",
  /** Request timeout in milliseconds before the provider is considered unavailable. */
  merchantTimeoutMs: readInt("MERCHANT_TIMEOUT_MS", 5000),
  /** How long a successful lookup is cached, in ms. Set to 0 to disable caching. */
  merchantCacheTtlMs: readInt("MERCHANT_CACHE_TTL_MS", 300_000),

  // ─── Fraud service (Phase 3) ───────────────────────────────────────────────
  //
  // When set, the fraud service will call the live ML prediction endpoint.
  // When absent, the mock fraud provider is used automatically.

  mlServiceUrl: process.env.ML_SERVICE_URL ?? "",
  mlServiceApiKey: process.env.ML_SERVICE_API_KEY ?? "",
} as const;
