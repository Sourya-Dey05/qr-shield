// ─── Local stub merchant verification server (development only) ──────────────
//
// WHY THIS EXISTS
// Phase 2 ships a real HTTP merchant provider, but there are no vendor
// credentials yet, so nothing in the real code path would ever run. This
// server stands in for the vendor so the real provider is genuinely
// exercised end to end: real sockets, real bearer auth, real nested JSON,
// real 404s, real 5xx, real timeouts.
//
// THIS IS NOT VERIFICATION.
// Every response is a fixture. A Green or Amber badge produced against this
// server tells you nothing about a real merchant. Never point a demo at it
// and present the result as a safety judgement.
//
// It deliberately returns a NESTED body (data.isVerified) rather than the
// flat { verified } shape the backend also supports, so the configurable
// dot-path mapping in .env is exercised rather than bypassed.
//
// ─── Usage ───────────────────────────────────────────────────────────────────
//   npm run stub
//
// Then point api/.env at it (see .env.stub.example).

import http from "node:http";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = Number.parseInt(process.env.STUB_PORT ?? "4010", 10);
const API_KEY = process.env.STUB_API_KEY ?? "stub-dev-key";

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Keyed by normalized UPI ID. `verified: false` models a merchant the
// provider knows about but could not confirm.

interface Fixture {
  verified: boolean;
  name: string;
}

const FIXTURES: Record<string, Fixture> = {
  // Verified merchants — low fraud risk, Amber badge (crypto still pending).
  "testmerchant@upi": { verified: true, name: "Test Merchant" },
  "verified@hdfc": { verified: true, name: "HDFC Verified Store" },
  "coffee.bar@okaxis": { verified: true, name: "Coffee Bar" },
  "grocery@okhdfc": { verified: true, name: "Daily Grocer" },

  // Known but NOT verified — models a merchant that exists but failed checks.
  "suspicious@upi": { verified: false, name: "Suspicious Merchant" },

  // Not in the fixture table at all → server replies 404 → API replies
  // 404 UNKNOWN_MERCHANT. Try: nobody@upi
};

// ─── Behaviour triggers ──────────────────────────────────────────────────────
//
// Special UPI IDs let us demonstrate the fail-closed paths without editing
// code. These are looked up before the fixture table.

interface Behaviour {
  status: number;
  /** Milliseconds to stall before replying. Used to demo the timeout path. */
  delayMs?: number;
  /** Send a body that is not JSON at all. */
  garbage?: boolean;
}

function behaviourFor(upiId: string): Behaviour | undefined {
  if (upiId.startsWith("stub-down")) return { status: 503 };
  if (upiId.startsWith("stub-unauth")) return { status: 401 };
  if (upiId.startsWith("stub-ratelimit")) return { status: 429 };
  if (upiId.startsWith("stub-slow")) return { status: 200, delayMs: 60_000 };
  if (upiId.startsWith("stub-garbage")) return { status: 200, garbage: true };
  // A 200 with no verification field at all — the provider must NOT treat
  // this as "unverified", it must fail closed.
  if (upiId.startsWith("stub-nofield")) return { status: 200 };
  return undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Console output is the point of this stub — it is a developer-facing tool. */
function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[stub-merchant] ${message}`);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const upiId = (url.searchParams.get("upiId") ?? "").trim().toLowerCase();

  // Realistic auth check, so a missing key is visibly a 401 rather than a
  // silent success.
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${API_KEY}`) {
    log(`401 (bad key) ${upiId || "<no upiId>"}`);
    sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
    return;
  }

  log(`${req.method} ${req.url}`);

  const forced = behaviourFor(upiId);
  if (forced) {
    const reply = (): void => {
      if (forced.garbage) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("<html><body>gateway says hi</body></html>");
        return;
      }
      if (upiId.startsWith("stub-nofield")) {
        sendJson(res, 200, { data: { merchantName: "Nameless Corp" } });
        return;
      }
      sendJson(res, forced.status, {
        error: { code: `HTTP_${forced.status}`, message: "Stub failure for demonstration" },
      });
    };

    if (forced.delayMs) {
      log(`stalling ${forced.delayMs}ms for ${upiId} (will trigger the API timeout)`);
      setTimeout(reply, forced.delayMs);
      return;
    }
    log(`${forced.status} for ${upiId}`);
    reply();
    return;
  }

  if (!upiId) {
    sendJson(res, 400, { error: { code: "MISSING_UPI_ID", message: "upiId is required" } });
    return;
  }

  const fixture = FIXTURES[upiId];
  if (!fixture) {
    log(`404 for ${upiId}`);
    sendJson(res, 404, { error: { code: "MERCHANT_NOT_FOUND", message: "No such UPI ID" } });
    return;
  }

  log(`200 verified=${fixture.verified} for ${upiId}`);
  // Nested on purpose — matches a realistic vendor envelope.
  sendJson(res, 200, {
    requestId: `stub-${Date.now()}`,
    data: {
      isVerified: fixture.verified,
      merchant: { displayName: fixture.name },
      // Present but unused, to confirm dot-path mapping picks the right field.
      legacyVerified: !fixture.verified,
    },
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`merchant verification stub listening on http://127.0.0.1:${PORT}`);
  log(`expects: Authorization: Bearer ${API_KEY}`);
  log("─────────────────────────────────────────────────────────");
  log("VERIFIED (verified=true):");
  for (const [id, f] of Object.entries(FIXTURES)) {
    if (f.verified) log(`  ${id.padEnd(24)} ${f.name}`);
  }
  log("UNVERIFIED (verified=false):");
  for (const [id, f] of Object.entries(FIXTURES)) {
    if (!f.verified) log(`  ${id.padEnd(24)} ${f.name}`);
  }
  log("UNKNOWN → 404:        anyone else, e.g. nobody@upi");
  log("FAIL-CLOSED demos:    stub-down@upi  stub-unauth@upi");
  log("                      stub-ratelimit@upi  stub-slow@upi");
  log("                      stub-garbage@upi  stub-nofield@upi");
  log("─────────────────────────────────────────────────────────");
  log("FIXTURES ONLY — not real merchant verification");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("shutting down");
    server.close(() => process.exit(0));
  });
}

// Declared for consumers that start this server in-process during tests.
export type StubServer = http.Server;
export { FIXTURES, server };