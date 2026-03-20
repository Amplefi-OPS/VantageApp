# CLAUDE.md — VantageApp (Monorepo)

## What is this project?

HIPAA-compliant physician workflow PWA for Vantage Refinery medical practice. React frontend + AWS serverless backend (CDK infrastructure), organized as an npm workspaces monorepo.

**Live at:** `providerdev.vantagerefinery.com`

## Quick start

```bash
# Install all workspaces from repo root
npm install

# Frontend dev server
npm run dev:web          # Vite dev server → localhost:5173

# Infrastructure deploy
npm run deploy:infra     # cdk deploy --all

# Or navigate to individual packages
cd packages/web && npm run dev
cd packages/infra && npm run deploy
```

## Build & deploy

```bash
npm run build            # Build frontend (tsc -b && vite build → packages/web/dist/)
npm run typecheck        # Typecheck all workspaces
```

AWS Amplify auto-deploys on push to main. Build output is `packages/web/dist/`.

## Project structure (monorepo)

```
├── packages/
│   ├── web/                  # React 18 + TypeScript frontend
│   │   ├── src/
│   │   │   ├── api/          # API client, endpoints, Stripe client
│   │   │   ├── auth/         # Cognito auth (AuthProvider, LoginPage, cognito helpers)
│   │   │   ├── components/   # Layout, Sidebar, BottomNav, NewPatientModal
│   │   │   │   └── ui/       # Reusable UI primitives (Button, Modal, Toast, etc.)
│   │   │   ├── lib/          # React Query client, Stripe init, utils
│   │   │   └── pages/        # Route-level pages (Dashboard, Patients, etc.)
│   │   │       └── stripe/   # Billing pages (charge, no-show, lookup, add-card)
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json      # @vantage/web
│   │
│   ├── api/                  # Lambda handlers + shared backend logic
│   │   ├── handlers/
│   │   │   ├── api/          # REST API handlers (~32 files, DynamoDB-backed)
│   │   │   ├── auth/         # Cognito triggers (pre-sign-up, post-auth)
│   │   │   ├── billing/      # Stripe/QuickBooks processors
│   │   │   ├── transcription/# Step Functions orchestration
│   │   │   └── notifications/# DLQ alerts
│   │   ├── shared/           # Shared utils (dynamo, google, zoom, response, secrets)
│   │   └── package.json      # @vantage/api
│   │
│   ├── infra/                # AWS CDK infrastructure (TypeScript, CommonJS)
│   │   ├── bin/              # CDK app entrypoint
│   │   ├── lib/              # CDK stacks (Auth, Storage, Api, Pipeline, Billing)
│   │   ├── scripts/          # Operational scripts (seed, fix-stuck)
│   │   ├── cdk.json
│   │   └── package.json      # @vantage/infra
│   │
│   └── shared/               # Shared types & Zod schemas (used by web + api)
│       ├── types.ts          # Patient, Todo, Fax, Voicemail schemas
│       ├── index.ts
│       └── package.json      # @vantage/shared
│
├── package.json              # Root workspace config
├── CLAUDE.md                 # This file
└── ARCHITECTURE.md           # System architecture docs
```

## Workspace commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run build` | Build frontend for production |
| `npm run dev:web` | Same as `npm run dev` |
| `npm run deploy:infra` | CDK deploy all stacks |
| `npm run synth` | CDK synth (dry run) |
| `npm run typecheck` | Typecheck all packages |

## Tech stack

**Frontend (`@vantage/web`):** React 18, TypeScript 5.6 (strict), Vite 6, Tailwind CSS 3.4, React Router 6, TanStack React Query 5, Zod, Lucide icons, Stripe.js

**Backend (`@vantage/api`):** Lambda (Node.js 20, ARM64), API Gateway + Cognito authorizer, DynamoDB (single-table), S3 + KMS, Step Functions, EventBridge

**Infrastructure (`@vantage/infra`):** AWS CDK 2.170 (TypeScript, CommonJS)

**Shared (`@vantage/shared`):** Zod schemas, TypeScript interfaces

**Integrations:** Zoom Phone (voicemails, call logs, fax), Google Calendar (appointments), Stripe (payments), Slack (notifications), AWS Transcribe Medical, QuickBooks

## Key conventions

### Frontend (@vantage/web)
- **Path alias:** `@/` maps to `src/` (configured in tsconfig + vite)
- **Styling:** Tailwind utility classes. Custom palette: `charcoal`, `slate-blue`, `tan`, `warm-gray`, `off-white`, `light-gray`. Dark mode via `class` strategy.
- **Data fetching:** TanStack React Query for all API calls. Client in `src/api/client.ts` adds Cognito auth headers automatically.
- **Validation:** Zod schemas in `@vantage/shared` — runtime validation of API responses.
- **Auth:** Cognito with MFA required. 5-min inactivity timeout. Tokens stored in sessionStorage.
- **No linter/formatter/tests configured** — code style by convention.

### Backend (@vantage/api)
- **DynamoDB single-table design:** PK/SK pattern (e.g. `PATIENT#id/PROFILE`, `PROVIDER#id/TASK#id`). GSI1 for provider-scoped queries, GSI2 for entity-type queries.
- **Audit logging:** `writeAuditLog()` with 7-year TTL. Never put PHI in log details.
- **API Gateway:** `dataTraceEnabled: false` — no PHI in CloudWatch logs.
- **Google Calendar:** OAuth2 refresh token flow (not service account). Creds in Secrets Manager.
- **CDK handler paths:** CDK stacks reference `packages/api/handlers/` for Lambda entry points. The path is: `path.join(__dirname, '..', '..', 'api', 'handlers')`.

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
- **Frontend:** Tailwind for all styling. Use existing UI primitives from `packages/web/src/components/ui/` before creating new ones.
- **Types:** Add Zod schemas to `packages/shared/types.ts` for any new API response shapes.
- **New API routes:** Add endpoint constants to `packages/web/src/api/endpoints.ts`, typed fetch functions to `packages/web/src/api/client.ts`.
- **New Lambda handlers:** Add to `packages/api/handlers/{domain}/`. Import shared utils from `../../shared/`.
- **CDK stacks:** In `packages/infra/lib/`. Handler paths use `lambdaDir` which resolves to `packages/api/handlers/`.
