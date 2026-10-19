import {
  MerchantProviderError,
  buildMerchantLookupUrl,
  createCachingProvider,
  createHttpProvider,
  FetchLike,
  MerchantProvider,
} from "../src/services/merchant";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface CapturedCall {
  url?: string;
  headers?: Record<string, string>;
}

/** Builds a fetch double that records its call and returns a canned response. */
function fetchReturning(status: number, body: unknown, captured?: CapturedCall): FetchLike {
  return async (url, init) => {
    if (captured) {
      captured.url = url;
      captured.headers = init.headers;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

const BASE_OPTIONS = {
  baseUrl: "https://api.vendor.test/v1/merchants",
  apiKey: "secret-key",
  authHeader: "Authorization",
  authScheme: "Bearer",
  upiParam: "upiId",
  verifiedPath: "verified",
  namePath: "name",
  timeoutMs: 1000,
};

// ─── 1. Happy path — verified merchant ────────────────────────────────────────

describe("HTTP merchant provider — verified merchant", () => {
  it("maps a verified response to a verified MerchantResult", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { verified: true, name: "Test Merchant" }),
    });

    const result = await provider.lookup("testmerchant@upi");

    expect(result).toEqual({
      name: "Test Merchant",
      upiId: "testmerchant@upi",
      verified: true,
    });
  });

  it("sends the UPI ID as the configured query parameter", async () => {
    const captured: { url?: string; headers?: Record<string, string> } = {};
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { verified: true, name: "X" }, captured),
    });

    await provider.lookup("testmerchant@upi");

    expect(captured.url).toBe(
      "https://api.vendor.test/v1/merchants?upiId=testmerchant%40upi"
    );
  });

  it("sends the credential using the configured header and scheme", async () => {
    const captured: { url?: string; headers?: Record<string, string> } = {};
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { verified: true }, captured),
    });

    await provider.lookup("testmerchant@upi");

    expect(captured.headers?.Authorization).toBe("Bearer secret-key");
    expect(captured.headers?.Accept).toBe("application/json");
  });

  it("supports a custom auth header with no scheme prefix", async () => {
    const captured: { url?: string; headers?: Record<string, string> } = {};
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      authHeader: "X-Api-Key",
      authScheme: "",
      fetchImpl: fetchReturning(200, { verified: true }, captured),
    });

    await provider.lookup("testmerchant@upi");

    expect(captured.headers?.["X-Api-Key"]).toBe("secret-key");
  });
});

// ─── 2. Configurable response mapping ────────────────────────────────────────

describe("HTTP merchant provider — response mapping", () => {
  it("reads nested fields via configurable dot paths", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      verifiedPath: "data.isVerified",
      namePath: "data.merchant.displayName",
      fetchImpl: fetchReturning(200, {
        data: { isVerified: true, merchant: { displayName: "Nested Store" } },
      }),
    });

    const result = await provider.lookup("nested@upi");

    expect(result?.name).toBe("Nested Store");
    expect(result?.verified).toBe(true);
  });

  it("returns null when the provider 404s", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(404, { error: "not found" }),
    });

    await expect(provider.lookup("nobody@upi")).resolves.toBeNull();
  });

  it("falls back to the UPI ID when a verified merchant has no name", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { verified: true }),
    });

    const result = await provider.lookup("nameless@upi");

    expect(result).toEqual({ name: "nameless@upi", upiId: "nameless@upi", verified: true });
  });

  it("returns verified: false without treating it as an error", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { verified: false, name: "Suspicious Merchant" }),
    });

    const result = await provider.lookup("suspicious@upi");

    expect(result?.verified).toBe(false);
    expect(result?.name).toBe("Suspicious Merchant");
  });
});

// ─── 3. Fail-closed behaviour ─────────────────────────────────────────────────

describe("HTTP merchant provider — fails closed", () => {
  it("throws on 401 rather than reporting an unverified merchant", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(401, { error: "unauthorized" }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toThrow(MerchantProviderError);
  });

  it("throws a retryable error on 500", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(500, { error: "boom" }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_UNAVAILABLE",
      retryable: true,
    });
  });

  it("throws on a network failure", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_UNAVAILABLE",
    });
  });

  it("classifies a TimeoutError rejection as a timeout", async () => {
    // This is the name AbortSignal.timeout actually produces on Node.
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: async () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      },
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_TIMEOUT",
    });
  });

  it("classifies an AbortError rejection as a timeout", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: async () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        throw error;
      },
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_TIMEOUT",
    });
  });

  it("classifies by the aborted signal even when the error name is unhelpful", async () => {
    // Guards against relying on the rejection name alone: runtimes differ.
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new TypeError("fetch failed"));
          });
        }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_TIMEOUT",
    });
  });

  it("throws when the body is not valid JSON", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_BAD_RESPONSE",
    });
  });

  it("throws when the verified field is missing — never guesses false", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { status: "ok" }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_BAD_RESPONSE",
      retryable: false,
    });
  });

  it("throws when the verified field is not a boolean", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      fetchImpl: fetchReturning(200, { verified: "yes" }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_BAD_RESPONSE",
    });
  });
});

// ─── 4. Configuration errors ──────────────────────────────────────────────────

describe("HTTP merchant provider — configuration", () => {
  it("throws when no API key is configured", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      apiKey: "",
      fetchImpl: fetchReturning(200, { verified: true }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_CONFIG_ERROR",
      retryable: false,
    });
  });

  it("throws when no base URL is configured", async () => {
    const provider = createHttpProvider({
      ...BASE_OPTIONS,
      baseUrl: "",
      fetchImpl: fetchReturning(200, { verified: true }),
    });

    await expect(provider.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_CONFIG_ERROR",
    });
  });
});

// ─── 5. URL construction ──────────────────────────────────────────────────────

describe("buildMerchantLookupUrl", () => {
  it("preserves existing query parameters on the base URL", () => {
    const url = buildMerchantLookupUrl(
      "https://api.vendor.test/merchants?tenant=acme",
      "upiId",
      "shop@upi"
    );

    expect(url).toContain("tenant=acme");
    expect(url).toContain("upiId=shop%40upi");
  });

  it("uses the configured parameter name", () => {
    const url = buildMerchantLookupUrl("https://api.vendor.test/m", "vpa", "shop@upi");

    expect(url).toContain("vpa=shop%40upi");
    expect(url).not.toContain("upiId=");
  });
});

// ─── 6. TTL cache ─────────────────────────────────────────────────────────────

describe("createCachingProvider", () => {
  function countingProvider(value: MerchantProvider["lookup"]): MerchantProvider & {
    calls: number;
  } {
    return {
      calls: 0,
      async lookup(upiId: string) {
        this.calls += 1;
        return value(upiId);
      },
    };
  }

  it("serves repeated lookups from cache", async () => {
    const now = 1000;
    const inner = countingProvider(async () => ({
      name: "Test Merchant",
      upiId: "testmerchant@upi",
      verified: true,
    }));
    const cached = createCachingProvider(inner, 5000, () => now);

    await cached.lookup("testmerchant@upi");
    await cached.lookup("testmerchant@upi");

    expect(inner.calls).toBe(1);
  });

  it("refetches once the TTL has expired", async () => {
    let now = 1000;
    const inner = countingProvider(async () => ({
      name: "Test Merchant",
      upiId: "testmerchant@upi",
      verified: true,
    }));
    const cached = createCachingProvider(inner, 5000, () => now);

    await cached.lookup("testmerchant@upi");
    now = 7000;
    await cached.lookup("testmerchant@upi");

    expect(inner.calls).toBe(2);
  });

  it("caches null results for unknown merchants", async () => {
    const inner = countingProvider(async () => null);
    const cached = createCachingProvider(inner, 5000, () => 1000);

    await expect(cached.lookup("nobody@upi")).resolves.toBeNull();
    await expect(cached.lookup("nobody@upi")).resolves.toBeNull();

    expect(inner.calls).toBe(1);
  });

  it("does not cache errors so a recovering provider is picked up at once", async () => {
    let shouldFail = true;
    let now = 1000;
    const inner: MerchantProvider = {
      async lookup(upiId: string) {
        if (shouldFail) throw new MerchantProviderError("MERCHANT_UNAVAILABLE", "down", true);
        return { name: "Test Merchant", upiId, verified: true };
      },
    };
    const cached = createCachingProvider(inner, 60_000, () => now);

    await expect(cached.lookup("testmerchant@upi")).rejects.toThrow();

    shouldFail = false;
    now = 2000;
    const result = await cached.lookup("testmerchant@upi");

    expect(result?.verified).toBe(true);
  });

  it("is bypassed entirely when the TTL is zero", async () => {
    const inner = countingProvider(async () => ({
      name: "Test Merchant",
      upiId: "testmerchant@upi",
      verified: true,
    }));
    const cached = createCachingProvider(inner, 0, () => 1000);

    await cached.lookup("testmerchant@upi");
    await cached.lookup("testmerchant@upi");

    expect(inner.calls).toBe(2);
  });
});