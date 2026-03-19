# CLAUDE.md — VantageApp

## What is this project?

HIPAA-compliant physician workflow PWA for Vantage Refinery medical practice. React frontend + AWS serverless backend (CDK infrastructure).

**Live at:** `providerdev.vantagerefinery.com`

## Quick start

```bash
# Frontend
npm install
npm run dev          # Vite dev server → localhost:5173

# Infrastructure (from infra/)
cd infra
npm install
npm run deploy       # cdk deploy --all
```

## Build & deploy

```bash
npm run build        # tsc -b && vite build → dist/
npm run preview      # Preview production build locally
```

AWS Amplify auto-deploys on push to main. Build output is `dist/`.

## Project structure

```
├── src/                  # React 18 + TypeScript frontend
│   ├── api/              # API client, endpoints, Zod types, Stripe client
│   ├── auth/             # Cognito auth (AuthProvider, LoginPage, cognito helpers)
│   ├── components/       # Layout, Sidebar, BottomNav, NewPatientModal
│   │   └── ui/           # Reusable UI primitives (Button, Modal, Toast, etc.)
│   ├── lib/              # React Query client, Stripe init, utils
│   └── pages/            # Route-level pages (Dashboard, Patients, Appointments, etc.)
│       └── stripe/       # Billing pages (charge, no-show, lookup, add-card)
├── infra/                # AWS CDK infrastructure (TypeScript, CommonJS)
│   ├── bin/              # CDK app entrypoint
│   ├── lib/              # CDK stacks (Auth, Storage, Api, Pipeline, Billing)
│   ├── lambda/           # Lambda handlers (~54 files)
│   │   ├── api/          # REST API handlers (v1, DynamoDB-backed)
│   │   ├── auth/         # Cognito triggers (pre-sign-up, post-auth)
│   │   ├── transcription/# Step Functions orchestration
│   │   ├── billing/      # Stripe/QuickBooks processors
│   │   └── shared/       # Shared utils (dynamo, google, zoom, postgres, response, secrets)
│   └── lambda/domains/   # V2 API handlers (PostgreSQL-backed, /v2/ prefix)
└── public/               # PWA manifest, icons
```

## Tech stack

**Frontend:** React 18, TypeScript 5.6 (strict), Vite 6, Tailwind CSS 3.4, React Router 6, TanStack React Query 5, Zod, Lucide icons, Stripe.js

**Backend:** AWS CDK 2.170, Lambda (Node.js 20, ARM64), API Gateway + Cognito authorizer, DynamoDB (single-table), Aurora PostgreSQL (Data API), S3 + KMS, Step Functions, EventBridge

**Integrations:** Zoom Phone (voicemails, call logs, fax), Google Calendar (appointments), Stripe (payments), Slack (notifications), AWS Transcribe Medical, QuickBooks

## Key conventions

### Frontend
- **Path alias:** `@/` maps to `src/` (configured in tsconfig + vite)
- **Styling:** Tailwind utility classes. Custom palette: `charcoal`, `slate-blue`, `tan`, `warm-gray`, `off-white`, `light-gray`. Dark mode via `class` strategy.
- **Data fetching:** TanStack React Query for all API calls. Client in `src/api/client.ts` adds Cognito auth headers automatically.
- **Validation:** Zod schemas in `src/api/types.ts` — runtime validation of API responses.
- **Auth:** Cognito with MFA required. 5-min inactivity timeout. Tokens stored in sessionStorage.
- **No linter/formatter/tests configured** — code style by convention.

### Backend (Lambda)
- **DynamoDB single-table design:** PK/SK pattern (e.g. `PATIENT#id/PROFILE`, `PROVIDER#id/TASK#id`). GSI1 for provider-scoped queries, GSI2 for entity-type queries.
- **Aurora Data API:** UUID columns need `typeHint: 'UUID'`, DATE columns need `typeHint: 'DATE'`. One SQL statement per call (no multi-statement).
- **V2 API:** PostgreSQL-backed routes under `/v2/` prefix. V1 DynamoDB routes unchanged.
- **Audit logging:** `writeAuditLog()` with 7-year TTL. Never put PHI in log details.
- **API Gateway:** `dataTraceEnabled: false` — no PHI in CloudWatch logs.
- **Google Calendar:** OAuth2 refresh token flow (not service account). Creds in Secrets Manager.
- **CDK deploy wipes Lambda env vars** — must manually restore creds on Zoom/Stripe Lambdas after every deploy. See memory for the full list.

### HIPAA compliance
- KMS encryption for all data at rest
- No-index headers (`robots: noindex, nofollow`)
- CSP headers in `index.html` and `amplify.yml`
- HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff
- `frame-ancestors: 'none'` (clickjacking protection)
- CloudTrail audit logging enabled

## Environment variables

Frontend env vars are prefixed with `VITE_` (Vite convention). See `.env.example`:

```
VITE_API_BASE_URL=         # API Gateway endpoint
VITE_COGNITO_USER_POOL_ID= # Cognito pool ID
VITE_COGNITO_CLIENT_ID=    # Cognito app client ID
VITE_AWS_REGION=us-east-1
VITE_S3_BUCKET=vantage-uploads
VITE_S3_REGION=us-east-1
```

## Editing guidelines

- **Lambda/DynamoDB code:** Only make targeted bug-fix edits. Do not reformat, restructure, or refactor surrounding code.
- **Frontend:** Tailwind for all styling. Use existing UI primitives from `src/components/ui/` before creating new ones.
- **Types:** Add Zod schemas to `src/api/types.ts` for any new API response shapes.
- **New API routes:** Add endpoint constants to `src/api/endpoints.ts`, typed fetch functions to `src/api/client.ts`.
