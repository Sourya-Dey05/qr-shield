import { MerchantResult } from "../types/validation";
import { config } from "../config";

// ─── Provider interface ───────────────────────────────────────────────────────
//
// Both the mock and the real provider satisfy this, and getMerchant() is the
// only entry point the handler uses. Swapping providers never changes the API.

export interface MerchantProvider {
  lookup(normalizedUpiId: string): Promise<MerchantResult | null>;
}

// ─── Errors ───────────────────────────────────────────────────────────────────
//
// A dedicated error type lets callers tell "this merchant does not exist"
// (a legitimate null) apart from "we could not find out" (must fail closed).
// `retryable` marks transient upstream conditions such as 429/5xx/network errors.

export type MerchantProviderErrorCode =
  | "MERCHANT_CONFIG_ERROR"
  | "MERCHANT_UNAVAILABLE"
  | "MERCHANT_TIMEOUT"
  | "MERCHANT_BAD_RESPONSE";

export class MerchantProviderError extends Error {
  readonly code: MerchantProviderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: MerchantProviderErrorCode,
    message: string,
    retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "MerchantProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

// ─── Minimal fetch surface ────────────────────────────────────────────────────
//
// Declared locally rather than depending on the DOM/undici typings so the
// module stays testable with a plain object and keeps compiling on Node 18.

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  }
) => Promise<HttpResponseLike>;

// ─── Mock provider ────────────────────────────────────────────────────────────
//
// Used when MERCHANT_API_URL is not configured.
// Returns deterministic results so tests are reliable.
// These are fixture values, not real verification — never present them as such.

const MOCK_MERCHANTS: Record<string, MerchantResult> = {
  "testmerchant@upi": {
    name: "Test Merchant",
    upiId: "testmerchant@upi",
    verified: true,
  },
  "verified@hdfc": {
    name: "HDFC Verified Store",
    upiId: "verified@hdfc",
    verified: true,
  },
  "suspicious@upi": {
    name: "Suspicious Merchant",
    upiId: "suspicious@upi",
    verified: false,
  },
};

const mockProvider: MerchantProvider = {
  async lookup(normalizedUpiId) {
    // Simulate a tiny async operation without a real network call.
    await Promise.resolve();
    return MOCK_MERCHANTS[normalizedUpiId] ?? null;
  },
};

// ─── Response mapping ─────────────────────────────────────────────────────────
//
// Reads a dot-separated path out of an arbitrary parsed JSON body, so vendors
// that nest results (data.verified, result.merchant.name) can be supported by
// configuration alone. Returns undefined for any missing segment.

function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Builds the provider lookup URL.
 *
 * Exported for testing — the URL is the one piece of request construction that
 * is easy to get subtly wrong (encoding, parameter name).
 */
export function buildMerchantLookupUrl(baseUrl: string, upiParam: string, upiId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(upiParam, upiId);
  return url.toString();
}

// ─── HTTP provider (Phase 2) ──────────────────────────────────────────────────
//
// Generic, vendor-agnostic merchant verification over HTTP:
//
//   GET <MERCHANT_API_URL>?<MERCHANT_UPI_PARAM>=<upiId>
//   <MERCHANT_AUTH_HEADER>: <MERCHANT_AUTH_SCHEME> <NPCI_API_KEY>
//
// Expected response body (field names configurable):
//
//   { "verified": true, "name": "Test Merchant" }
//
// Failure policy — fail closed:
//   • 404                → null (merchant genuinely unknown → 404 to the caller)
//   • 401/403            → MerchantProviderError, not retryable (bad credentials)
//   • 429, 5xx, network  → MerchantProviderError, retryable → 503 to the caller
//   • timeout            → MerchantProviderError → 503 to the caller
//   • 2xx, unusable body → MerchantProviderError → 503 to the caller
//
// In every failure case we refuse to guess. Returning an unverified merchant
// would let a broken provider silently downgrade a Red badge to an Amber one.

export interface HttpMerchantProviderOptions {
  baseUrl: string;
  apiKey: string;
  authHeader: string;
  authScheme: string;
  upiParam: string;
  verifiedPath: string;
  namePath: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

export function createHttpProvider(options: HttpMerchantProviderOptions): MerchantProvider {
  const fetchImpl: FetchLike =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async lookup(normalizedUpiId: string): Promise<MerchantResult | null> {
      if (!options.baseUrl) {
        throw new MerchantProviderError(
          "MERCHANT_CONFIG_ERROR",
          "MERCHANT_API_URL is not configured",
          false
        );
      }

      if (!options.apiKey) {
        throw new MerchantProviderError(
          "MERCHANT_CONFIG_ERROR",
          "NPCI_API_KEY is required when MERCHANT_API_URL is set",
          false
        );
      }

      if (typeof fetchImpl !== "function") {
        throw new MerchantProviderError(
          "MERCHANT_CONFIG_ERROR",
          "No fetch implementation is available (Node 18+ required)",
          false
        );
      }

      const url = buildMerchantLookupUrl(options.baseUrl, options.upiParam, normalizedUpiId);

      const authorization = options.authScheme
        ? `${options.authScheme} ${options.apiKey}`
        : options.apiKey;

      // AbortSignal.timeout is available on Node 18+. The manual fallback keeps
      // the behaviour identical on older runtimes instead of silently never timing out.
      const signal =
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(options.timeoutMs)
          : abortControllerSignalFallback(options.timeoutMs);

      let response: HttpResponseLike;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            [options.authHeader]: authorization,
          },
          signal,
        });
      } catch (error) {
        // We only ever abort this signal ourselves, and only on timeout, so an
        // aborted signal identifies a timeout regardless of how the runtime
        // names the rejection. This matters: AbortController surfaces an
        // "AbortError", while AbortSignal.timeout surfaces a "TimeoutError",
        // so name-based detection alone silently misclassifies real timeouts.
        if (signal.aborted || isTimeoutError(error)) {
          throw new MerchantProviderError(
            "MERCHANT_TIMEOUT",
            `Merchant provider timed out after ${options.timeoutMs}ms`,
            true,
            { cause: error }
          );
        }
        throw new MerchantProviderError(
          "MERCHANT_UNAVAILABLE",
          "Merchant provider request failed",
          true,
          { cause: error }
        );
      }

      // A 404 is the one upstream response that maps to a legitimate null.
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw toHttpError(response.status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new MerchantProviderError(
          "MERCHANT_BAD_RESPONSE",
          "Merchant provider returned a body that is not valid JSON",
          false,
          { cause: error }
        );
      }

      const verified = readPath(body, options.verifiedPath);

      // A 2xx without a usable boolean is a contract mismatch. Fail closed
      // rather than treating a missing field as "not verified".
      if (typeof verified !== "boolean") {
        throw new MerchantProviderError(
          "MERCHANT_BAD_RESPONSE",
          `Merchant provider response is missing a boolean at "${options.verifiedPath}"`,
          false
        );
      }

      if (!verified) {
        return {
          // Name is best-effort for unverified merchants; the UPI ID is honest.
          name: readNonEmptyString(readPath(body, options.namePath)) ?? normalizedUpiId,
          upiId: normalizedUpiId,
          verified: false,
        };
      }

      const name = readNonEmptyString(readPath(body, options.namePath));

      // A verified merchant with no name is a degraded response, but the
      // verified flag itself is trustworthy, so fall back to the VPA.
      return {
        name: name ?? normalizedUpiId,
        upiId: normalizedUpiId,
        verified: true,
      };
    },
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toHttpError(status: number): MerchantProviderError {
  if (status === 401 || status === 403) {
    return new MerchantProviderError(
      "MERCHANT_UNAVAILABLE",
      `Merchant provider rejected our credentials (HTTP ${status})`,
      false
    );
  }
  // 408 and 429 plus every 5xx are transient and worth retrying upstream.
  return new MerchantProviderError(
    "MERCHANT_UNAVAILABLE",
    `Merchant provider returned HTTP ${status}`,
    true
  );
}

/**
 * Recognises a timeout/abort rejection.
 *
 * Covers both names seen in practice: "TimeoutError" from AbortSignal.timeout
 * and "AbortError" from AbortController. This is a belt-and-braces check
 * alongside the signal.aborted test in the catch block.
 */
function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Manual timeout signal for runtimes without AbortSignal.timeout. */
function abortControllerSignalFallback(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Do not hold the event loop open just to clear a timeout.
  if (typeof timer.unref === "function") timer.unref();
  return controller.signal;
}

// ─── TTL cache ────────────────────────────────────────────────────────────────
//
// Verification results change rarely, so a short-lived cache removes most
// duplicate upstream calls without making a stale answer a permanent one.
//
// Only successful lookups are cached. Errors propagate on every call so a
// recovering upstream is picked up immediately rather than after a TTL.

interface CacheEntry {
  expiresAt: number;
  value: MerchantResult | null;
}

/** Hard cap on distinct cached UPI IDs, so a flood of unknown IDs cannot grow it without bound. */
const CACHE_MAX_ENTRIES = 1000;

export function createCachingProvider(
  inner: MerchantProvider,
  ttlMs: number,
  now: () => number = Date.now
): MerchantProvider {
  if (ttlMs <= 0) return inner;

  const cache = new Map<string, CacheEntry>();

  return {
    async lookup(normalizedUpiId: string): Promise<MerchantResult | null> {
      const hit = cache.get(normalizedUpiId);
      if (hit && hit.expiresAt > now()) {
        return hit.value;
      }

      // Expired entries are removed lazily on read; the size cap evicts the
      // oldest insertion when full, which Map preserves via its insertion order.
      if (hit) cache.delete(normalizedUpiId);

      const value = await inner.lookup(normalizedUpiId);

      if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(normalizedUpiId, { expiresAt: now() + ttlMs, value });

      return value;
    },
  };
}

// ─── Provider selection ───────────────────────────────────────────────────────
//
// Memoised because the cache must be shared across requests. Creating a new
// provider per call would make the cache useless.

let cachedProvider: MerchantProvider | null = null;

function buildProviderFromConfig(): MerchantProvider {
  if (!config.merchantApiUrl) {
    return mockProvider;
  }

  const http = createHttpProvider({
    baseUrl: config.merchantApiUrl,
    apiKey: config.npciApiKey,
    authHeader: config.merchantAuthHeader,
    authScheme: config.merchantAuthScheme,
    upiParam: config.merchantUpiParam,
    verifiedPath: config.merchantVerifiedPath,
    namePath: config.merchantNamePath,
    timeoutMs: config.merchantTimeoutMs,
  });

  return createCachingProvider(http, config.merchantCacheTtlMs);
}

function getProvider(): MerchantProvider {
  cachedProvider ??= buildProviderFromConfig();
  return cachedProvider;
}

/**
 * Looks up a merchant by normalized UPI ID.
 *
 * Returns null if the merchant is unknown.
 * Throws MerchantProviderError if verification could not be performed — callers
 * must treat that as a service failure (503), not as an unverified merchant.
 */
export async function getMerchant(
  normalizedUpiId: string,
  provider: MerchantProvider = getProvider()
): Promise<MerchantResult | null> {
  return provider.lookup(normalizedUpiId);
}

/** Test seam: drops the memoised provider so a changed environment takes effect. */
export function resetProviderCache(): void {
  cachedProvider = null;
}