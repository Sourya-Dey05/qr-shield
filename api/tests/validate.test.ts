import request from "supertest";
import app from "../src/app";
import * as merchantService from "../src/services/merchant";
import * as fraudService from "../src/services/fraud";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_BODY = {
  upiId: "testmerchant@upi",
  payload: "upi://pay?pa=testmerchant@upi&pn=TestMerchant",
};

// ─── 1. Valid request — full happy path ───────────────────────────────────────

describe("POST /api/validate — valid request", () => {
  it("returns 200 with the expected response shape", async () => {
    const res = await request(app).post("/api/validate").send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Merchant
    expect(res.body.merchant.upiId).toBe("testmerchant@upi");
    expect(res.body.merchant.verified).toBe(true);

    // Fraud — mock source, deterministic score
    expect(res.body.fraud.source).toBe("mock");
    expect(typeof res.body.fraud.riskScore).toBe("number");
    expect(["low", "medium", "high"]).toContain(res.body.fraud.riskLevel);

    // Security — always pending in Phase 1
    expect(res.body.security.status).toBe("pending");
    expect(res.body.security.signatureValid).toBeNull();

    // Decision
    expect(["green", "amber", "red"]).toContain(res.body.decision.badge);
    expect(typeof res.body.decision.reason).toBe("string");
  });
});

// ─── 2. Missing UPI ID ────────────────────────────────────────────────────────

describe("POST /api/validate — missing upiId", () => {
  it("returns 400 with MISSING_UPI_ID", async () => {
    const res = await request(app)
      .post("/api/validate")
      .send({ payload: "some-payload" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MISSING_UPI_ID");
  });
});

// ─── 3. Invalid UPI ID format ─────────────────────────────────────────────────

describe("POST /api/validate — invalid upiId format", () => {
  it("returns 400 with INVALID_UPI_ID for a bad format", async () => {
    const res = await request(app)
      .post("/api/validate")
      .send({ upiId: "not-a-valid-upi", payload: "some-payload" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_UPI_ID");
  });
});

// ─── 4. Missing payload ───────────────────────────────────────────────────────

describe("POST /api/validate — missing payload", () => {
  it("returns 400 with MISSING_PAYLOAD", async () => {
    const res = await request(app)
      .post("/api/validate")
      .send({ upiId: "testmerchant@upi" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_PAYLOAD");
  });
});

// ─── 5. Known merchant ────────────────────────────────────────────────────────

describe("POST /api/validate — known verified merchant", () => {
  it("returns merchant.verified = true for testmerchant@upi", async () => {
    const res = await request(app).post("/api/validate").send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.merchant.verified).toBe(true);
    expect(res.body.merchant.name).toBe("Test Merchant");
  });
});

// ─── 6. Unknown merchant ─────────────────────────────────────────────────────

describe("POST /api/validate — unknown merchant", () => {
  it("returns 404 with UNKNOWN_MERCHANT", async () => {
    const res = await request(app)
      .post("/api/validate")
      .send({ upiId: "nobody@upi", payload: "some-payload" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_MERCHANT");
  });
});

// ─── 7. Merchant service failure ─────────────────────────────────────────────

describe("POST /api/validate — merchant service failure", () => {
  it("returns 503 with MERCHANT_SERVICE_ERROR", async () => {
    jest.spyOn(merchantService, "getMerchant").mockRejectedValueOnce(
      new Error("DB connection failed")
    );

    const res = await request(app).post("/api/validate").send(VALID_BODY);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("MERCHANT_SERVICE_ERROR");

    jest.restoreAllMocks();
  });
});

// ─── 8. Low-risk mock fraud result ───────────────────────────────────────────

describe("POST /api/validate — low-risk mock fraud", () => {
  it("returns riskLevel low and source mock for a known good merchant", async () => {
    const res = await request(app).post("/api/validate").send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.fraud.riskLevel).toBe("low");
    expect(res.body.fraud.source).toBe("mock");
  });
});

// ─── 9. High-risk mock fraud result ──────────────────────────────────────────

describe("POST /api/validate — high-risk mock fraud", () => {
  it("returns riskLevel high and badge red for suspicious@upi", async () => {
    const res = await request(app)
      .post("/api/validate")
      .send({ upiId: "suspicious@upi", payload: "some-payload" });

    expect(res.status).toBe(200);
    expect(res.body.fraud.riskLevel).toBe("high");
    expect(res.body.fraud.source).toBe("mock");
    expect(res.body.decision.badge).toBe("red");
  });
});

// ─── 10. Fraud service failure ────────────────────────────────────────────────

describe("POST /api/validate — fraud service failure", () => {
  it("returns 503 with FRAUD_SERVICE_ERROR", async () => {
    jest.spyOn(fraudService, "getFraudScore").mockRejectedValueOnce(
      new Error("ML service timeout")
    );

    const res = await request(app).post("/api/validate").send(VALID_BODY);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("FRAUD_SERVICE_ERROR");

    jest.restoreAllMocks();
  });
});

// ─── 11. Security status is always pending in Phase 1 ────────────────────────

describe("POST /api/validate — security pending", () => {
  it("always returns security.status = pending in Phase 1", async () => {
    const res = await request(app).post("/api/validate").send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.security.status).toBe("pending");
    expect(res.body.security.signatureValid).toBeNull();
  });
});

// ─── 12. Unexpected internal error ───────────────────────────────────────────

describe("POST /api/validate — unexpected internal error", () => {
  it("returns 503 if an unexpected error reaches the handler from a service", async () => {
    // Simulate a completely unexpected throw from the merchant service.
    jest.spyOn(merchantService, "getMerchant").mockImplementationOnce(() => {
      throw new Error("Unexpected crash");
    });

    const res = await request(app).post("/api/validate").send(VALID_BODY);

    // Handler catches service throws — should return a 503, not a 500 crash.
    expect([503, 500]).toContain(res.status);
    expect(res.body.success).toBe(false);

    jest.restoreAllMocks();
  });
});
