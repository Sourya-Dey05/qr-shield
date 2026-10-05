# QR-Shield

Secure QR-Code Transaction Validator for UPI payments.

## What this is

QR-Shield validates UPI QR codes before a user completes a payment. It checks merchant identity, estimates fraud risk, and (in a future phase) verifies cryptographic signatures — returning a **Green / Amber / Red** trust badge.

## Repository structure

```
qr-shield/
├── api/          ← Node.js/TypeScript backend (Phase 1 — this phase)
├── frontend/     ← React + TypeScript + Tailwind (Phase 1 — Member A)
├── ml/           ← Python ML service (Phase 3 — Member C)
├── docs/         ← Architecture, API spec, ML design, security notes
├── .github/      ← CI/CD workflows
└── public-keys.json  ← Public keys for signature verification (Phase 4)
```

## Current phase

**Backend Phase 1** — API contract, merchant service, fraud service abstraction, error handling, tests.

ML and cryptographic verification are **not yet implemented**. The architecture is designed so both can be added without rewriting the API layer.

## Running the backend locally

```bash
cd api
npm install
cp .env.example .env   # fill in values as needed
npm run dev
```

## Running backend tests

```bash
cd api
npm test
```

## API

`POST /api/validate` — see [docs/api-spec.md](docs/api-spec.md) for the full contract.

## Environment variables

See `api/.env.example`.

## Branches

| Branch | Owner | Purpose |
|--------|-------|---------|
| `main` | — | Stable, reviewed code only |
| `backend/phase-1-sourya` | Sourya | Backend Phase 1 implementation |
| `feature/frontend` | Member A | Frontend |
| `feature/ml-fraud` | Member C | ML fraud model |
| `feature/crypto-security` | Member C | Cryptographic verification |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
