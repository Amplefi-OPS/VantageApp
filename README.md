# VantageApp - Physician Workflow Portal

A HIPAA-compliant Progressive Web App (PWA) for managing a medical office. Physicians and staff use it to handle voicemails, patient records, appointments, dictations, faxes, billing, and to-do tasks — all from a single responsive interface.

**Stack:** React 18 + TypeScript + Tailwind CSS + Vite (frontend) | AWS CDK with API Gateway, Lambda, DynamoDB, S3, Cognito, Step Functions, EventBridge (backend)

**Hosted on:** AWS Amplify at `providerdev.vantagerefinery.com`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Frontend](#frontend)
   - [Pages & Routes](#pages--routes)
   - [Authentication Flow](#authentication-flow)
   - [API Client Layer](#api-client-layer)
   - [Data Types & Validation](#data-types--validation)
   - [UI Component Library](#ui-component-library)
3. [Backend](#backend)
   - [CDK Stacks](#cdk-stacks)
   - [API Gateway Routes](#api-gateway-routes)
   - [Lambda Functions](#lambda-functions)
   - [Shared Lambda Utilities](#shared-lambda-utilities)
4. [Database Design](#database-design)
   - [DynamoDB Single-Table Design](#dynamodb-single-table-design)
   - [Primary Key Patterns](#primary-key-patterns)
   - [Global Secondary Indexes](#global-secondary-indexes)
   - [Entity Types](#entity-types)
5. [Third-Party Integrations](#third-party-integrations)
   - [Zoom Phone (Voicemails, Call Logs, Fax)](#zoom-phone-voicemails-call-logs-fax)
   - [Google Calendar (Appointments)](#google-calendar-appointments)
   - [Stripe (Billing & Payments)](#stripe-billing--payments)
   - [Slack (Notifications)](#slack-notifications)
6. [Transcription Pipeline](#transcription-pipeline)
   - [Dictation Pipeline](#dictation-pipeline)
   - [Voicemail Pipeline](#voicemail-pipeline)
7. [Billing Pipeline](#billing-pipeline)
8. [Security & HIPAA Compliance](#security--hipaa-compliance)
9. [Secrets Management](#secrets-management)
10. [Local Development](#local-development)
11. [Deployment](#deployment)
12. [Environment Variables](#environment-variables)

---

## Architecture Overview

```
┌──────────────────┐      ┌─────────────────┐      ┌──────────────────┐
│                  │      │   API Gateway    │      │    DynamoDB      │
│   React SPA      │─────▶│   (REST + CORS)  │─────▶│  Single Table    │
│   (Amplify)      │      │   Cognito Auth   │      │  (KMS encrypted) │
│                  │      └────────┬─────────┘      └──────────────────┘
└──────────────────┘               │
                                   │  Lambda Functions (Node.js 20, ARM64)
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
              │   Zoom     │ │  Google   │ │  Stripe   │
              │   Phone    │ │  Calendar │ │  Payments │
              │   API      │ │  API      │ │  API      │
              └───────────┘ └───────────┘ └───────────┘

┌──────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  S3 Audio    │─────▶│  Step Functions   │─────▶│ S3 Transcripts   │
│  Bucket      │      │  (Transcription)  │      │ Bucket           │
│  (KMS)       │      │  Medical NLP      │      │ (KMS)            │
└──────────────┘      └──────────────────┘      └──────────────────┘

┌──────────────┐      ┌──────────────────┐
│ EventBridge  │─────▶│  Billing Lambda  │─────▶  Stripe / QuickBooks
│ Billing Bus  │      │  Processors      │
└──────────────┘      └──────────────────┘
```

---

## Frontend

### Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| React | 18.3 | UI framework |
| TypeScript | 5.6 | Type safety |
| Vite | 6.0 | Build tool & dev server |
| Tailwind CSS | 3.4 | Utility-first styling |
| React Router | 6.28 | Client-side routing |
| TanStack React Query | 5.62 | Data fetching, caching, auto-refetch |
| Zod | 3.24 | Runtime schema validation |
| Lucide React | 0.468 | Icon library |
| Stripe.js | 5.10 | Payment Elements |

**Build:** `npm run build` (tsc + vite build to `dist/`)
**Dev server:** `npm run dev` (localhost:5173)

Path aliases: `@/` maps to `src/` (configured in `tsconfig.json` and `vite.config.ts`).

### Pages & Routes

All routes are protected behind Cognito authentication. Unauthenticated users see the `LoginPage`. Authenticated routes are wrapped in the `<Layout>` component (sidebar on desktop, bottom nav on mobile).

| Route | Page Component | Description |
|---|---|---|
| `/dashboard` | `Dashboard.tsx` | Home screen with tile counts (voicemails, open todos, patients, fax, settings). Auto-refreshes every 30s. Shows overdue todo alert banner. |
| `/voicemails` | `Voicemails.tsx` | Lists voicemails from Zoom Phone. Attach to patients, archive, play audio. Auto-creates todo tasks per voicemail. |
| `/todos` | `Todos.tsx` | Task management. Filter by status (Open/Done), priority (Low/Med/High), type. Assign to staff, set due dates. |
| `/appointments` | `Appointments.tsx` | Day/week calendar view from Google Calendar. Mark complete, no-show, or cancel. Auto-creates patient records from new appointments. |
| `/dictations` | `Dictations.tsx` | Voice dictation recording and transcription list. Shows transcription status (Uploading -> Transcribing -> DraftReady). |
| `/patients` | `Patients.tsx` | Patient directory. Search, create new patients via modal. |
| `/patients/:id` | `PatientProfile.tsx` | Full patient chart — demographics, notes, voicemails, appointments, todos linked to this patient. |
| `/fax` | `Fax.tsx` | Send and view faxes via Zoom Phone. Includes Rx detail form (medication, dosage, directions, quantity, refills, prescriber). |
| `/billing` | `StripeDashboard.tsx` | Billing overview — recent transactions, quick links. |
| `/billing/lookup` | `PatientLookup.tsx` | Search Stripe customers by name/email/phone. |
| `/billing/charge` | `ChargePatient.tsx` | Charge a patient's card on file. |
| `/billing/no-show` | `NoShowFee.tsx` | Charge a no-show fee against a patient's saved card. |
| `/billing/add-card` | `AddCard.tsx` | Save a new credit card for a patient via Stripe Setup Intent. |
| `/settings` | `Settings.tsx` | Office name, timezone, staff list, API URL configuration. Stored in localStorage. |
| `*` | — | Redirects to `/dashboard`. |

### Authentication Flow

Authentication uses **AWS Cognito** with direct API calls (no Amplify SDK dependency). The flow is implemented in `src/auth/cognito.ts` and `src/auth/AuthProvider.tsx`.

**Login sequence:**

1. User enters email + password -> `InitiateAuth` (USER_PASSWORD_AUTH flow)
2. If `NEW_PASSWORD_REQUIRED` challenge -> user sets new password -> `RespondToAuthChallenge`
3. If MFA challenge (EMAIL_OTP, SMS_MFA, or SOFTWARE_TOKEN_MFA) -> user enters code -> `RespondToAuthChallenge`
4. On success -> ID token, access token, refresh token stored in **sessionStorage** (not localStorage — clears on tab close for HIPAA)
5. `AuthProvider` sets user context from decoded ID token claims

**Token management:**
- Tokens expire after 60 minutes (configured in Cognito)
- Auto-refresh via `REFRESH_TOKEN_AUTH` flow every 5 minutes, with 5-minute buffer before expiry
- Concurrent refresh calls are deduplicated
- On refresh failure -> session cleared -> redirect to login

**HIPAA inactivity timeout:**
- Warning dialog at 13 minutes of inactivity
- Auto-logout at 15 minutes
- User can click "Stay Signed In" to reset the timer
- Tracks mousedown, keydown, touchstart, scroll events

**Sign out:**
- Revokes refresh token server-side (`RevokeToken`)
- Calls `GlobalSignOut` to invalidate all tokens
- Clears React Query cache
- Clears sessionStorage

**Sign up:**
- Pre-sign-up Lambda restricts to `@vantagerefinery.com` and `@amplefi.com` email domains
- Email confirmation required
- MFA is **required** (EMAIL_OTP — code sent to email)
- Password: min 8 chars, uppercase, lowercase, digit, symbol

**Cognito error sanitization:**
All Cognito error codes are mapped to user-friendly messages. Raw AWS error messages are never exposed to the UI.

### API Client Layer

`src/api/client.ts` — Typed fetch wrapper for all API calls.

- **Base URL:** Reads from `VITE_API_BASE_URL` env var (falls back to empty string for relative paths)
- **Auth:** Adds `Authorization: Bearer <idToken>` header to every request
- **401 handling:** Clears session, redirects to login
- **Error extraction:** Parses JSON `{ error }` or `{ message }` from response body; never exposes raw Lambda errors
- **Methods:** `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `apiUpload`
- **Upload:** Uses `FormData` with presigned URL workflow

`src/api/endpoints.ts` — All API endpoint functions, organized by domain. Maps snake_case API responses to camelCase frontend types (e.g., `task_id` -> `Todo.id`, `patient_id` -> `Todo.patientId`).

### Data Types & Validation

`src/api/types.ts` — Zod schemas define the canonical data models:

| Model | Key Fields |
|---|---|
| **Patient** | id, firstName, lastName, dob, phone, email, gender, preferredLanguage, address (street/city/state/zip), emergency contact, PCP, allergies, insurance (provider/id/group/policyHolder), notes |
| **Voicemail** | id, callerNumber, callerName, receivedAt, category (Scheduling/Refills/Billing/New Patient/Basic Questions/Everything Else), durationSeconds, audioUrl, attachedTo, status (Unattached/Attached/Reviewed/Archived), transcript, transcriptStatus |
| **Todo** | id, patientId, voicemailId, type (Schedule/Refill/CallBack/SendDocs/General), title, status (Open/Done), priority (Low/Med/High), dueDate, assignedTo, notes |
| **Note** | id, patientId, title, body, createdAt |
| **Fax** | id, patientId, pharmacyName, pharmacyFax, pharmacyPhone, status (Queued/Sent/Failed), rxDetails, direction (inbound/outbound), pages |
| **Appointment** | id, patientName, patientPhone, patientEmail, patientId, type, startTime, endTime, duration, status (scheduled/cancelled/no_show/completed), notes, calendar, location |
| **DashboardCounts** | unattachedVoicemails, totalVoicemails, openTodos, overdueTodos, totalPatients |

### UI Component Library

All UI components are in `src/components/ui/`:

- **Button** — Primary, secondary, danger variants with loading state
- **Card** — Rounded container with padding, click handler, dark mode support
- **Input** — Form input with label, error state
- **Select** — Dropdown select with label
- **Modal** — Full-screen overlay with title, close button
- **Badge** — Colored labels for statuses
- **Tabs** — Tab navigation component
- **Toast** — Global toast notification system (success, error, info)
- **ConfirmDialog** — Confirmation modal with confirm/cancel actions
- **EmptyState** — Placeholder for empty lists
- **LoadingSpinner** — Centered spinner animation

Layout components:
- **Layout** (`Layout.tsx`) — Sidebar + main content area with `<Outlet>` for nested routes
- **Sidebar** (`Sidebar.tsx`) — Desktop navigation with icons and active state
- **BottomNav** (`BottomNav.tsx`) — Mobile tab bar navigation

### Color Palette

| Name | Hex | Usage |
|---|---|---|
| Charcoal | `#1C1C1C` | Primary text |
| Slate Blue | `#55677A` | Primary buttons, active nav, links |
| Tan/Sand | `#BEA883` | Secondary buttons |
| Warm Gray | `#A1A095` | Secondary text, placeholders |
| Off-White | `#F8F7F6` | Page background |
| Light Gray | `#E7E7E7` | Borders, dividers |

### Responsive Design

- **Desktop (>=1024px):** Left sidebar navigation with labeled icons
- **Mobile (<1024px):** Bottom tab bar with "More" overflow menu
- **Touch targets:** Minimum 44px height on all buttons and interactive elements
- **Typography:** 16px base font, bold headings, generous whitespace

---

## Backend

### CDK Stacks

The infrastructure is defined in 6 CDK stacks, deployed to `us-east-1`:

| Stack | File | Purpose |
|---|---|---|
| **Storage** | `infra/lib/storage-stack.ts` | KMS key, DynamoDB table, S3 audio bucket, S3 transcript bucket, CloudTrail |
| **Auth** | `infra/lib/auth-stack.ts` | Cognito User Pool, User Pool Client, domain, groups, Lambda triggers |
| **Api** | `infra/lib/api-stack.ts` | API Gateway REST API, 28+ Lambda functions, Cognito authorizer, all routes |
| **Pipeline** | `infra/lib/pipeline-stack.ts` | Dictation transcription: S3 trigger -> Step Functions -> AWS Transcribe Medical |
| **VmPipeline** | `infra/lib/voicemail-pipeline-stack.ts` | Voicemail transcription: S3 trigger -> Step Functions -> AWS Transcribe Medical |
| **Billing** | `infra/lib/billing-stack.ts` | EventBridge billing bus, Stripe/QuickBooks processors, DLQ, Slack alerts |

**Entry point:** `infra/bin/vantage-app.ts`

**Stack dependencies:**
```
Storage ──┬──> Auth (independent)
          ├──> Api (needs Storage.table, Storage.buckets, Storage.kmsKey, Auth.userPool)
          ├──> Pipeline (needs Storage.table, Storage.buckets, Storage.kmsKey)
          ├──> VmPipeline (needs Storage.table, Storage.buckets, Storage.kmsKey)
          └──> Billing (needs Storage.table)
```

### API Gateway Routes

REST API with Cognito User Pools authorizer. All routes require a valid `Authorization: Bearer <idToken>` header except where noted.

| Method | Path | Lambda | Auth | Description |
|---|---|---|---|---|
| GET | `/dashboard/counts` | dashboard-counts | Yes | Aggregate counts for dashboard tiles |
| GET | `/patients` | list-patients | Yes | List all patients |
| POST | `/patients` | create-patient | Yes | Create a new patient record |
| GET | `/patients/{id}` | get-patient | Yes | Get single patient by ID |
| GET | `/patients/{id}/notes` | list-notes | Yes | List notes for a patient |
| POST | `/patients/{id}/notes` | create-note | Yes | Create a clinical note |
| GET | `/appointments` | list-acuity-appointments | Yes | List appointments from Google Calendar |
| PUT | `/appointments/{id}/cancel` | cancel-acuity-appointment | Yes | Cancel an appointment in Google Calendar |
| PUT | `/appointments/{id}/no-show` | noshow-acuity-appointment | Yes | Mark appointment as no-show (DynamoDB) |
| PUT | `/appointments/{id}/complete` | complete-appointment | Yes | Mark appointment as completed (DynamoDB) |
| GET | `/tasks` | get-tasks | Yes | List all tasks/todos |
| POST | `/tasks` | create-task | Yes | Create a new task |
| PATCH | `/tasks/{task_id}` | update-task | Yes | Update task status, priority, notes, etc. |
| GET | `/zoom/voicemails` | list-zoom-voicemails | Yes | Fetch voicemails from Zoom Phone |
| GET | `/zoom/call-logs` | list-zoom-call-logs | Yes | Fetch call logs from Zoom Phone |
| POST | `/voicemails/attach` | attach-voicemail | Yes | Attach a voicemail to a patient |
| PATCH | `/voicemails/{id}/archive` | archive-voicemail | Yes | Archive a voicemail |
| GET | `/faxes` | list-faxes | Yes | List faxes from Zoom Phone |
| POST | `/faxes` | send-fax | Yes | Send a fax via Zoom Phone |
| POST | `/uploads/presign` | presign-upload | Yes | Get presigned S3 URL for audio upload |
| GET | `/dictations/{dictation_id}` | get-dictation | Yes | Get dictation details + transcript |
| GET | `/stripe/customers` | stripe-customer-search | Yes | Search Stripe customers |
| POST | `/stripe/payment-intent` | stripe-payment-intent | Yes | Create a Stripe Payment Intent |
| POST | `/stripe/charge-no-show` | stripe-charge-noshow | Yes | Charge a no-show fee |
| POST | `/stripe/setup-intent` | stripe-setup-intent | Yes | Create a Stripe Setup Intent |
| POST | `/stripe/confirm-setup` | stripe-confirm-setup | Yes | Confirm a setup intent |
| GET | `/stripe/transactions` | stripe-transactions | Yes | List recent Stripe transactions |
| POST | `/billing/charge` | billing-charge | Yes | Submit charge via EventBridge |
| POST | `/notifications/login-failure` | notify-login-failure | **No** | Report failed login to Slack |

**CORS:** Allowed origins: `providerdev.vantagerefinery.com`, Amplify URL, `localhost:5173`/`localhost:4173` (dev only).

**Throttling:** 50 requests/second sustained, 100 burst.

### Lambda Functions

All Lambdas share these defaults:
- **Runtime:** Node.js 20.x on ARM64 (Graviton2)
- **Memory:** 256 MB (128 MB for triggers/auth, 512 MB for transcription completion)
- **Timeout:** 30 seconds (60s for voicemail listing, transcription start)
- **Bundling:** esbuild with minification, source maps, `@aws-sdk/*` externalized
- **Log retention:** 1 year

#### Patient Lambdas

**create-patient** (`POST /patients`)
- Validates firstName, lastName, phone (required)
- Generates `pt-{uuid12}` ID
- Writes to DynamoDB with PK=`PATIENT#{id}`, SK=`PROFILE`
- Sets GSI1 (provider-scoped) and GSI2 (entity-type) keys
- Sends Slack notification (first initial + last name only — no PHI)
- Writes HIPAA audit log

**list-patients** (`GET /patients`)
- Queries GSI2 where GSI2PK=`PATIENT` to get all patients across providers
- Returns full patient profiles

**get-patient** (`GET /patients/{id}`)
- Direct GetItem: PK=`PATIENT#{id}`, SK=`PROFILE`

#### Task Lambdas

**get-tasks** (`GET /tasks`)
- Queries GSI2 where GSI2PK=`TASK` to get all tasks across providers
- Returns tasks with count

**create-task** (`POST /tasks`)
- Generates `task-{uuid12}` ID
- Stores with PK=`PROVIDER#{providerId}`, SK=`TASK#{taskId}`
- GSI1SK includes status and timestamp for sorting: `TASKSTATUS#Open#2026-03-10T...`
- Writes audit log

**update-task** (`PATCH /tasks/{task_id}`)
- Uses DynamoDB `UpdateCommand` with `buildUpdateExpression()`
- Supports partial updates: status, notes, assignedTo, priority, dueDate
- Writes audit log

#### Voicemail Lambdas

**list-zoom-voicemails** (`GET /zoom/voicemails`, 60s timeout)
- Fetches voicemails from 7 Zoom sources in sequence:
  1. Account-level voicemails (`/phone/voice_mails`)
  2. User-level voicemails (`/phone/users/{email}/voice_mails`)
  3. Hardcoded auto receptionist IDs (from Secrets Manager)
  4. Dynamically listed auto receptionists
  5. Call queues
  6. Common areas
  7. Other phone users
- Deduplicates by voicemail ID
- **Auto-matches** voicemails to patients by normalized 10-digit phone number
- **Auto-creates tasks** for every new voicemail with IVR-based categorization:
  - Callee name/extension -> category (Scheduling, Refills, Billing, New Patient, Everything Else)
  - Category -> task type (Schedule, Refill, General, CallBack)
- **Caches audio** in S3 with KMS encryption and returns presigned URLs (15 min expiry)
- Backfills tasks for voicemails that somehow lack them
- Re-resolves categories and re-matches unattached voicemails on each call

**IVR Extension Mapping:**
| Extension | Category | Auto-created Task Type |
|---|---|---|
| 540 | Scheduling | Schedule |
| 542 | Refills | Refill |
| 543 | Billing | General |
| 545 | New Patient | CallBack |
| 544 / default | Everything Else | CallBack |

**attach-voicemail** (`POST /voicemails/attach`)
- Links a voicemail record to a patient ID in DynamoDB

**archive-voicemail** (`PATCH /voicemails/{id}/archive`)
- Updates voicemail status to `Archived`

#### Appointment Lambdas

**list-acuity-appointments** (`GET /appointments`)
- Fetches events from Google Calendar API
- Supports two modes:
  - **Date-based:** `?date=YYYY-MM-DD&range_end=YYYY-MM-DD` — events for a date range
  - **Patient-based:** `?phone=+1234567890` — searches 6 months past/future by phone in event description
- Parses event summary for patient name and type:
  - `"Jane Doe - New Patient"` -> firstName=Jane, lastName=Doe, type=New Patient
  - `"Follow Up (Jane Doe)"` -> firstName=Jane, lastName=Doe, type=Returning Patient
- Parses event description for phone and email:
  - `"Phone: (555) 123-4567\nEmail: jane@example.com"`
- **Auto-creates patient records** for new appointments with unrecognized phone numbers
- Merges status from Google (cancelled) with DynamoDB (no-show, completed)

**cancel-acuity-appointment** (`PUT /appointments/{id}/cancel`)
- Deletes the Google Calendar event (sets status to cancelled)

**noshow-acuity-appointment** (`PUT /appointments/{id}/no-show`)
- Writes `APPOINTMENT#{id}/NOSHOW` record to DynamoDB (Google Calendar has no no-show concept)

**complete-appointment** (`PUT /appointments/{id}/complete`)
- Writes `APPOINTMENT#{id}/COMPLETED` record to DynamoDB

#### Note Lambdas

**create-note** (`POST /patients/{id}/notes`)
- Creates a clinical note linked to a patient
- Writes audit log

**list-notes** (`GET /patients/{id}/notes`)
- Lists all notes for a patient

#### Fax Lambdas

**list-faxes** (`GET /faxes`)
- Fetches fax records from Zoom Phone API via the fax extension
- Merges with DB records for locally-stored fax data

**send-fax** (`POST /faxes`)
- Sends a fax via Zoom Phone API
- Stores fax record in DynamoDB with Rx details (medication, dosage, directions, quantity, refills, prescriber)

#### Dictation Lambdas

**presign-upload** (`POST /uploads/presign`)
- Generates a presigned S3 PUT URL for audio upload to `dictations/` prefix
- Creates a dictation record in DynamoDB with status `Uploading`
- Uses idempotency key to prevent duplicate uploads
- Returns: upload URL, dictation ID, object key, expiry (15 min)

**get-dictation** (`GET /dictations/{dictation_id}`)
- Returns dictation metadata + transcript text
- Generates presigned URLs for audio playback

#### Dashboard Lambda

**dashboard-counts** (`GET /dashboard/counts`)
- Queries GSI2 in parallel for PATIENT, TASK, and VOICEMAIL entity types across all providers
- Counts: open todos, overdue todos (dueDate < now), unattached voicemails, total patients

#### Stripe Lambdas

- **stripe-customer-search** — Search Stripe customers by name/email/phone
- **stripe-payment-intent** — Create a Stripe Payment Intent for charging a patient
- **stripe-charge-noshow** — Charge a no-show fee to a patient's saved card
- **stripe-setup-intent** — Create a Setup Intent for saving a new card
- **stripe-confirm-setup** — Confirm a setup intent after card is saved in Elements
- **stripe-transactions** — List recent Stripe transactions

All Stripe Lambdas fetch `STRIPE_SECRET_KEY` from Secrets Manager at runtime.

#### Billing Lambda

**billing-charge** (`POST /billing/charge`)
- Submits a charge event to EventBridge billing bus (`vantage-billing-{stage}`)
- Event routes to Stripe or QuickBooks processor based on `provider` field

#### Auth Lambdas (Cognito Triggers)

**pre-sign-up** — Restricts sign-up to `@vantagerefinery.com` and `@amplefi.com` email domains. Auto-verifies email for admin-created users.

**post-authentication** — Sends a Slack notification on every successful login with user name, email, and trigger source.

#### Notification Lambdas

**notify-login-failure** (`POST /notifications/login-failure`, **no auth**)
- Unauthenticated endpoint (user isn't logged in when login fails)
- Reports failed login attempts to Slack for security monitoring

### Shared Lambda Utilities

Located in `infra/lambda/shared/`:

| Module | File | Purpose |
|---|---|---|
| **auth** | `auth.ts` | Extracts caller identity from Cognito JWT claims (sub, email, providerId, role, groups). Sets CORS origin. `canAccessProvider()` returns true for shared clinic model. |
| **dynamo** | `dynamo.ts` | DynamoDB Document Client wrapper: `putItem`, `getItem`, `queryItems`, `updateItem`, `buildUpdateExpression`, `writeAuditLog` (7-year TTL, no PHI in details) |
| **response** | `response.ts` | HTTP response helpers with CORS headers and security headers: `success`, `created`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `serverError`, `parseBody`, `safeJsonParse` |
| **secrets** | `secrets.ts` | Fetches and caches Secrets Manager values at cold start. Validates required fields (Zoom, Stripe). |
| **google** | `google.ts` | Google OAuth2 refresh token flow for Calendar API. In-memory token cache, refreshes 60s before expiry. |
| **zoom** | `zoom.ts` | Zoom Server-to-Server OAuth. `zoomGet`, `zoomPost`, `zoomDownload` (binary). In-memory token cache, refreshes 5 min before expiry. |
| **slack** | `slack.ts` | Sends formatted alerts to Slack via incoming webhook. Supports `critical` (red), `warning` (amber), `info` (green) levels with environment tag and timestamp. Non-throwing — Slack failures never break app functionality. |

---

## Database Design

### DynamoDB Single-Table Design

| Property | Value |
|---|---|
| **Table name** | `vantage-dev` |
| **Billing mode** | Pay-per-request (on-demand) |
| **Encryption** | Customer-managed KMS key with automatic annual rotation |
| **Point-in-time recovery** | Enabled |
| **TTL attribute** | `ttl` |
| **Removal policy** | RETAIN (table survives stack deletion) |

### Primary Key Patterns

| PK | SK | Entity | Description |
|---|---|---|---|
| `PATIENT#{patientId}` | `PROFILE` | Patient | Full patient demographics, insurance, emergency contact |
| `PROVIDER#{providerId}` | `TASK#{taskId}` | Task | To-do item (manual or auto-created from voicemail) |
| `PROVIDER#{providerId}` | `VOICEMAIL#{voicemailId}` | VoicemailAttachment | Voicemail metadata, attachment status, transcript |
| `PROVIDER#{providerId}` | `DICT#{dictationId}` | Dictation | Dictation record with transcription status |
| `PROVIDER#{providerId}` | `NOTE#{noteId}` | Note | Clinical note linked to a patient |
| `APPOINTMENT#{appointmentId}` | `NOSHOW` | No-show flag | Tracks no-show status (Google Calendar has no concept of this) |
| `APPOINTMENT#{appointmentId}` | `COMPLETED` | Completed flag | Tracks completed status |
| `BILLING#{billingId}` | `EVENT` | Billing event | Charge/refund records from EventBridge pipeline |
| `AUDIT#{yyyy-mm-dd}` | `{timestamp}#{uuid}#{entityType}#{entityId}` | Audit log | HIPAA audit trail (7-year auto-expiry via TTL) |

### Global Secondary Indexes

**GSI1 — Provider-scoped queries**

Used for listing a specific provider's data (patients, tasks, voicemails, appointment flags).

| GSI1PK | GSI1SK | Use Case |
|---|---|---|
| `PROVIDER#{providerId}` | `PATIENT#{createdAt}` | List patients created by a provider, sorted by date |
| `PROVIDER#{providerId}` | `TASKSTATUS#Open#{createdAt}` | List open tasks, sorted by creation date |
| `PROVIDER#{providerId}` | `VOICEMAIL#{receivedAt}` | List voicemails for a provider, sorted by date |
| `PROVIDER#{providerId}` | `APPT_COMPLETE#{appointmentId}` | Check if appointment is completed |
| `PROVIDER#{providerId}` | `APPT_NOSHOW#{appointmentId}` | Check if appointment is no-show |

**GSI2 — Cross-provider entity queries**

Used for dashboard counts and admin views that aggregate data across all providers.

| GSI2PK | GSI2SK | Use Case |
|---|---|---|
| `PATIENT` | `{createdAt}#{patientId}` | Count/list all patients |
| `TASK` | `{createdAt}#{taskId}` | Count/list all tasks (dashboard: open/overdue counts) |
| `VOICEMAIL` | `{createdAt}#{voicemailId}` | Count/list all voicemails (dashboard: unattached count) |

Both indexes use `ALL` projection (full item copy).

### Entity Types

Every item includes an `entityType` string attribute for human-readable identification:
- `Patient`
- `Task`
- `VoicemailAttachment`
- `Note`
- `Dictation`
- `AuditLog`

### Example Items

**Patient:**
```json
{
  "PK": "PATIENT#pt-a1b2c3d4e5f6",
  "SK": "PROFILE",
  "patientId": "pt-a1b2c3d4e5f6",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "(555) 123-4567",
  "email": "jane@example.com",
  "dob": "1985-03-15",
  "providerId": "abc-123",
  "createdAt": "2026-03-10T14:30:00Z",
  "GSI1PK": "PROVIDER#abc-123",
  "GSI1SK": "PATIENT#2026-03-10T14:30:00Z",
  "GSI2PK": "PATIENT",
  "GSI2SK": "2026-03-10T14:30:00Z#pt-a1b2c3d4e5f6",
  "entityType": "Patient"
}
```

**Task (auto-created from voicemail):**
```json
{
  "PK": "PROVIDER#abc-123",
  "SK": "TASK#task-x1y2z3w4a5b6",
  "taskId": "task-x1y2z3w4a5b6",
  "providerId": "abc-123",
  "patientId": "pt-a1b2c3d4e5f6",
  "voicemailId": "zm-vm-12345",
  "type": "Schedule",
  "title": "Jane Doe — Scheduling",
  "status": "Open",
  "priority": "Med",
  "notes": "Auto-created from voicemail. Caller: Jane Doe. Duration: 45s.",
  "createdAt": "2026-03-10T14:35:00Z",
  "GSI1PK": "PROVIDER#abc-123",
  "GSI1SK": "TASKSTATUS#Open#2026-03-10T14:35:00Z",
  "GSI2PK": "TASK",
  "GSI2SK": "2026-03-10T14:35:00Z#task-x1y2z3w4a5b6",
  "entityType": "Task"
}
```

**Audit Log:**
```json
{
  "PK": "AUDIT#2026-03-10",
  "SK": "2026-03-10T14:30:00.000Z#a1b2c3d4#Patient#pt-a1b2c3d4e5f6",
  "providerId": "abc-123",
  "action": "CREATE_PATIENT",
  "entityType": "Patient",
  "entityId": "pt-a1b2c3d4e5f6",
  "details": { "createdBy": "jane@vantagerefinery.com" },
  "createdAt": "2026-03-10T14:30:00.000Z",
  "ttl": 1899849000
}
```

---

## Third-Party Integrations

### Zoom Phone (Voicemails, Call Logs, Fax)

**Auth:** Server-to-Server OAuth (account-level credentials)
- Account ID, Client ID, Client Secret stored in Secrets Manager
- Token cached in Lambda memory, refreshed 5 minutes before expiry

**Voicemail End-to-End Flow:**
1. Staff opens Voicemails page -> frontend calls `GET /zoom/voicemails`
2. Lambda fetches voicemails from 7 Zoom endpoints (user, account, auto receptionists, call queues, common areas, other users)
3. Deduplicates by Zoom voicemail ID
4. IVR routing determines category based on callee name or extension number
5. Audio is downloaded from Zoom, cached in S3 (KMS encrypted), and a presigned URL is returned
6. Caller phone is matched against patient records (normalized 10-digit comparison)
7. A DynamoDB voicemail attachment record is created
8. A todo task is auto-created with the appropriate type
9. Frontend displays voicemail list with audio player, patient match, and category badge
10. Staff can attach unmatched voicemails to patients, archive them, or play audio

**Fax Flow:**
1. Staff fills out the Fax form (pharmacy name, fax number, Rx details)
2. Frontend calls `POST /faxes`
3. Lambda sends fax via Zoom Phone fax API using the configured fax extension
4. Fax record stored in DynamoDB

**Call Logs:**
- Fetched from Zoom Phone for display in call history

### Google Calendar (Appointments)

**Auth:** OAuth2 refresh token flow
- Client ID, Client Secret, Refresh Token, Calendar ID stored in Secrets Manager
- Access tokens cached in Lambda memory, refreshed 60s before expiry
- Uses org's shared calendar (not service account — org policy blocked SA keys)

**Appointment End-to-End Flow:**
1. Staff opens Appointments page for a date -> frontend calls `GET /appointments?date=2026-03-10`
2. Lambda fetches events from Google Calendar API for the date range
3. Event summary is parsed for patient name and appointment type
4. Event description is parsed for phone and email
5. Phone numbers are matched against DynamoDB patients
6. **New patients are auto-created** if an appointment has a phone number not in the system
7. Status is merged: Google cancelled + DynamoDB no-show/completed flags
8. Frontend displays appointment cards with patient info, time, status actions
9. Staff can mark appointments as completed, no-show, or cancelled

**Expected Google Calendar event format:**
```
Summary: "Jane Doe - New Patient" or "New Patient Consultation (Jane Doe)"
Description: "Phone: (727) 365-6747\nEmail: jane@example.com\nAny other notes"
```

### Stripe (Billing & Payments)

**Auth:** Stripe secret key stored in Secrets Manager

**End-to-End Flows:**

*Charge a patient:*
1. Staff navigates to Billing -> Charge Patient
2. Searches for patient in Stripe by name/email/phone (`GET /stripe/customers`)
3. Selects patient and enters amount
4. Frontend calls `POST /stripe/payment-intent` with customer ID and amount
5. Stripe charges the patient's saved card

*Save a card:*
1. Staff navigates to Billing -> Add Card
2. Frontend calls `POST /stripe/setup-intent` to get a client secret
3. Stripe Elements collects card details securely (PCI-compliant)
4. Frontend calls `POST /stripe/confirm-setup` to attach card to customer

*No-show fee:*
1. Staff navigates to Billing -> No-Show
2. Selects patient and confirms no-show charge amount
3. Frontend calls `POST /stripe/charge-no-show` which charges saved card

### Slack (Notifications)

**Auth:** Incoming webhook URL stored in Secrets Manager

**Events that trigger Slack alerts:**

| Event | Level | Source |
|---|---|---|
| User signed in | info (green) | post-authentication Cognito trigger |
| New patient created | info (green) | create-patient Lambda |
| Failed login attempt | warning (amber) | notify-login-failure Lambda |
| Billing DLQ message | critical (red) | dlq-alert Lambda |
| Voicemail transcription done | info (green) | vm-complete-transcription Lambda |

**Format:** Rich Slack attachments with color-coded severity, structured fields (no PHI — only initials), environment tag, and ISO timestamp. All alerts are **non-throwing** — Slack failures never break app functionality.

---

## Transcription Pipeline

Two parallel Step Functions pipelines handle audio transcription using **AWS Transcribe Medical**.

### Dictation Pipeline

**Trigger:** Audio file uploaded to `s3://vantage-audio-{stage}/dictations/` -> EventBridge rule -> S3 trigger Lambda -> Step Functions

**State Machine Flow:**
```
S3 Upload -> [S3 Trigger Lambda]
               |
         [Start Transcription]   Starts AWS Transcribe Medical job
               |
         [Wait 30 seconds]
               |
         [Check Status]          Polls Transcribe API
               |
         +--- Choice ---+
         |               |
    COMPLETED        IN_PROGRESS
         |               |
    [Process Result]  [Wait 30s] -> loop back to Check
         |
    Updates DynamoDB:
      status = DraftReady
      transcript_text = <full text>
      confidence = <score>
```

**Pipeline details:**
- Uses `StartMedicalTranscriptionJob` with medical vocabulary for clinical accuracy
- Transcription output stored in S3 transcript bucket (KMS encrypted)
- Complete Lambda reads transcript JSON, extracts text and confidence, updates DynamoDB dictation record
- 30-minute max timeout per transcription job

### Voicemail Pipeline

**Trigger:** Voicemail audio cached in `s3://vantage-audio-{stage}/voicemails/` -> EventBridge rule -> VM S3 trigger Lambda -> Step Functions

Same state machine pattern as dictation pipeline, with additional features:
- Start Lambda checks for idempotent re-triggers (skips if already completed or in progress)
- Complete Lambda updates the voicemail attachment record with transcript text and transcriptStatus
- Sends Slack notification on completion
- Both COMPLETED and FAILED states route through the completion Lambda (it handles both, updating DynamoDB accordingly)

---

## Billing Pipeline

```
Frontend -> POST /billing/charge -> [billing-charge Lambda]
                                         |
                                    EventBridge (vantage-billing-{stage})
                                         |
                               +--- EventBridge Rules ---+
                               |                         |
                     { provider: "stripe" }    { provider: "quickbooks" }
                               |                         |
                     [Stripe Processor]        [QuickBooks Processor]
                               |                         |
                          Charges card             Records invoice
                               |                         |
                     Updates DynamoDB            Updates DynamoDB
                     with BILLING#/EVENT        with BILLING#/EVENT

                     On failure -> SQS DLQ -> [DLQ Alert Lambda] -> Slack
```

**Components:**
- **EventBridge bus:** `vantage-billing-{stage}` receives billing events
- **Stripe processor:** Handles `ChargeRequested` events with `provider: "stripe"`
- **QuickBooks processor:** Handles `ChargeRequested`, `RefundRequested`, `RecordEvent` events with `provider: "quickbooks"`
- **Dead Letter Queue:** Failed billing events go to SQS DLQ with 14-day retention. Retry attempts: 2.
- **DLQ Alert Lambda:** Triggered immediately when a message hits the DLQ. Sends a critical Slack alert.

---

## Security & HIPAA Compliance

### Encryption
- **DynamoDB:** Customer-managed KMS key with automatic annual rotation
- **S3 buckets:** KMS server-side encryption for all audio and transcript objects
- **All S3 buckets:** Block all public access, enforce SSL, versioning enabled
- **Auth tokens:** Stored in `sessionStorage` (not `localStorage`) — cleared when tab closes

### Access Control
- **Cognito MFA:** Required for all users (EMAIL_OTP via SES)
- **Domain restriction:** Pre-sign-up Lambda allows only `@vantagerefinery.com` and `@amplefi.com`
- **API Gateway authorizer:** All routes (except login failure notification) require valid Cognito JWT
- **Advanced security:** Cognito advanced security mode `ENFORCED` (compromised credential detection, adaptive authentication)
- **Token revocation:** Enabled on the User Pool Client
- **Prevent user existence errors:** `preventUserExistenceErrors: true` — login failures don't reveal whether an email is registered

### Audit Logging
- `writeAuditLog()` in `infra/lambda/shared/dynamo.ts` records every significant action:
  - `CREATE_PATIENT`, `AUTO_CREATE_PATIENT`, `CREATE_TASK`, `AUTO_CREATE_TASK`, `UPDATE_TASK`, `ARCHIVE_VOICEMAIL`, `ATTACH_VOICEMAIL`, `CREATE_NOTE`, etc.
- Audit entries stored with PK=`AUDIT#{date}` for time-scoped queries
- **7-year TTL** on audit records (HIPAA retention requirement)
- **No PHI in audit details** — only entity IDs, action types, and actor email
- CloudTrail enabled for all S3 data events (read/write) on both buckets with file validation

### Data Protection
- `dataTraceEnabled: false` on API Gateway — request/response bodies are **never** logged to CloudWatch
- Error messages to the frontend are sanitized — raw Lambda/Cognito errors never exposed
- Slack alerts include only initials (e.g., "J. Smith"), never full patient names or PHI
- **15-minute inactivity auto-logout** with 2-minute warning dialog
- S3 lifecycle: voicemail audio retained ~7 years (HIPAA), dictation audio per configured retention (default 90 days)

### CORS
Strict origin allowlist:
- `https://providerdev.vantagerefinery.com`
- `https://main.dvufomlgdfium.amplifyapp.com`
- `http://localhost:5173` and `http://localhost:4173` (dev only)

### Security Headers
All Lambda responses include:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`

### Password Policy
- Minimum 8 characters
- Requires: uppercase, lowercase, digit, symbol
- Temporary passwords expire after 1 day

---

## Secrets Management

All third-party credentials are stored in **AWS Secrets Manager** at `vantage/credentials/{stage}`.

| Key | Service | Required |
|---|---|---|
| `ZOOM_ACCOUNT_ID` | Zoom Server-to-Server OAuth | Yes |
| `ZOOM_CLIENT_ID` | Zoom Server-to-Server OAuth | Yes |
| `ZOOM_CLIENT_SECRET` | Zoom Server-to-Server OAuth | Yes |
| `ZOOM_USER_EMAIL` | Zoom Phone user for voicemail queries | Yes |
| `ZOOM_AUTO_RECEPTIONIST_IDS` | Comma-separated auto receptionist IDs | Yes |
| `ZOOM_FAX_EXTENSION_ID` | Zoom Phone fax extension | Yes |
| `GOOGLE_CLIENT_ID` | Google Calendar OAuth | Optional |
| `GOOGLE_CLIENT_SECRET` | Google Calendar OAuth | Optional |
| `GOOGLE_REFRESH_TOKEN` | Google Calendar OAuth | Optional |
| `GOOGLE_CALENDAR_ID` | Target Google Calendar | Optional |
| `STRIPE_SECRET_KEY` | Stripe API | Yes |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook | Optional |

**How it works:**
- `infra/lambda/shared/secrets.ts` exports `getSecrets()`
- Fetches from Secrets Manager on Lambda cold start only
- Cached in-memory for the Lambda execution environment lifetime
- Validates that all required fields are present; throws descriptive error if missing
- All Lambdas that need third-party credentials are granted `secretsmanager:GetSecretValue` via CDK

---

## Local Development

### Prerequisites
- Node.js 20+
- npm

### Setup

```bash
# Install frontend dependencies
npm install

# Set environment variables (create .env.local)
# VITE_API_BASE_URL=https://xxxxxxxx.execute-api.us-east-1.amazonaws.com/dev
# VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
# VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
# VITE_AWS_REGION=us-east-1

# Start dev server
npm run dev
# -> http://localhost:5173
```

### Project Structure

```
VantageApp/
|-- src/
|   |-- main.tsx                         # React entry point
|   |-- App.tsx                          # Router + providers
|   |-- api/
|   |   |-- client.ts                   # Typed fetch wrapper
|   |   |-- endpoints.ts                # All API endpoint functions
|   |   +-- types.ts                    # Zod schemas + TypeScript types
|   |-- auth/
|   |   |-- cognito.ts                  # Direct Cognito API calls
|   |   |-- AuthProvider.tsx             # Auth context + inactivity timeout
|   |   +-- LoginPage.tsx                # Login/signup/MFA UI
|   |-- components/
|   |   |-- Layout.tsx                   # App shell (sidebar + content)
|   |   |-- Sidebar.tsx                  # Desktop nav
|   |   |-- BottomNav.tsx                # Mobile nav
|   |   |-- NewPatientModal.tsx          # Patient creation form
|   |   +-- ui/                          # Reusable UI primitives
|   |       |-- Button.tsx, Card.tsx, Input.tsx, Select.tsx,
|   |       |-- Modal.tsx, Badge.tsx, Tabs.tsx, Toast.tsx,
|   |       +-- ConfirmDialog.tsx, EmptyState.tsx, LoadingSpinner.tsx
|   |-- lib/
|   |   |-- settings.ts                 # Office settings (localStorage)
|   |   +-- queryClient.ts              # React Query client config
|   +-- pages/
|       |-- Dashboard.tsx
|       |-- Voicemails.tsx
|       |-- Todos.tsx
|       |-- Appointments.tsx
|       |-- Dictations.tsx
|       |-- DictationMode.tsx
|       |-- Patients.tsx
|       |-- PatientProfile.tsx
|       |-- Fax.tsx
|       |-- Settings.tsx
|       +-- stripe/
|           |-- StripeDashboard.tsx
|           |-- PatientLookup.tsx
|           |-- ChargePatient.tsx
|           |-- NoShowFee.tsx
|           +-- AddCard.tsx
|-- infra/
|   |-- bin/
|   |   +-- vantage-app.ts              # CDK app entry point
|   |-- lib/
|   |   |-- auth-stack.ts               # Cognito User Pool + triggers
|   |   |-- storage-stack.ts            # DynamoDB + S3 + KMS + CloudTrail
|   |   |-- api-stack.ts                # API Gateway + all Lambdas
|   |   |-- pipeline-stack.ts           # Dictation transcription pipeline
|   |   |-- voicemail-pipeline-stack.ts  # Voicemail transcription pipeline
|   |   +-- billing-stack.ts            # EventBridge billing + DLQ
|   +-- lambda/
|       |-- api/                         # API Lambda handlers (28+)
|       |-- auth/                        # Cognito trigger Lambdas
|       |-- billing/                     # Billing processor Lambdas
|       |-- notifications/               # DLQ alert Lambda
|       |-- transcription/               # Transcription pipeline Lambdas
|       +-- shared/                      # Shared utilities (auth, dynamo, response, secrets, google, zoom, slack)
|-- package.json
|-- vite.config.ts
|-- tsconfig.json
|-- tailwind.config.js
+-- postcss.config.js
```

---

## Deployment

### Frontend (Amplify)

The frontend is hosted on AWS Amplify, which auto-deploys from the `main` branch.

```bash
npm run build    # tsc + vite build -> dist/
```

Output directory: `dist/`

### Backend (CDK)

```bash
cd infra
npm install
npx cdk deploy --all -c environment=dev
```

This deploys all 6 stacks: Storage, Auth, Api, Pipeline, VmPipeline, Billing.

**Important post-deploy note:** CDK deploy resets Lambda environment variables to what's defined in CDK code. All third-party credentials (Zoom, Google, Stripe, Slack) are now fetched at runtime from Secrets Manager, so CDK deploys should no longer wipe credentials. However, if any Lambda still uses hardcoded env vars, they must be manually restored after deploy.

---

## Environment Variables

### Frontend (.env.local)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_BASE_URL` | API Gateway base URL | `https://xxx.execute-api.us-east-1.amazonaws.com/dev` |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `us-east-1_XXXXXXXXX` |
| `VITE_COGNITO_CLIENT_ID` | Cognito User Pool Client ID | `xxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `VITE_AWS_REGION` | AWS region | `us-east-1` |

### Lambda (set by CDK)

| Variable | Description | Example |
|---|---|---|
| `TABLE_NAME` | DynamoDB table name | `vantage-dev` |
| `AUDIO_BUCKET` | S3 audio bucket name | `vantage-audio-dev-841722554807` |
| `TRANSCRIPT_BUCKET` | S3 transcript bucket name | `vantage-transcripts-dev-841722554807` |
| `KMS_KEY_ARN` | KMS encryption key ARN | `arn:aws:kms:us-east-1:...` |
| `STAGE` | Deployment stage | `dev` |
| `SECRET_NAME` | Secrets Manager secret name | `vantage/credentials/dev` |
| `PRESIGN_EXPIRY_SECONDS` | Presigned URL expiry (seconds) | `900` |
| `MAX_UPLOAD_SIZE_MB` | Max upload size | `100` |
| `STATE_MACHINE_ARN` | Step Functions ARN (triggers only) | `arn:aws:states:...` |
| `BILLING_EVENT_BUS` | EventBridge bus name (billing only) | `vantage-billing-dev` |
