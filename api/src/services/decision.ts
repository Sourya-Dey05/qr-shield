import {
  MerchantResult,
  FraudResult,
  SecurityResult,
  DecisionResult,
  TrustBadge,
} from "../types/validation";

// ─── Decision engine ──────────────────────────────────────────────────────────
//
// Combines merchant, fraud and security signals into a single trust badge.
//
// Rules are explicit and configurable here rather than scattered through the handler.
// When Phase 3 (ML) and Phase 4 (crypto) are complete, adjust the rules below
// without touching any other file.
//
// Current Phase 1 rules:
//
//   RED   → high fraud risk  OR  merchant not verified
//   AMBER → medium fraud risk  OR  security pending  OR  merchant unverified but low fraud
//   GREEN → merchant verified AND low fraud AND signature verified
//
// GREEN is intentionally unreachable in Phase 1 because signatureValid is always null.
// This is correct — we do not claim a QR is fully safe without crypto verification.

// Risk thresholds. Adjust here when the ML team finalises their scoring.
const RISK_THRESHOLDS = {
  high: 70,   // riskScore >= 70 → high
  medium: 30, // riskScore >= 30 → medium
              // riskScore <  30 → low
} as const;

function resolvedRiskLevel(riskScore: number): "low" | "medium" | "high" {
  if (riskScore >= RISK_THRESHOLDS.high) return "high";
  if (riskScore >= RISK_THRESHOLDS.medium) return "medium";
  return "low";
}

export function makeDecision(
  merchant: MerchantResult,
  fraud: FraudResult,
  security: SecurityResult
): DecisionResult {
  const riskLevel = resolvedRiskLevel(fraud.riskScore);

  // ── RED ──────────────────────────────────────────────────────────────────
  if (security.signatureValid === false) {
    return badge("red", "Invalid cryptographic signature — do not proceed");
  }

  if (riskLevel === "high") {
    return badge("red", "High fraud risk detected");
  }

  if (!merchant.verified && riskLevel !== "low") {
    return badge("red", "Merchant is not verified and fraud risk is elevated");
  }

  // ── AMBER ─────────────────────────────────────────────────────────────────
  if (security.status === "pending") {
    // Security check is not yet implemented — we cannot issue green.
    if (riskLevel === "low" && merchant.verified) {
      return badge(
        "amber",
        "Merchant verified and low fraud risk, but signature verification is pending (Phase 4)"
      );
    }
    return badge("amber", "Security verification is pending");
  }

  if (riskLevel === "medium") {
    return badge("amber", "Medium fraud risk — proceed with caution");
  }

  if (!merchant.verified) {
    return badge("amber", "Merchant could not be verified");
  }

  // ── GREEN ─────────────────────────────────────────────────────────────────
  // Requires: verified merchant + low fraud + valid signature.
  if (merchant.verified && riskLevel === "low" && security.signatureValid === true) {
    return badge("green", "Merchant verified, low fraud risk, valid signature");
  }

  // Fallback — should not be reached with the rules above, but is safer than crashing.
  return badge("amber", "Could not determine a confident trust level");
}

function badge(level: TrustBadge, reason: string): DecisionResult {
  return { badge: level, reason };
}
