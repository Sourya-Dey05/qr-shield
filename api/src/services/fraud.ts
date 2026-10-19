import { FraudResult } from "../types/validation";
import { config } from "../config";

export interface FraudInput {
  normalizedUpiId: string;
  payload: string;
  merchantVerified: boolean;
}

export interface FraudProvider {
  score(input: FraudInput): Promise<FraudResult>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type FraudProviderErrorCode =
  | "FRAUD_CONFIG_ERROR"
  | "FRAUD_UNAVAILABLE"
  | "FRAUD_TIMEOUT"
  | "FRAUD_BAD_RESPONSE";

export class FraudProviderError extends Error {
  readonly code: FraudProviderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: FraudProviderErrorCode,
    message: string,
    retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "FraudProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

// ─── Mock provider ────────────────────────────────────────────────────────────

const mockProvider: FraudProvider = {
  async score(input): Promise<FraudResult> {
    await Promise.resolve();

    const isHighRisk =
      input.normalizedUpiId.includes("suspicious") ||
      !input.merchantVerified;

    if (isHighRisk) {
      return { riskScore: 85, riskLevel: "high", source: "mock" };
    }

    const isMediumRisk = input.normalizedUpiId.includes("unknown");
    if (isMediumRisk) {
      return { riskScore: 50, riskLevel: "medium", source: "mock" };
    }

    return { riskScore: 15, riskLevel: "low", source: "mock" };
  },
};

// ─── ML provider (Phase 3) ──────────────────────────────────────────────────

export interface MlFraudProviderOptions {
  serviceUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export function createMlProvider(options: MlFraudProviderOptions): FraudProvider {
  return {
    async score(input: FraudInput): Promise<FraudResult> {
      const signal = AbortSignal.timeout(options.timeoutMs);

      let response: Response;
      try {
        response = await fetch(`${options.serviceUrl}/predict`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({ features: input }),
          signal,
        });
      } catch (error) {
        throw new FraudProviderError(
          (error as { name?: string }).name === "TimeoutError" ? "FRAUD_TIMEOUT" : "FRAUD_UNAVAILABLE",
          "ML Fraud service request failed",
          true,
          { cause: error }
        );
      }

      if (!response.ok) {
        throw new FraudProviderError("FRAUD_UNAVAILABLE", `ML service returned ${response.status}`, true);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        throw new FraudProviderError("FRAUD_BAD_RESPONSE", "ML response not valid JSON", false, { cause: error });
      }

      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as Record<string, unknown>).riskScore !== "number" ||
        typeof (data as Record<string, unknown>).riskLevel !== "string"
      ) {
        throw new FraudProviderError("FRAUD_BAD_RESPONSE", "ML response missing required fields", false);
      }

      const riskScore = (data as Record<string, unknown>).riskScore as number;
      const riskLevel = (data as Record<string, unknown>).riskLevel as "low" | "medium" | "high";

      return {
        riskScore,
        riskLevel,
        source: "ml-v1",
      };
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getProvider(): FraudProvider {
  if (config.mlServiceUrl) {
    return createMlProvider({
      serviceUrl: config.mlServiceUrl,
      apiKey: config.mlServiceApiKey,
      timeoutMs: 5000, // Configurable in config.ts if needed
    });
  }
  return mockProvider;
}

export async function getFraudScore(
  input: FraudInput,
  provider: FraudProvider = getProvider()
): Promise<FraudResult> {
  return provider.score(input);
}
