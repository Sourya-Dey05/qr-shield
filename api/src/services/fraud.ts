import { FraudResult } from "../types/validation";
import { config } from "../config";

// ─── Input shape ──────────────────────────────────────────────────────────────
//
// The ML service (Phase 3) will define the full feature set.
// For now we pass in only what is available at validation time.

export interface FraudInput {
  normalizedUpiId: string;
  payload: string;
  merchantVerified: boolean;
}

// ─── Provider interface ───────────────────────────────────────────────────────
//
// The ML service replaces MockFraudProvider by satisfying this interface.
// The handler only calls getFraudScore() — it never knows which provider is active.

export interface FraudProvider {
  score(input: FraudInput): Promise<FraudResult>;
}

// ─── Mock provider ────────────────────────────────────────────────────────────
//
// Deterministic rules based on the UPI ID so tests are stable.
// Source is always "mock" — never present these scores as ML output.

const mockProvider: FraudProvider = {
  async score(input): Promise<FraudResult> {
    await Promise.resolve();

    // High-risk signals: the word "suspicious" in the UPI ID,
    // or an unverified merchant.
    const isHighRisk =
      input.normalizedUpiId.includes("suspicious") ||
      !input.merchantVerified;

    if (isHighRisk) {
      return { riskScore: 85, riskLevel: "high", source: "mock" };
    }

    // Medium-risk signal: unknown/generic patterns.
    const isMediumRisk = input.normalizedUpiId.includes("unknown");
    if (isMediumRisk) {
      return { riskScore: 50, riskLevel: "medium", source: "mock" };
    }

    // Known, verified merchant with no suspicious signals → low risk.
    return { riskScore: 15, riskLevel: "low", source: "mock" };
  },
};

// ─── ML provider placeholder ──────────────────────────────────────────────────
//
// Phase 3 integration point.
//
// The ML service exposes:
//   POST <ML_SERVICE_URL>/predict
//   Body:  { features: FraudInput }
//   Reply: { fraudProbability, riskScore, riskLevel, modelVersion }
//
// Replace this stub to activate the live ML service.
// The rest of the backend does not change.

function createMlProvider(serviceUrl: string, apiKey: string): FraudProvider {
  return {
    async score(input): Promise<FraudResult> {
      // TODO (Phase 3): send features to the ML prediction service.
      // Example:
      //   const res = await fetch(`${serviceUrl}/predict`, {
      //     method: "POST",
      //     headers: {
      //       "Content-Type": "application/json",
      //       Authorization: `Bearer ${apiKey}`,
      //     },
      //     body: JSON.stringify({ features: input }),
      //   });
      //   if (!res.ok) throw new Error("ML service error");
      //   const data = await res.json();
      //   return { riskScore: data.riskScore, riskLevel: data.riskLevel, source: "ml-v1" };
      void serviceUrl;
      void apiKey;
      void input;
      throw new Error("ML fraud provider is not yet implemented");
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getProvider(): FraudProvider {
  if (config.mlServiceUrl) {
    return createMlProvider(config.mlServiceUrl, config.mlServiceApiKey);
  }
  return mockProvider;
}

/**
 * Returns a fraud risk assessment for the given input.
 *
 * In Phase 1 this always returns a mock result.
 * In Phase 3 this will call the live ML service when ML_SERVICE_URL is set.
 * Throws if the active provider fails (caller handles this as a 503).
 */
export async function getFraudScore(
  input: FraudInput,
  provider: FraudProvider = getProvider()
): Promise<FraudResult> {
  return provider.score(input);
}
