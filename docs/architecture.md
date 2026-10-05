# Architecture Overview

## System layers

```
User
  │
  ▼
QR Scanner (React — Phase 1 frontend)
  │
  ▼
QR/UPI Parser
  │
  ▼
POST /api/validate
  │
  ├──────────────────────────┐
  │                          │
  ▼                          ▼
Merchant Service         Fraud Service
  │                          │
  │ (mock in Phase 1)        ├── Mock Provider  ← Phase 1
  │                          │
  │                          └── ML Provider    ← Phase 3
  │
  └──────────────────────────┤
                             │
                             ▼
                      Crypto Service
                             │
                       (stub — Phase 1)
                             │
                       Phase 4 implementation
                             │
                             ▼
                      Decision Engine
                             │
                  ┌──────────┼──────────┐
                  ▼          ▼          ▼
                GREEN      AMBER       RED
                             │
                             ▼
                          Frontend
```

## Service responsibilities

| Service | Answers | Phase |
|---------|---------|-------|
| Merchant Service | "Is this UPI identity known and valid?" | 1 (mock), 2 (real) |
| Fraud Service | "Does this QR/merchant look suspicious?" | 1 (mock), 3 (ML) |
| Crypto Service | "Is this signature cryptographically valid?" | 4 |
| Decision Engine | "Given all evidence, what badge does the user see?" | 1+ |

## Interface boundaries

### Node ↔ ML service

The backend never imports Python code. Communication is via HTTP/JSON:

```
Node Backend → POST /predict → ML Service → { riskScore, riskLevel, ... }
```

Integration point: `createMlProvider()` in `api/src/services/fraud.ts`

### Node ↔ Crypto

Integration point: `verifySignature()` in `api/src/services/crypto.ts`

Public keys: `public-keys.json` at the project root.
