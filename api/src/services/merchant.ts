import { MerchantResult } from "../types/validation";
import { config } from "../config";

// ─── Provider interface ───────────────────────────────────────────────────────
//
// When a real NPCI/merchant verification API becomes available,
// create a new object that satisfies this interface and pass it to getMerchant().
// The handler does not need to change.

export interface MerchantProvider {
  lookup(normalizedUpiId: string): Promise<MerchantResult | null>;
}

// ─── Mock provider ────────────────────────────────────────────────────────────
//
// Used when NPCI_API_KEY is not configured.
// Returns deterministic results so tests are reliable.
// Do not present this data as coming from a real NPCI source.

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

// ─── Real provider placeholder ────────────────────────────────────────────────
//
// Replace this stub with an actual HTTP call to the merchant verification API.
// The provider must satisfy MerchantProvider so no other code needs to change.

function createRealProvider(_apiKey: string): MerchantProvider {
  return {
    async lookup(_normalizedUpiId) {
      // TODO (Phase 2): call the real merchant verification API here.
      // Example:
      //   const response = await fetch(`${NPCI_BASE_URL}/merchant?vpa=${normalizedUpiId}`, {
      //     headers: { Authorization: `Bearer ${_apiKey}` },
      //   });
      //   if (!response.ok) throw new Error("Merchant API error");
      //   return await response.json();
      throw new Error("Real merchant provider is not yet implemented");
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getProvider(): MerchantProvider {
  if (config.npciApiKey) {
    return createRealProvider(config.npciApiKey);
  }
  return mockProvider;
}

/**
 * Looks up a merchant by normalized UPI ID.
 *
 * Returns null if the merchant is unknown.
 * Throws if the provider itself fails (caller handles this as a 503).
 */
export async function getMerchant(
  normalizedUpiId: string,
  provider: MerchantProvider = getProvider()
): Promise<MerchantResult | null> {
  return provider.lookup(normalizedUpiId);
}
