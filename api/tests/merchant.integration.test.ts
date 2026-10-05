import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpProvider, createCachingProvider } from "../src/services/merchant";

// ─── Integration tests for the real HTTP provider ─────────────────────────────
//
// The unit tests in merchant.test.ts inject a fetch double. That is fast but
// it cannot catch runtime-specific behaviour — in particular the real fetch
// rejects with a DOMException named "TimeoutError" when an
// AbortSignal.timeout fires, which a hand-written double will not reproduce.
//
// These tests talk to a real local HTTP server over a real socket so the
// request line, headers, status handling and timeout path are all exercised
// end to end.

interface ServerFixture {
  baseUrl: string;
  port: number;
  requests: { url: string | undefined; authorization: string | undefined }[];
  close: () => Promise<void>;
}

/** Spins up a local HTTP server whose behaviour is chosen by the UPI ID. */
async function startFixtureServer(): Promise<ServerFixture> {
  const requests: ServerFixture["requests"] = [];

  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });

    const url = new URL(req.url ?? "", "http://localhost");
    const upiId = url.searchParams.get("upiId");

    if (upiId === "nobody@upi") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    if (upiId === "unauthorized@upi") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad key" }));
      return;
    }

    if (upiId === "boom@upi") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream down" }));
      return;
    }

    if (upiId === "slow@upi") {
      // Never respond — exercises the real timeout path.
      return;
    }

    if (upiId === "junk@upi") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("<html>not json</html>");
      return;
    }

    if (upiId === "blanket@upi") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ note: "no verification field here" }));
      return;
    }

    // Nested response shape, to prove the configurable dot paths work live.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: { isVerified: true, merchant: { displayName: "Real Vendor Store" } },
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/merchants`,
    port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let fixture: ServerFixture;

function provider(overrides: Partial<Parameters<typeof createHttpProvider>[0]> = {}) {
  return createHttpProvider({
    baseUrl: fixture.baseUrl,
    apiKey: "integration-key",
    authHeader: "Authorization",
    authScheme: "Bearer",
    upiParam: "upiId",
    verifiedPath: "data.isVerified",
    namePath: "data.merchant.displayName",
    timeoutMs: 500,
    ...overrides,
  });
}

beforeAll(async () => {
  fixture = await startFixtureServer();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(() => {
  fixture.requests.length = 0;
});

describe("merchant provider — real HTTP round trip", () => {
  it("verifies a merchant through a real request", async () => {
    const result = await provider().lookup("testmerchant@upi");

    expect(result).toEqual({
      name: "Real Vendor Store",
      upiId: "testmerchant@upi",
      verified: true,
    });

    expect(fixture.requests[0]?.url).toBe("/merchants?upiId=testmerchant%40upi");
    expect(fixture.requests[0]?.authorization).toBe("Bearer integration-key");
  });

  it("returns null for a real 404", async () => {
    await expect(provider().lookup("nobody@upi")).resolves.toBeNull();
  });

  it("throws on a real 401", async () => {
    await expect(provider().lookup("unauthorized@upi")).rejects.toMatchObject({
      code: "MERCHANT_UNAVAILABLE",
      retryable: false,
    });
  });

  it("throws a retryable error on a real 503", async () => {
    await expect(provider().lookup("boom@upi")).rejects.toMatchObject({
      code: "MERCHANT_UNAVAILABLE",
      retryable: true,
    });
  });

  it("throws when a real 200 body is not JSON", async () => {
    await expect(provider().lookup("junk@upi")).rejects.toMatchObject({
      code: "MERCHANT_BAD_RESPONSE",
    });
  });

  it("throws when a real 200 body has no verification field", async () => {
    await expect(provider().lookup("blanket@upi")).rejects.toMatchObject({
      code: "MERCHANT_BAD_RESPONSE",
    });
  });

  it("classifies a real timeout as MERCHANT_TIMEOUT", async () => {
    // Regression guard: real fetch rejects with a DOMException named
    // "TimeoutError" here, not "AbortError". Detection must not depend on
    // guessing the rejection name.
    await expect(provider({ timeoutMs: 250 }).lookup("slow@upi")).rejects.toMatchObject({
      code: "MERCHANT_TIMEOUT",
      retryable: true,
    });
  });

  it("fails closed when the server is not listening", async () => {
    // Bind a port, then release it, so the address is almost certainly free.
    const probe = await startFixtureServer();
    const deadPort = probe.port;
    await probe.close();

    const unreachable = provider({ baseUrl: `http://127.0.0.1:${deadPort}/merchants` });

    await expect(unreachable.lookup("testmerchant@upi")).rejects.toMatchObject({
      code: "MERCHANT_UNAVAILABLE",
      retryable: true,
    });
  });
});

describe("merchant cache — real round trip", () => {
  it("collapses repeated lookups into a single upstream request", async () => {
    const cached = createCachingProvider(provider(), 60_000, () => Date.now());

    const first = await cached.lookup("testmerchant@upi");
    const second = await cached.lookup("testmerchant@upi");

    expect(first).toEqual(second);
    expect(fixture.requests).toHaveLength(1);
  });

  it("refetches after the TTL expires", async () => {
    let now = 1_000;
    const cached = createCachingProvider(provider(), 5_000, () => now);

    await cached.lookup("testmerchant@upi");
    now = 20_000;
    await cached.lookup("testmerchant@upi");

    expect(fixture.requests).toHaveLength(2);
  });
});