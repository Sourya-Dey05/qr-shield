// ─── Phase 2 demo driver ─────────────────────────────────────────────────────
//
// Sends a series of requests to a RUNNING QR-Shield API and prints the badge
// each one produces, so the real HTTP merchant provider can be demonstrated
// end to end without manual curl calls.
//
// Prereqs, in two terminals:
//   npm run stub     ← terminal 1, the fake verification provider
//   npm run dev      ← terminal 2, the API
//   npm run demo     ← this script
//
// This prints FIXTURE data. A badge here is not a real safety judgement.

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3001";

interface DemoCase {
  label: string;
  upiId: string;
  /** What this case is meant to prove. */
  expect: string;
}

const CASES: DemoCase[] = [
  {
    label: "Verified merchant, low risk",
    upiId: "testmerchant@upi",
    expect: "200 amber — signature check still pending (Phase 4)",
  },
  {
    label: "Verified merchant (second provider fixture)",
    upiId: "grocery@okhdfc",
    expect: "200 amber",
  },
  {
    label: "Known but unverified merchant",
    upiId: "suspicious@upi",
    expect: "200 red — high fraud risk",
  },
  {
    label: "Merchant the provider does not know",
    upiId: "nobody@upi",
    expect: "404 UNKNOWN_MERCHANT — provider replied 404",
  },
  {
    label: "Provider returns 503",
    upiId: "stub-down@upi",
    expect: "503 — must NOT be reported as unverified",
  },
  {
    label: "Provider returns 401 (bad key)",
    upiId: "stub-unauth@upi",
    expect: "503 — credentials rejected upstream",
  },
  {
    label: "Provider returns 429",
    upiId: "stub-ratelimit@upi",
    expect: "503",
  },
  {
    label: "Provider stalls past the timeout",
    upiId: "stub-slow@upi",
    expect: "503 after MERCHANT_TIMEOUT_MS",
  },
  {
    label: "Provider returns a non-JSON body",
    upiId: "stub-garbage@upi",
    expect: "503",
  },
  {
    label: "Provider 200 with no verification field",
    upiId: "stub-nofield@upi",
    expect: "503 — must NOT be read as verified=false",
  },
  {
    label: "Missing upiId",
    upiId: "",
    expect: "400 MISSING_UPI_ID",
  },
];

function badgeIcon(badge: string | undefined): string {
  if (badge === "green") return "GREEN";
  if (badge === "amber") return "AMBER";
  if (badge === "red") return "RED";
  return "—";
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nDriving ${BASE_URL}/api/validate\n`);

  // Confirm the API is up before blaming a scenario result on it.
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    if (!health.ok) throw new Error(`health returned HTTP ${health.status}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `Cannot reach the API at ${BASE_URL} (${(error as Error).message}).\n` +
        "Start it with: npm run dev\n"
    );
    process.exit(1);
  }

  let failures = 0;

  for (const testCase of CASES) {
    const body = testCase.upiId
      ? { upiId: testCase.upiId, payload: `upi://pay?pa=${encodeURIComponent(testCase.upiId)}` }
      : { payload: "upi://pay?pa=testmerchant@upi" };

    try {
      const res = await fetch(`${BASE_URL}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: { code: string };
        merchant?: { name: string; verified: boolean };
        fraud?: { riskLevel: string; source: string };
        decision?: { badge: string; reason: string };
      };

      if (json.success) {
        // eslint-disable-next-line no-console
        console.log(
          `${badgeIcon(json.decision?.badge).padEnd(6)} ${testCase.label}\n` +
            `       upiId: ${testCase.upiId} → "${json.merchant?.name}" ` +
            `(verified=${json.merchant?.verified}, risk=${json.fraud?.riskLevel}/${json.fraud?.source})\n` +
            `       ${json.decision?.reason}\n` +
            `       expected: ${testCase.expect}\n`
        );
        continue;
      }

      const code = json.error?.code ?? "?";

      // Fail-closed scenarios must surface as 503, never as a 200 with an
      // unverified merchant — that would quietly downgrade a Red badge.
      if (code === "MERCHANT_SERVICE_ERROR" && res.status !== 503) {
        failures += 1;
        // eslint-disable-next-line no-console
        console.error(
          `       !! fail-closed violation: expected 503, got HTTP ${res.status}`
        );
      }

      // eslint-disable-next-line no-console
      console.log(
        `${String(res.status).padEnd(6)} ${testCase.label}\n` +
          `       upiId: ${testCase.upiId} → ${code}\n` +
          `       expected: ${testCase.expect}\n`
      );
    } catch (error) {
      failures += 1;
      // eslint-disable-next-line no-console
      console.error(`ERR    ${testCase.label}: ${(error as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    "────────────────────────────────────────────────────────────\n" +
      "Reminder: these are FIXTURES from the stub provider, not real\n" +
      "verification. Do not present these badges as safety judgements.\n"
  );

  if (failures > 0) {
    // eslint-disable-next-line no-console
    console.error(`${failures} scenario(s) returned an unexpected result.`);
    process.exit(1);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});