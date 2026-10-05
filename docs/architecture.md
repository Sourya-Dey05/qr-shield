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
  ├── Mock  ← 1   ├── Mock ← 1      └── Stub   ← 1      │
  │                │                                     │
  └── HTTP  ← 2   └── ML    ← 3      Phase 4 impl.      │
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
| Fraud Service | "Does this QR/merchant look suspicious?" | 1 (mock), 3 (ML) |
| Crypto Service | "Is this signature cryptographically valid?" | 4 |
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

### Node ↔ Crypto

Integration point: `verifySignature()` in `api/src/services/crypto.ts`

Public keys: `public-keys.json` at the project root.
