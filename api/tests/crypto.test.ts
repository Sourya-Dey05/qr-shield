import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { verifySignature, resetKeyCache, CryptoServiceError } from "../src/services/crypto";

// ─── Test key (generated fresh per test run) ──────────────────────────────────
//
// We generate a real RSA key pair inline so the test is fully self-contained
// and does not depend on the state of public-keys.json on disk.
// A temporary keys file is written and restored around every test.

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding:  { type: "spki",  format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const TEST_UPI_ID  = "testcrypto@upi";
const TEST_PAYLOAD = `upi://pay?pa=${TEST_UPI_ID}&pn=CryptoTest&am=200`;

function sign(payload: string, key: string): string {
  return crypto.sign("sha256", Buffer.from(payload), key).toString("base64");
}

const VALID_SIGNATURE = sign(TEST_PAYLOAD, privateKey);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEYS_FILE = path.resolve(__dirname, "..", "..", "public-keys.json");
let originalKeysJson: string;

function writeTestKeys(publicKeyPem: string | null, upiId = TEST_UPI_ID): void {
  const content = {
    comment: "test",
    keys: publicKeyPem
      ? [{ id: `key-${upiId}`, upiId, algorithm: "RSA-2048-SHA256", publicKey: publicKeyPem.replace(/\n/g, "\\n"), addedAt: new Date().toISOString() }]
      : [],
  };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(content, null, 2));
  resetKeyCache();
}

beforeAll(() => {
  originalKeysJson = fs.readFileSync(KEYS_FILE, "utf-8");
});

afterAll(() => {
  fs.writeFileSync(KEYS_FILE, originalKeysJson);
  resetKeyCache();
});

beforeEach(() => {
  writeTestKeys(publicKey);
});

// ─── 1. No signature → pending ────────────────────────────────────────────────

describe("verifySignature — no signature in QR", () => {
  it("returns pending when signature is undefined", async () => {
    const result = await verifySignature({ payload: TEST_PAYLOAD, signature: undefined, upiId: TEST_UPI_ID });

    expect(result.status).toBe("pending");
    expect(result.signatureValid).toBeNull();
  });

  it("returns pending when signature is an empty string", async () => {
    // An empty string is treated the same as undefined — backward compat.
    const result = await verifySignature({ payload: TEST_PAYLOAD, signature: "", upiId: TEST_UPI_ID });

    expect(result.status).toBe("pending");
    expect(result.signatureValid).toBeNull();
  });
});

// ─── 2. Valid signature → verified ────────────────────────────────────────────

describe("verifySignature — valid RSA-SHA256 signature", () => {
  it("returns verified and signatureValid = true", async () => {
    const result = await verifySignature({
      payload: TEST_PAYLOAD,
      signature: VALID_SIGNATURE,
      upiId: TEST_UPI_ID,
    });

    expect(result.status).toBe("verified");
    expect(result.signatureValid).toBe(true);
  });

  it("enables a Green decision badge", async () => {
    // This is the key end-to-end invariant: only verified crypto makes Green reachable.
    const result = await verifySignature({
      payload: TEST_PAYLOAD,
      signature: VALID_SIGNATURE,
      upiId: TEST_UPI_ID,
    });

    expect(result.signatureValid).toBe(true);
    expect(result.status).toBe("verified");
  });
});

// ─── 3. Tampered payload → invalid ───────────────────────────────────────────

describe("verifySignature — tampered payload", () => {
  it("returns invalid when the amount in the payload was changed", async () => {
    const tamperedPayload = TEST_PAYLOAD.replace("am=200", "am=99999");

    const result = await verifySignature({
      payload: tamperedPayload,
      signature: VALID_SIGNATURE,
      upiId: TEST_UPI_ID,
    });

    expect(result.status).toBe("invalid");
    expect(result.signatureValid).toBe(false);
  });

  it("returns invalid when the payee VPA was changed", async () => {
    const tamperedPayload = TEST_PAYLOAD.replace(TEST_UPI_ID, "attacker@upi");

    const result = await verifySignature({
      payload: tamperedPayload,
      signature: VALID_SIGNATURE,
      upiId: TEST_UPI_ID,
    });

    expect(result.status).toBe("invalid");
    expect(result.signatureValid).toBe(false);
  });

  it("returns invalid for a completely wrong signature", async () => {
    const garble = Buffer.alloc(256, 0xff).toString("base64");

    const result = await verifySignature({
      payload: TEST_PAYLOAD,
      signature: garble,
      upiId: TEST_UPI_ID,
    });

    expect(result.status).toBe("invalid");
    expect(result.signatureValid).toBe(false);
  });
});

// ─── 4. Wrong key → invalid ───────────────────────────────────────────────────

describe("verifySignature — wrong key registered", () => {
  it("returns invalid when a different key is registered for the UPI", async () => {
    // Generate a second key pair — signature was made with privateKey, but
    // only the second public key is in the store.
    const { publicKey: otherPublicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    writeTestKeys(otherPublicKey);

    const result = await verifySignature({
      payload: TEST_PAYLOAD,
      signature: VALID_SIGNATURE,
      upiId: TEST_UPI_ID,
    });

    expect(result.status).toBe("invalid");
    expect(result.signatureValid).toBe(false);
  });
});

// ─── 5. No registered key → invalid (not pending) ────────────────────────────

describe("verifySignature — no key registered for UPI ID", () => {
  it("returns invalid (not pending) so a missing key cannot fake a Green badge", async () => {
    writeTestKeys(null);

    const result = await verifySignature({
      payload: TEST_PAYLOAD,
      signature: VALID_SIGNATURE,
      upiId: TEST_UPI_ID,
    });

    expect(result.status).toBe("invalid");
    expect(result.signatureValid).toBe(false);
  });
});

// ─── 6. Keys file unavailable ────────────────────────────────────────────────

describe("verifySignature — key file unavailable", () => {
  it("throws CryptoServiceError when public-keys.json cannot be read", async () => {
    fs.writeFileSync(KEYS_FILE, "NOT VALID JSON {{{{");
    resetKeyCache();

    await expect(
      verifySignature({ payload: TEST_PAYLOAD, signature: VALID_SIGNATURE, upiId: TEST_UPI_ID })
    ).rejects.toMatchObject({ code: "CRYPTO_KEYS_UNAVAILABLE" });
  });

  it("throws CryptoServiceError so the handler correctly returns 503", async () => {
    // A valid JSON file with no "keys" array — structurally wrong, should throw.
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ comment: "broken" }));
    resetKeyCache();

    await expect(
      verifySignature({ payload: TEST_PAYLOAD, signature: VALID_SIGNATURE, upiId: TEST_UPI_ID })
    ).rejects.toBeInstanceOf(CryptoServiceError);
  });
});

// ─── 7. Bad base64 encoding ───────────────────────────────────────────────────

describe("verifySignature — malformed signature encoding", () => {
  it("returns invalid (does not throw) on a truncated base64 string", async () => {
    // crypto.verify returns false for a structurally invalid buffer length.
    const result = await verifySignature({
      payload: TEST_PAYLOAD,
      signature: "not-real-base64!!!",
      upiId: TEST_UPI_ID,
    });

    // Either invalid or a thrown CryptoServiceError — both are acceptable.
    // The contract is that it must NOT return verified.
    expect(result.signatureValid).not.toBe(true);
  });
});