# QR-Shield

Secure QR-Code Transaction Validator for UPI payments.

## What this is

QR-Shield validates UPI QR codes before a user completes a payment. It checks merchant identity, estimates fraud risk, and (in a future phase) verifies cryptographic signatures — returning a **Green / Amber / Red** trust badge.

## Repository structure

```
qr-shield/
├── api/          ← Node.js/TypeScript backend (Phases 1–2)
├── frontend/     ← React + TypeScript + Tailwind (not started)
├── ml/           ← Python ML service (Phase 3 — not started)
├── docs/         ← Architecture, API spec
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

### Demoing without vendor credentials

No real provider credentials are available yet, so `api/tools/stub-merchant-server.ts` stands in as one. It is a real HTTP server that the real provider talks to over a real socket — bearer auth, nested JSON, 404s, 5xx and timeouts all behave like a vendor.

> **The stub is not verification.** Every merchant it returns is a fixture defined in the stub file. A 🟢 or 🟡 badge produced against it says nothing about a real merchant. Never present these badges as a safety judgement.

```bash
cd api
cp .env.stub.example .env    # points the backend at the stub

npm run stub                 # terminal 1 — fake provider on :4010
npm run dev                  # terminal 2 — QR-Shield API on :3001
npm run demo                 # terminal 3 — drives every scenario
```

`npm run demo` prints the badge for each case and exits non-zero if a fail-closed case ever returns something other than 503.

| UPI ID | Provider behaviour | API result |
|--------|-------------------|------------|
| `testmerchant@upi` | 200, verified | 🟡 amber |
| `grocery@okhdfc` | 200, verified | 🟡 amber |
| `suspicious@upi` | 200, **not** verified | 🔴 red |
| `nobody@upi` | 404 | `404 UNKNOWN_MERCHANT` |
| `stub-down@upi` | 503 | `503` fail closed |
| `stub-unauth@upi` | 401 | `503` fail closed |
| `stub-ratelimit@upi` | 429 | `503` fail closed |
| `stub-slow@upi` | never replies | `503` fail closed after timeout |
| `stub-garbage@upi` | 200, not JSON | `503` fail closed |
| `stub-nofield@upi` | 200, no `verified` field | `503` fail closed |

The stub returns a deliberately **nested** body (`data.isVerified`) so the configurable dot-path mapping is genuinely exercised. It also sets a decoy `legacyVerified` field with the opposite value, so a misconfigured path would produce visibly wrong results rather than accidentally passing.

To go back to the built-in mock, delete `MERCHANT_API_URL` and `NPCI_API_KEY` from `.env`.

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
