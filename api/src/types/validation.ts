// All shared TypeScript types for the validation API.
// These types form the stable contract between the frontend, backend,
// and the future ML/crypto services.

// ─── Request ────────────────────────────────────────────────────────────────

export interface ValidateRequest {
  /** UPI VPA, e.g. "merchant@upi" */
  upiId: string;
  /** Raw QR payload string as decoded from the QR code */
  payload: string;
  /** Optional: cryptographic signature embedded in the QR — verified in Phase 4 */
  signature?: string;
}

// ─── Sub-response shapes ─────────────────────────────────────────────────────

export interface MerchantResult {
  name: string;
  upiId: string;
  /** true only when the merchant was confirmed by a real verification provider */
  verified: boolean;
}

export type RiskLevel = "low" | "medium" | "high";

export interface FraudResult {
  riskScore: number;   // 0–100
  riskLevel: RiskLevel;
  /**
   * Identifies the fraud data source.
   * "mock"   → deterministic mock used in Phase 1 (not a real ML prediction)
   * "ml-v1"  → live ML service (Phase 3+)
   */
  source: "mock" | "ml-v1";
}

export type SecurityStatus = "verified" | "invalid" | "pending";

export interface SecurityResult {
  /**
   * null until Phase 4 implements cryptographic verification.
   * The decision engine treats null as "unverified" and will not issue a green badge.
   */
  signatureValid: boolean | null;
  status: SecurityStatus;
  reason: string;
}

export type TrustBadge = "green" | "amber" | "red";

export interface DecisionResult {
  badge: TrustBadge;
  reason: string;
}

// ─── Top-level response ───────────────────────────────────────────────────────

export interface ValidateResponse {
  success: true;
  merchant: MerchantResult;
  fraud: FraudResult;
  security: SecurityResult;
  decision: DecisionResult;
}

// ─── Error response ───────────────────────────────────────────────────────────

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
