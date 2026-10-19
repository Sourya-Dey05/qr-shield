# QR-Shield API Specification

**Version**: Phase 1  
**Base URL** (local): `http://localhost:3001`

---

## Endpoints

### `GET /api/health`

Health check. Returns `200 { "status": "ok" }`.

---

### `POST /api/validate`

Validates a UPI QR code. Returns merchant information, fraud risk assessment, security status, and a final trust badge.

#### Request

```http
POST /api/validate
Content-Type: application/json
```

```json
{
  "upiId": "merchant@upi",
  "payload": "upi://pay?pa=merchant@upi&pn=MerchantName&am=100",
  "signature": "base64-encoded-signature-optional"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `upiId` | string | ✅ | UPI Virtual Payment Address (VPA). Format: `localpart@provider` |
| `payload` | string | ✅ | Raw QR code payload string as decoded by the scanner |
| `signature` | string | ❌ | Cryptographic signature embedded in the QR. Verified in Phase 4. |

#### Response — 200 OK

```json
{
  "success": true,
  "merchant": {
    "name": "Test Merchant",
    "upiId": "testmerchant@upi",
    "verified": true
  },
  "fraud": {
    "riskScore": 15,
    "riskLevel": "low",
    "source": "mock"
  },
  "security": {
    "signatureValid": null,
    "status": "pending",
    "reason": "Cryptographic verification is not yet implemented (Phase 4)"
  },
  "decision": {
    "badge": "amber",
    "reason": "Merchant verified and low fraud risk, but signature verification is pending (Phase 4)"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `merchant.verified` | boolean | `true` only when confirmed by a real verification provider |
| `fraud.riskScore` | number | 0–100 |
| `fraud.riskLevel` | `"low"` \| `"medium"` \| `"high"` | |
| `fraud.source` | `"mock"` \| `"ml-v1"` | `"mock"` unless `ML_SERVICE_URL` is set (Phase 3) |
| `security.signatureValid` | boolean \| null | `null` only when the QR carried **no** signature (`status: "pending"`) |
| `security.status` | `"verified"` \| `"invalid"` \| `"pending"` | `"verified"` requires a valid RSA-SHA256 signature (Phase 4) |
| `decision.badge` | `"green"` \| `"amber"` \| `"red"` | Final trust badge |

#### Error responses

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| HTTP Status | `error.code` | When |
|-------------|-------------|------|
| 400 | `MISSING_UPI_ID` | `upiId` field is absent |
| 400 | `MISSING_PAYLOAD` | `payload` field is absent |
| 400 | `INVALID_UPI_ID` | `upiId` does not match `localpart@provider` format |
| 400 | `INVALID_PAYLOAD` | `payload` is an empty string |
| 404 | `UNKNOWN_MERCHANT` | No merchant found for the provided UPI ID |
| 503 | `MERCHANT_SERVICE_ERROR` | Merchant provider threw an error, timed out, or is not configured |
| 503 | `FRAUD_SERVICE_ERROR` | Fraud provider threw an error |
| 503 | `SECURITY_SERVICE_ERROR` | Crypto service threw an error |
| 500 | `INTERNAL_ERROR` | Unexpected unhandled error |

---

## Merchant verification (Phase 2)

The merchant service has two providers. Which one is active depends **only** on whether `MERCHANT_API_URL` is set — no code change is needed to switch between them.

| Provider | Active when | Purpose |
|----------|-------------|---------|
| Mock | `MERCHANT_API_URL` is blank | Local development and tests. Fixture data, **not** real verification. |
| HTTP | `MERCHANT_API_URL` is set | Real merchant verification over HTTP. |

### HTTP provider request

```http
GET <MERCHANT_API_URL>?<MERCHANT_UPI_PARAM>=<upiId>
Accept: application/json
<MERCHANT_AUTH_HEADER>: <MERCHANT_AUTH_SCHEME> <NPCI_API_KEY>
```

### Expected response

Field names are configurable so any vendor's payload shape can be consumed without a code change.

```json
{ "verified": true, "name": "Test Merchant" }
```

For a nested vendor response, set `MERCHANT_VERIFIED_PATH` and `MERCHANT_NAME_PATH` to dot paths:

```json
{ "data": { "isVerified": true, "merchant": { "displayName": "Store" } } }
```

```bash
MERCHANT_VERIFIED_PATH=data.isVerified
MERCHANT_NAME_PATH=data.merchant.displayName
```

### Failure policy — fail closed

If verification cannot be completed, the API returns `503 MERCHANT_SERVICE_ERROR`. It never substitutes a guess, because an unverified merchant would silently downgrade a 🔴 Red badge to 🟡 Amber.

| Upstream condition | Result | Retryable |
|--------------------|--------|-----------|
| `404` | `null` → `404 UNKNOWN_MERCHANT` | — |
| `401` / `403` | `503` — credentials rejected | No |
| `429` / `5xx` | `503` | Yes |
| Network failure | `503` | Yes |
| Timeout (`MERCHANT_TIMEOUT_MS`) | `503` | Yes |
| `2xx`, body not valid JSON | `503` | No |
| `2xx`, no boolean at `MERCHANT_VERIFIED_PATH` | `503` | No |

The specific cause is logged server-side (with a code and retryable flag) and never returned to the client. Internal error codes: `MERCHANT_CONFIG_ERROR`, `MERCHANT_UNAVAILABLE`, `MERCHANT_TIMEOUT`, `MERCHANT_BAD_RESPONSE`.

### Caching

Successful lookups (including `404`) are cached in memory for `MERCHANT_CACHE_TTL_MS` (default 5 minutes, `0` disables). **Errors are never cached**, so a recovering provider is picked up on the very next request rather than after a TTL.

The cache is per-process. Running multiple instances means each keeps its own.

---

## Mock behaviour

Used only when `MERCHANT_API_URL` is blank.

The fraud service uses a **deterministic mock provider** when `ML_SERVICE_URL` is not configured.

| UPI ID contains | Result |
|----------------|--------|
| `"suspicious"` | `riskLevel: "high"`, `riskScore: 85` |
| `"unknown"` | `riskLevel: "medium"`, `riskScore: 50` |
| anything else (verified merchant) | `riskLevel: "low"`, `riskScore: 15` |

The merchant service uses this mock lookup when `MERCHANT_API_URL` is not configured.

| UPI ID | Response |
|--------|----------|
| `testmerchant@upi` | verified, `"Test Merchant"` |
| `verified@hdfc` | verified, `"HDFC Verified Store"` |
| `suspicious@upi` | not verified |
| `signedmerchant@upi` | verified, `"Signed Merchant"` (used by Phase 4 tests) |
| any other | 404 UNKNOWN_MERCHANT |

---

## Decision logic

| Condition | Badge |
|-----------|-------|
| `signatureValid === false` | 🔴 red |
| `riskLevel === "high"` | 🔴 red |
| Merchant not verified AND medium/high risk | 🔴 red |
| `security.status === "pending"` AND low risk AND verified merchant | 🟡 amber |
| `security.status === "pending"` (other) | 🟡 amber |
| `riskLevel === "medium"` | 🟡 amber |
| Merchant not verified AND low risk | 🟡 amber |
| Merchant verified AND low risk AND `signatureValid === true` | 🟢 green |

> **Phase 4 (complete):** 🟢 Green is now reachable — it requires a registered
> public key, a valid RSA-SHA256 signature over the payload, a verified
> merchant and low fraud risk. A tampered payload fails verification and
> forces 🔴 red regardless of the other signals.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Dev server port (default: `3001`) |
| `MERCHANT_API_URL` | No | Base URL of the merchant verification endpoint. Blank → mock provider |
| `NPCI_API_KEY` | Yes\* | Credential for the merchant provider. \*required when `MERCHANT_API_URL` is set |
| `MERCHANT_AUTH_HEADER` | No | Header the credential is sent in (default: `Authorization`) |
| `MERCHANT_AUTH_SCHEME` | No | Prefix before the credential (default: `Bearer`). Blank sends the raw key |
| `MERCHANT_UPI_PARAM` | No | Query parameter used to send the UPI ID (default: `upiId`) |
| `MERCHANT_VERIFIED_PATH` | No | Dot path to the boolean flag (default: `verified`) |
| `MERCHANT_NAME_PATH` | No | Dot path to the merchant name (default: `name`) |
| `MERCHANT_TIMEOUT_MS` | No | Request timeout in ms (default: `5000`) |
| `MERCHANT_CACHE_TTL_MS` | No | Cache lifetime in ms (default: `300000`). `0` disables caching |
| `ML_SERVICE_URL` | No | Activates the live ML fraud provider when set |
| `ML_SERVICE_API_KEY` | No | API key for the ML service |

---

## ML integration point (Phase 3)

When `ML_SERVICE_URL` is set, the fraud service will call:

```
POST <ML_SERVICE_URL>/predict
Authorization: Bearer <ML_SERVICE_API_KEY>
Content-Type: application/json

{
  "features": {
    "normalizedUpiId": "...",
    "payload": "...",
    "merchantVerified": true
  }
}
```

Expected response:

```json
{
  "fraudProbability": 0.12,
  "riskScore": 12,
  "riskLevel": "low",
  "modelVersion": "v1"
}
```

The stub is in [`api/src/services/fraud.ts`](../api/src/services/fraud.ts) — `createMlProvider()`.

---

## Cryptographic verification (Phase 4)

`verifySignature()` in [`api/src/services/crypto.ts`](../api/src/services/crypto.ts) is **implemented**.

```typescript
export async function verifySignature(input: CryptoInput): Promise<SecurityResult>
// CryptoInput = { payload: string, signature?: string, upiId: string }
```

**Algorithm:** RSA-2048, SHA-256 digest, base64-encoded signature.

### Outcomes

| Situation | `status` | `signatureValid` | Badge contribution |
|-----------|----------|------------------|--------------------|
| QR has no `signature` field | `pending` | `null` | 🟡 (cannot be green) |
| Signature matches payload | `verified` | `true` | 🟢 possible |
| Payload altered (amount, payee, …) | `invalid` | `false` | 🔴 red |
| Signature signed with another key | `invalid` | `false` | 🔴 red |
| **No public key registered for the VPA** | `invalid` | `false` | 🔴 red |
| `public-keys.json` unreadable / malformed | *(throws)* | — | `503 SECURITY_SERVICE_ERROR` |

> A missing public key returns **`invalid`, not `pending`**, so an absent key
> can never be mistaken for "unsigned but fine" and produce a false 🟢.

### Public keys

Keys live in [`public-keys.json`](../public-keys.json) at the project root:

```json
{
  "keys": [
    {
      "id": "key-testmerchant@upi",
      "upiId": "testmerchant@upi",
      "algorithm": "RSA-2048-SHA256",
      "publicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----\\n",
      "addedAt": "2026-10-07T16:02:51.223Z"
    }
  ]
}
```

- Keyed by `upiId`, one key per VPA.
- The PEM uses literal `\n` in the file (JSON-safe); the service converts it back.
- The file is read once and cached in-process. Use `resetKeyCache()` after editing it in tests.
- Malformed individual keys are logged and skipped rather than crashing the service.

### Generating and signing test payloads

```bash
cd api
npx tsx tools/generate-keys.ts yourmerchant@upi
```

This prints a key pair, a signed `upi://pay?...` payload and a ready-to-paste `curl` command that exercises the verified path. It writes the **public** half into `public-keys.json`. The private key is only printed — it is never written to disk.

### End-to-end request

```http
POST /api/validate
Content-Type: application/json

{
  "upiId": "testmerchant@upi",
  "payload": "upi://pay?pa=testmerchant@upi&pn=Test%20Merchant&am=100",
  "signature": "<base64>"
}
```

> **Security note:** verification proves the QR payload is unaltered. It does
> **not** by itself prove the merchant is legitimate — that is what the
> merchant service (Phase 2) and fraud score (Phase 3) are for. All three
> signals are combined by the decision engine.
