import { Request, Response } from "express";
import { ValidateRequest, ValidateResponse, ErrorResponse } from "../types/validation";
import { isValidUpiId, isValidPayload, normalizeUpiId } from "../utils/upi";
import { getMerchant } from "../services/merchant";
import { getFraudScore } from "../services/fraud";
import { verifySignature } from "../services/crypto";
import { makeDecision } from "../services/decision";

// The handler's only job is to orchestrate services and return a response.
// Business logic lives in the individual services, not here.

export async function validateHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = req.body as Partial<ValidateRequest>;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!body.upiId || typeof body.upiId !== "string") {
    sendError(res, 400, "MISSING_UPI_ID", "upiId is required");
    return;
  }

  if (!body.payload || typeof body.payload !== "string") {
    sendError(res, 400, "MISSING_PAYLOAD", "payload is required");
    return;
  }

  if (!isValidUpiId(body.upiId)) {
    sendError(res, 400, "INVALID_UPI_ID", "upiId format is invalid");
    return;
  }

  if (!isValidPayload(body.payload)) {
    sendError(res, 400, "INVALID_PAYLOAD", "payload must be a non-empty string");
    return;
  }

  const normalizedUpiId = normalizeUpiId(body.upiId);

  // ── Merchant lookup ───────────────────────────────────────────────────────
  let merchant;
  try {
    merchant = await getMerchant(normalizedUpiId);
  } catch (error) {
    // Fail closed: we could not confirm the merchant, so we must not report a
    // trust badge. The specific cause is logged, never returned to the client.
    logServiceError("merchant", normalizedUpiId, error);
    sendError(res, 503, "MERCHANT_SERVICE_ERROR", "Merchant service is unavailable");
    return;
  }

  if (!merchant) {
    sendError(res, 404, "UNKNOWN_MERCHANT", "Merchant not found for this UPI ID");
    return;
  }

  // ── Fraud assessment ──────────────────────────────────────────────────────
  let fraud;
  try {
    fraud = await getFraudScore({
      normalizedUpiId,
      payload: body.payload,
      merchantVerified: merchant.verified,
    });
  } catch (error) {
    logServiceError("fraud", normalizedUpiId, error);
    sendError(res, 503, "FRAUD_SERVICE_ERROR", "Fraud service is unavailable");
    return;
  }

  // ── Security / crypto ─────────────────────────────────────────────────────
  let security;
  try {
    security = await verifySignature({
      payload: body.payload,
      signature: body.signature,
      upiId: normalizedUpiId,
    });
  } catch (error) {
    logServiceError("crypto", normalizedUpiId, error);
    sendError(res, 503, "SECURITY_SERVICE_ERROR", "Security service is unavailable");
    return;
  }

  // ── Decision ──────────────────────────────────────────────────────────────
  const decision = makeDecision(merchant, fraud, security);

  const response: ValidateResponse = {
    success: true,
    merchant,
    fraud,
    security,
    decision,
  };

  res.status(200).json(response);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function logServiceError(service: string, upiId: string, error: unknown): void {
  // MerchantProviderError carries a code and a retryable flag. Other throws are
  // unexpected, so log the name and message to get something to search on.
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "UNEXPECTED";

  // eslint-disable-next-line no-console
  console.error(`[${service}] upiId=${upiId} code=${code} ${detail}`);
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  const body: ErrorResponse = { success: false, error: { code, message } };
  res.status(status).json(body);
}
