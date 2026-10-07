/**
 * Key generation and test signing utility for Phase 4 development.
 *
 * Generates an RSA key pair, writes the public key into public-keys.json,
 * and prints a signed test payload so the crypto service can be tested
 * end-to-end without a real UPI provider.
 *
 * Usage:
 *   npx tsx tools/generate-keys.ts [upiId]
 *   npx tsx tools/generate-keys.ts testmerchant@upi
 *
 * Output:
 *   - public-keys.json  (updated at project root)
 *   - Private key PEM printed to stdout — SAVE IT SOMEWHERE SAFE
 *   - A signed test payload printed to stdout for integration testing
 *
 * ⚠ THIS IS A DEV TOOL. Private keys printed here are for local testing only.
 *   Never use these keys in production. Never commit the private key.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const upiId = process.argv[2] ?? "testmerchant@upi";
const testPayload = `upi://pay?pa=${upiId}&pn=Test%20Merchant&am=100`;

// Generate an RSA-2048 key pair (industry standard for UPI-scale verification)
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding:  { type: "spki",  format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Sign the test payload with SHA-256
const signature = crypto
  .sign("sha256", Buffer.from(testPayload), privateKey)
  .toString("base64");

// Path to the shared public-keys.json at the repo root
const keysFilePath = path.resolve(__dirname, "..", "..", "public-keys.json");

interface PublicKeyEntry {
  id: string;
  upiId: string;
  algorithm: string;
  publicKey: string;
  addedAt: string;
}

interface PublicKeysFile {
  comment: string;
  keys: PublicKeyEntry[];
}

// Load existing keys and replace or append the entry for this upiId
const existing: PublicKeysFile = JSON.parse(fs.readFileSync(keysFilePath, "utf-8"));

const newEntry: PublicKeyEntry = {
  id: `key-${upiId}`,
  upiId,
  algorithm: "RSA-2048-SHA256",
  publicKey: publicKey.replace(/\n/g, "\\n"),
  addedAt: new Date().toISOString(),
};

existing.keys = existing.keys.filter((k: PublicKeyEntry) => k.upiId !== upiId);
existing.keys.push(newEntry);
existing.comment = "Public keys used for QR signature verification (Phase 4).";

fs.writeFileSync(keysFilePath, JSON.stringify(existing, null, 2));

// eslint-disable-next-line no-console
console.log(`\n=== PHASE 4 KEY GENERATION ===`);
// eslint-disable-next-line no-console
console.log(`\nUPI ID:  ${upiId}`);
// eslint-disable-next-line no-console
console.log(`\nPRIVATE KEY (keep safe, never commit):
${privateKey}`);
// eslint-disable-next-line no-console
console.log(`\nTest payload:
  ${testPayload}`);
// eslint-disable-next-line no-console
console.log(`\nSignature (base64, for testing):
  ${signature}`);
// eslint-disable-next-line no-console
console.log(`\npublic-keys.json updated at: ${keysFilePath}`);
// eslint-disable-next-line no-console
console.log(`\nEnd-to-end test call:
  curl -X POST http://localhost:3001/api/validate \\
    -H "Content-Type: application/json" \\
    -d '{
      "upiId": "${upiId}",
      "payload": "${testPayload}",
      "signature": "${signature}"
    }'`);