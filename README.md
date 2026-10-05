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

**Phase 1 — complete.** API contract, merchant service, fraud service abstraction, crypto stub, error handling, tests.

**Phase 2 — complete.** Real merchant verification over HTTP.

ML fraud scoring and cryptographic verification are **not yet implemented** (Phases 3 and 4). The architecture is designed so both can be added without changing the API layer.

### Merchant verification (Phase 2)

The merchant service ships two providers and picks between them purely by configuration:

| Provider | Active when | Notes |
|----------|-------------|-------|
| Mock | `MERCHANT_API_URL` is blank | Fixture data for local dev and tests. **Not** real verification |
| HTTP | `MERCHANT_API_URL` is set | Real verification, vendor-agnostic |

Because the endpoint, auth header, query parameter and response field paths are all environment variables, changing merchant provider is a config change rather than a code change — see [`api/.env.example`](api/.env.example) and [`docs/api-spec.md`](docs/api-spec.md#merchant-verification-phase-2).

**The provider fails closed.** A timeout, 5xx, network error or malformed response returns `503 MERCHANT_SERVICE_ERROR` instead of guessing. Only an explicit upstream `404` means "merchant unknown". This is deliberate: returning an unverified merchant during an outage would quietly turn a 🔴 Red badge into 🟡 Amber.

```bash
# Example: point at a real provider
MERCHANT_API_URL=https://api.vendor.com/v1/merchants
NPCI_API_KEY=your-key
MERCHANT_VERIFIED_PATH=data.isVerified   # if the vendor nests its response
```

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
