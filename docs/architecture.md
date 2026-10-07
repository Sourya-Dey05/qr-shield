# Architecture Overview

## System layers

```
User
  │
  ▼
QR Scanner (React — frontend)
  │
  ▼
QR/UPI Parser
  │
  ▼
POST /api/validate
  │
  ├────────────────┬─────────────────┬──────────────────┐
  ▼                ▼                 ▼                  │
Merchant Service  Fraud Service  Crypto Service        │
  │                │                 │                  │
  ├── Mock  ← 1   ├── Mock ← 1      └── Verify  ← 4     │
  │                │                                     │
  └── HTTP  ← 2   └── ML    ← 3                         │
                     │                                     │
                     └────────────┬────────────────────────┘
                                 ▼
                          Decision Engine
                                 │
                     ┌───────────┼───────────┐
                     ▼           ▼           ▼
                   GREEN       AMBER        RED
                                 │
                                 ▼
                             Frontend
```

## Service responsibilities

| Service | Answers | Phase |
|---------|---------|-------|
| Merchant Service | "Is this UPI identity known and valid?" | 1 (mock), **2 (HTTP — implemented)** |
| Fraud Service | "Does this QR/merchant look suspicious?" | 1 (mock), **3 (ML — implemented)** |
| Crypto Service | "Is this signature cryptographically valid?" | **4 (implemented)** |
| Decision Engine | "Given all evidence, what badge does the user see?" | 1+ |

## Interface boundaries

### Node ↔ Merchant verification provider (Phase 2)

NPCI does not expose a public API for verifying arbitrary VPAs, so the merchant
provider is **vendor-agnostic**: endpoint, auth header, parameter name and
response field paths are all environment configuration. Switching vendors is a
configuration change, not a code change.

```
Node Backend → GET <MERCHANT_API_URL>?upiId=<vpa> → Provider → { verified, name }
```

Integration point: `createHttpProvider()` in `api/src/services/merchant.ts`

Selection happens in `buildProviderFromConfig()`:

- `MERCHANT_API_URL` blank → mock provider
- `MERCHANT_API_URL` set → HTTP provider, wrapped in a TTL cache

**Fail closed.** Any condition that prevents a confident answer — timeout, 5xx,
network error, malformed body — raises `MerchantProviderError` and becomes a
`503`. Only an explicit upstream `404` becomes `null`. The provider never
returns `verified: false` on uncertainty, because that would silently downgrade
a 🔴 Red badge to 🟡 Amber during an outage.

### Node ↔ ML service

The backend never imports Python code. Communication is via HTTP/JSON:

```
Node Backend → POST /predict → ML Service → { riskScore, riskLevel, ... }
```

Integration point: `createMlProvider()` in `api/src/services/fraud.ts`

### Node ↔ Crypto (Phase 4)

Integration point: `verifySignature()` in `api/src/services/crypto.ts`

The backend verifies signatures itself using Node's built-in `crypto` module —
there is no separate service and no network call.

```
QR payload + base64 signature + upiId
        │
        ▼
load key from public-keys.json (cached)
        │
        ▼
crypto.verify("sha256", payload, publicKey, signature)
        │
        ├── true   → status: "verified"
        ├── false  → status: "invalid"
        └── no sig → status: "pending"
```

Public keys: `public-keys.json` at the project root, keyed by `upiId`.
Generated with `npx tsx tools/generate-keys.ts <upiId>`.

**Fail closed.** A VPA with no registered key returns `invalid`, not
`pending`, so an absent key can never be misread as "unsigned but acceptable"
and produce a false 🟢. Unreadable key material throws, which the handler
maps to `503 SECURITY_SERVICE_ERROR`.

The key file is read once and cached in-process; `resetKeyCache()` clears it.
