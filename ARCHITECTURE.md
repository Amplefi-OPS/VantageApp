# Vantage — HIPAA-Aligned Physician Dictation & Task Management System

## Executive Summary

Vantage is an AWS-first physician workflow system that enables:

1. **Secure dictation upload** from iPhone (via pre-signed S3 URLs — no AWS credentials on device)
2. **Automated transcription** using AWS Transcribe Medical, orchestrated by Step Functions
3. **Task management portal** showing appointments, tasks, dictation transcripts, refills, and follow-ups
4. **Pluggable billing** via Stripe and QuickBooks, decoupled through EventBridge with dead-letter queues
5. **HIPAA alignment** via KMS encryption, MFA, audit logging, least-privilege IAM, and data minimization

**Key decisions made:**
- Region: `us-east-1`
- Audio formats: m4a, mp3, mp4, wav, flac (max 100 MB)
- IaC: AWS CDK (TypeScript)
- Frontend: React + Vite (existing), Cognito auth with MFA
- Patient IDs: Tokenized references (not SSN/MRN stored directly)
- Retention: Audio 90 days, transcripts 7 years (configurable)
- Single-table DynamoDB design with GSIs for efficient queries

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PHYSICIAN DEVICES                            │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │  iPhone   │  │ iOS Shortcut │  │  Web Portal (React/Vite)    │  │
│  │  Voice    │──│ calls POST   │──│  Cognito auth, task list,   │  │
│  │  Memos    │  │ /presign     │  │  transcript view, upload    │  │
│  └──────────┘  └──────┬───────┘  └──────────────┬───────────────┘  │
│                       │                          │                  │
└───────────────────────┼──────────────────────────┼──────────────────┘
                        │ HTTPS                    │ HTTPS
                        ▼                          ▼
              ┌─────────────────────────────────────────┐
              │         API Gateway (REST)               │
              │   Cognito Authorizer (JWT validation)    │
              │                                          │
              │  POST /uploads/presign                   │
              │  GET  /tasks?provider_id=&status=        │
              │  POST /tasks                             │
              │  PATCH /tasks/{task_id}                   │
              │  GET  /appointments?provider_id=&date=   │
              │  GET  /dictations/{dictation_id}         │
              │  POST /billing/charge                    │
              └─────────────┬───────────────────────────┘
                            │
              ┌─────────────┼───────────────────────┐
              │    Lambda Functions (Node 20, ARM)   │
              │                                      │
              │  presign-upload   → S3 pre-sign      │
              │  get-tasks        → DynamoDB query    │
              │  create-task      → DynamoDB put      │
              │  update-task      → DynamoDB update   │
              │  get-appointments → DynamoDB query    │
              │  get-dictation    → DynamoDB + S3     │
              │  billing-charge   → EventBridge put   │
              └──────────────┬──────────────────────┘
                             │
          ┌──────────────────┼──────────────────────────┐
          │                  │                           │
          ▼                  ▼                           ▼
  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐
  │   DynamoDB   │  │  S3 Audio     │  │  S3 Transcripts          │
  │  (single     │  │  Bucket       │  │  Bucket                  │
  │   table,     │  │  SSE-KMS      │  │  SSE-KMS                 │
  │   KMS enc)   │  │  lifecycle:   │  │  lifecycle: 7 years      │
  │              │  │  90 days      │  │                          │
  └──────────────┘  └───────┬───────┘  └──────────────────────────┘
                            │
                    S3 Event Notification
                    (OBJECT_CREATED)
                            │
                            ▼
                  ┌──────────────────┐
                  │  S3 Trigger      │
                  │  Lambda          │──→ Starts Step Functions
                  └──────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │     Step Functions            │
              │                               │
              │  1. Start Transcribe Medical  │
              │  2. Wait 30s                  │
              │  3. Check job status          │
              │  4. Choice:                   │
              │     COMPLETED → Process       │
              │     FAILED → Handle failure   │
              │     IN_PROGRESS → loop to 2   │
              └──────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    ▼               ▼
            ┌────────────┐  ┌────────────────┐
            │ Complete    │  │ Failed         │
            │ Transcript  │  │ Update task    │
            │ → DynamoDB  │  │ status to      │
            │ → S3 store  │  │ "Failed"       │
            │ → Task      │  └────────────────┘
            │   update    │
            └─────────────┘

              ┌──────────────────────────────┐
              │     EventBridge               │
              │     (Billing Bus)             │
              │                               │
              │  "ChargeRequested"            │
              │  "RefundRequested"            │
              │  "RecordEvent"                │
              └──────────────┬────────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
          ┌──────────────┐  ┌──────────────────┐
          │ Stripe       │  │ QuickBooks       │
          │ Processor    │  │ Processor        │
          │ Lambda       │  │ Lambda           │
          │ (DLQ backup) │  │ (DLQ backup)     │
          └──────────────┘  └──────────────────┘
```

### AWS Services Used

| Service | Purpose | HIPAA BAA |
|---------|---------|-----------|
| S3 | Audio + transcript storage | Yes |
| KMS | Encryption key management | Yes |
| DynamoDB | Tasks, appointments, dictations, billing, audit | Yes |
| Lambda | All compute | Yes |
| API Gateway | REST API with auth | Yes |
| Cognito | User authentication + MFA | Yes |
| Step Functions | Transcription pipeline orchestration | Yes |
| Transcribe Medical | Audio-to-text transcription | Yes |
| EventBridge | Async billing event routing | Yes |
| SQS | Dead-letter queue for billing failures | Yes |
| CloudTrail | API and data access audit logging | Yes |
| Secrets Manager | Stripe/QuickBooks credentials | Yes |

---

## 2. Data Model

### Single-Table DynamoDB Design

Table name: `vantage-{stage}` (e.g., `vantage-dev`)

| Entity | PK | SK | GSI1PK | GSI1SK | GSI2PK | GSI2SK |
|--------|----|----|--------|--------|--------|--------|
| Provider | `PROVIDER#{id}` | `PROFILE` | — | — | — | — |
| Task | `PROVIDER#{id}` | `TASK#{taskId}` | `PROVIDER#{id}` | `TASKSTATUS#{status}#{createdAt}` | `TASK` | `{createdAt}#{taskId}` |
| Appointment | `PROVIDER#{id}` | `APPT#{date}#{apptId}` | `PROVIDER#{id}` | `APPTSTATUS#{status}#{startTime}` | `APPOINTMENT` | `{date}#{apptId}` |
| Dictation | `PROVIDER#{id}` | `DICT#{dictId}` | `PROVIDER#{id}` | `DICTSTATUS#{status}#{createdAt}` | `DICTATION` | `{date}#{dictId}` |
| Patient Ref | `PATIENT#{token}` | `PROFILE` | — | — | — | — |
| Billing Event | `BILLING#{billId}` | `EVENT` | `PROVIDER#{id}` | `BILLING#{createdAt}` | `BILLING` | `{createdAt}#{billId}` |
| Audit Log | `AUDIT#{date}` | `{timestamp}#{entityType}#{entityId}` | — | — | — | — |

### Entity Schemas

#### Task
```json
{
  "PK": "PROVIDER#dr-smith-001",
  "SK": "TASK#task-abc123",
  "taskId": "task-abc123",
  "providerId": "dr-smith-001",
  "patientId": "pt-token-abc",
  "type": "Dictation",
  "title": "Review dictation: progress note",
  "status": "DraftReady",
  "priority": "Med",
  "dueDate": "2024-01-20",
  "assignedTo": "Dr. Smith",
  "notes": "Transcript ready (confidence: 94.0%)",
  "dictationId": "dict-abc123",
  "voicemailId": null,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:35:00Z",
  "entityType": "Task"
}
```

#### Dictation
```json
{
  "PK": "PROVIDER#dr-smith-001",
  "SK": "DICT#dict-abc123",
  "dictationId": "dict-abc123",
  "providerId": "dr-smith-001",
  "patientId": "pt-token-abc",
  "taskId": "task-abc123",
  "appointmentId": "appt-456",
  "noteType": "progress_note",
  "status": "DraftReady",
  "audioKey": "dictations/dr-smith-001/2024-01-15/dict-abc123.m4a",
  "transcriptKey": "transcripts/dr-smith-001/2024-01-15/dict-abc123.json",
  "transcriptText": "Patient presents with...",
  "confidence": 0.94,
  "jobName": "vantage-dict-abc123-1705312200000",
  "originalFilename": "recording.m4a",
  "contentType": "audio/mp4",
  "idempotencyKey": "uuid-here",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:35:00Z",
  "entityType": "Dictation"
}
```

#### Appointment
```json
{
  "PK": "PROVIDER#dr-smith-001",
  "SK": "APPT#2024-01-15#appt-abc123",
  "appointmentId": "appt-abc123",
  "providerId": "dr-smith-001",
  "patientId": "pt-token-abc",
  "patientName": "J. Doe",
  "appointmentType": "in_office",
  "startTime": "2024-01-15T09:00:00Z",
  "endTime": "2024-01-15T09:30:00Z",
  "status": "scheduled",
  "reason": "Follow-up visit",
  "notes": "",
  "entityType": "Appointment"
}
```

#### Billing Event
```json
{
  "PK": "BILLING#bill-abc123",
  "SK": "EVENT",
  "billingEventId": "bill-abc123",
  "providerId": "dr-smith-001",
  "taskId": "task-123",
  "action": "charge",
  "providerType": "stripe",
  "amountCents": 5000,
  "currency": "usd",
  "description": "Office visit copay",
  "billingReference": "INV-2024-001",
  "idempotencyKey": "uuid-here",
  "status": "submitted",
  "stripeStatus": "completed",
  "stripeExternalId": "ch_abc123",
  "quickbooksStatus": null,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:35:00Z",
  "entityType": "BillingEvent"
}
```

### Task Statuses (lifecycle)
```
Open → AwaitingTranscription → Transcribing → DraftReady → Done
                                    ↓
                           TranscriptionFailed (→ retry → Transcribing)
```

### Task Types
- `Schedule` — schedule an appointment
- `Refill` — process a prescription refill
- `CallBack` — return a patient call
- `SendDocs` — send documents
- `General` — general follow-up
- `Dictation` — review dictation transcript

---

## 3. API Design

Base URL: `https://{api-id}.execute-api.us-east-1.amazonaws.com/{stage}`

All endpoints require `Authorization: Bearer {cognito_id_token}` header.

### POST /uploads/presign

Request pre-signed S3 PUT URL for audio upload.

**Request:**
```json
{
  "provider_id": "dr-smith-001",
  "patient_id": "pt-token-abc",
  "task_id": "task-123",
  "note_type": "progress_note",
  "appointment_id": "appt-456",
  "filename": "recording.m4a",
  "content_type": "audio/mp4",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (200):**
```json
{
  "upload_url": "https://vantage-audio-dev-123456.s3.us-east-1.amazonaws.com/dictations/dr-smith-001/2024-01-15/dict-abc123.m4a?X-Amz-Algorithm=...",
  "object_key": "dictations/dr-smith-001/2024-01-15/dict-abc123.m4a",
  "dictation_id": "dict-abc123",
  "expires_in": 900
}
```

### GET /tasks

**Query Parameters:**
- `provider_id` (required)
- `status` (optional): Open, Done, AwaitingTranscription, DraftReady, TranscriptionFailed
- `type` (optional): Schedule, Refill, CallBack, SendDocs, General, Dictation
- `due_before` (optional): ISO date
- `limit` (optional, default 50, max 200)

**Response (200):**
```json
{
  "tasks": [
    {
      "task_id": "task-abc123",
      "provider_id": "dr-smith-001",
      "patient_id": "pt-token-abc",
      "type": "Dictation",
      "title": "Review dictation: progress note",
      "status": "DraftReady",
      "priority": "Med",
      "due_date": "2024-01-20",
      "dictation_id": "dict-abc123",
      "assigned_to": "Dr. Smith",
      "notes": "Transcript ready",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:35:00Z"
    }
  ],
  "count": 1,
  "next_token": null
}
```

### POST /tasks

**Request:**
```json
{
  "provider_id": "dr-smith-001",
  "patient_id": "pt-token-abc",
  "type": "Refill",
  "title": "Process metformin refill",
  "priority": "Med",
  "due_date": "2024-01-20",
  "assigned_to": "Dr. Smith",
  "notes": "Patient requests 90-day supply"
}
```

**Response (201):**
```json
{
  "task_id": "task-def456",
  "provider_id": "dr-smith-001",
  "status": "Open",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### PATCH /tasks/{task_id}

**Request:**
```json
{
  "provider_id": "dr-smith-001",
  "status": "Done",
  "notes": "Reviewed and signed"
}
```

**Response (200):** Updated task object.

### GET /appointments

**Query Parameters:**
- `provider_id` (required)
- `date` (optional, defaults to today)
- `range_end` (optional, for multi-day range)

**Response (200):**
```json
{
  "appointments": [
    {
      "appointment_id": "appt-abc123",
      "provider_id": "dr-smith-001",
      "patient_id": "pt-token-abc",
      "patient_name": "J. Doe",
      "type": "in_office",
      "start_time": "2024-01-15T09:00:00Z",
      "end_time": "2024-01-15T09:30:00Z",
      "status": "scheduled",
      "reason": "Follow-up visit"
    }
  ],
  "count": 1
}
```

### GET /dictations/{dictation_id}

**Query Parameters:**
- `provider_id` (optional, defaults to caller's provider_id)

**Response (200):**
```json
{
  "dictation_id": "dict-abc123",
  "provider_id": "dr-smith-001",
  "patient_id": "pt-token-abc",
  "status": "DraftReady",
  "note_type": "progress_note",
  "audio_key": "dictations/.../dict-abc123.m4a",
  "transcript_key": "transcripts/.../dict-abc123.json",
  "transcript_text": "Patient presents with...",
  "confidence": 0.94,
  "task_id": "task-abc123",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:35:00Z"
}
```

### POST /billing/charge

**Request:**
```json
{
  "provider_id": "dr-smith-001",
  "task_id": "task-123",
  "action": "charge",
  "provider_type": "stripe",
  "amount_cents": 5000,
  "currency": "usd",
  "description": "Office visit copay",
  "billing_reference": "INV-2024-001",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (200):**
```json
{
  "billing_event_id": "bill-abc123",
  "status": "submitted",
  "message": "Billing event submitted for processing"
}
```

---

## 4. Transcription Pipeline

### Flow

```
S3 PUT (audio) → S3 Event → Lambda (trigger) → Step Functions
                                                      │
                                           ┌──────────┴──────────┐
                                           │ 1. Start Transcribe │
                                           │    Medical job      │
                                           │ 2. Wait 30 seconds  │
                                           │ 3. Check status     │
                                           │ 4. Choice:          │
                                           │    COMPLETED → 5    │
                                           │    FAILED → 6       │
                                           │    IN_PROGRESS → 2  │
                                           │ 5. Process result   │
                                           │ 6. Handle failure   │
                                           └─────────────────────┘
```

### Object Key Convention

**Audio:** `dictations/{provider_id}/{YYYY-MM-DD}/{dictation_id}.{ext}`
**Transcript:** `transcripts/{provider_id}/{YYYY-MM-DD}/{dictation_id}.json`

### Transcribe Medical Settings
- Language: `en-US`
- Specialty: `PRIMARYCARE`
- Type: `DICTATION`
- Output encryption: KMS (same key as S3)
- No speaker labels (single physician dictation)

### Status Transitions
```
Uploading → Transcribing → DraftReady
                        → TranscriptionFailed (retryable)
```

### Failure Handling
- Transcribe failure: Task status → `TranscriptionFailed`, dictation record stores `failureReason`
- Retry: Frontend can request re-upload or re-trigger transcription
- Step Functions timeout: 30 minutes max

---

## 5. Security + HIPAA Controls Checklist

### Encryption

| Layer | Method | Details |
|-------|--------|---------|
| S3 objects | SSE-KMS | Customer-managed KMS key with annual rotation |
| DynamoDB | Customer-managed KMS | Same key, encryption at rest |
| In transit | TLS 1.2+ | API Gateway enforces HTTPS, S3 enforceSSL |
| Secrets | Secrets Manager | Stripe/QuickBooks keys, encrypted at rest |

### Authentication & Authorization

| Control | Implementation |
|---------|----------------|
| MFA | Cognito MFA required (SMS + TOTP) |
| Password policy | 12+ chars, upper/lower/digit/symbol, 1-day temp password |
| Token lifetimes | Access: 60 min, ID: 60 min, Refresh: 7 days |
| Token revocation | Enabled in Cognito client |
| Self-sign-up | Disabled — admin-only user creation |
| Role-based access | Cognito groups (providers, admins) |
| Provider isolation | API Lambdas verify caller's provider_id matches request |
| Advanced security | Cognito Advanced Security Mode: ENFORCED |

### Audit & Logging

| Log Type | Service | Retention |
|----------|---------|-----------|
| API access | API Gateway execution logs | 1 year |
| S3 data events | CloudTrail | Retained per trail policy |
| S3 access logs | Server access logging | Same bucket lifecycle |
| Task transitions | DynamoDB audit entries | 7 years (TTL) |
| Billing actions | DynamoDB billing events | 7 years |
| Lambda execution | CloudWatch Logs | 1 year |
| Step Functions | CloudWatch Logs | 1 year |

### Data Minimization

- Patient IDs stored as tokenized references, not SSN/MRN directly
- Billing integrations receive only opaque `billing_reference`, amount, and description — no PHI
- API Gateway `dataTraceEnabled: false` to prevent PHI in API logs
- Transcript preview in DynamoDB limited to 4,000 chars — full text in S3
- S3 lifecycle policies auto-expire audio (90 days) and transcripts (7 years)

### Access Controls

- S3 `BlockPublicAccess.BLOCK_ALL` on all buckets
- S3 `enforceSSL: true` — reject non-HTTPS requests
- IAM least privilege — each Lambda only gets permissions for its specific operations
- No AWS credentials on client devices — pre-signed URLs only
- DynamoDB point-in-time recovery enabled
- S3 versioning enabled

### Network

- No VPC required (all managed services with IAM-based access)
- API Gateway throttling: 50 RPS sustained, 100 RPS burst
- Pre-signed URLs expire in 15 minutes
- CORS restricted (tighten `allowedOrigins` for production)

---

## 6. Infrastructure as Code

### Folder Structure

```
infra/
├── bin/
│   └── vantage-app.ts              # CDK entry point
├── lib/
│   ├── storage-stack.ts            # S3, KMS, DynamoDB, CloudTrail
│   ├── auth-stack.ts               # Cognito User Pool + Client
│   ├── api-stack.ts                # API Gateway + Lambda handlers
│   ├── pipeline-stack.ts           # Step Functions + S3 triggers
│   └── billing-stack.ts            # EventBridge + billing Lambdas + DLQ
├── lambda/
│   ├── shared/
│   │   ├── response.ts             # API Gateway response helpers
│   │   ├── dynamo.ts               # DynamoDB CRUD + audit logging
│   │   └── auth.ts                 # Cognito claims extraction
│   ├── api/
│   │   ├── presign-upload.ts       # POST /uploads/presign
│   │   ├── get-tasks.ts            # GET /tasks
│   │   ├── create-task.ts          # POST /tasks
│   │   ├── update-task.ts          # PATCH /tasks/{task_id}
│   │   ├── get-appointments.ts     # GET /appointments
│   │   ├── get-dictation.ts        # GET /dictations/{dictation_id}
│   │   └── billing-charge.ts       # POST /billing/charge
│   ├── transcription/
│   │   ├── s3-trigger.ts           # S3 event → start Step Functions
│   │   ├── start-transcription.ts  # Start Transcribe Medical job
│   │   ├── check-transcription.ts  # Poll job status
│   │   └── complete-transcription.ts # Process result + update DynamoDB
│   └── billing/
│       ├── charge-provider.ts      # IChargeProvider interface
│       ├── stripe-processor.ts     # Stripe implementation (stub)
│       └── quickbooks-processor.ts # QuickBooks implementation (stub)
├── cdk.json                        # CDK configuration
├── tsconfig.json
└── package.json
```

### CDK Stacks

| Stack | Resources |
|-------|-----------|
| `Vantage-Storage-{stage}` | KMS key, S3 audio bucket, S3 transcript bucket, DynamoDB table (+ GSIs), CloudTrail |
| `Vantage-Auth-{stage}` | Cognito User Pool, User Pool Client, groups, domain |
| `Vantage-Api-{stage}` | API Gateway, 7 Lambda functions, Cognito authorizer, IAM roles |
| `Vantage-Pipeline-{stage}` | S3 event triggers, 4 Lambda functions, Step Functions state machine |
| `Vantage-Billing-{stage}` | EventBridge bus, 2 Lambda processors, SQS DLQ, EventBridge rules |

### Deployment

```bash
cd infra
npm install
npx cdk bootstrap
npx cdk deploy --all --context environment=dev
```

### Configuration (cdk.json)

```json
{
  "context": {
    "environment": "dev",
    "region": "us-east-1",
    "retentionAudioDays": 90,
    "retentionTranscriptDays": 2555,
    "maxUploadSizeMb": 100,
    "acceptedAudioFormats": ["m4a", "mp3", "mp4", "wav", "flac"],
    "cognitoDomain": "vantage-health"
  }
}
```

---

## 7. Frontend

### Tech Stack
- React 18 + TypeScript + Vite
- TanStack Query (server state)
- Tailwind CSS (styling)
- Lucide icons
- AWS Amplify (hosting)

### Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `/` (when unauthenticated) | Email + password + MFA code |
| Dashboard | `/dashboard` | Metric tiles, alerts |
| Voicemails | `/voicemails` | Voicemail list, attach to patient |
| To-Do List | `/todos` | Task list with status/priority filters |
| Appointments | `/appointments` | Daily schedule with date picker |
| Dictations | `/dictations` | Upload audio, view transcripts |
| Patients | `/patients` | Patient directory |
| Patient Profile | `/patients/:id` | Patient details, linked items |
| Fax | `/fax` | Send prescriptions |
| Settings | `/settings` | App configuration |

### Auth Flow
1. User opens app → `AuthProvider` checks `sessionStorage` for tokens
2. No tokens or expired → render `LoginPage`
3. User enters email + password → calls Cognito `InitiateAuth`
4. If MFA challenge → show MFA code input → `RespondToAuthChallenge`
5. Tokens stored in `sessionStorage` (cleared on tab close)
6. All API calls include `Authorization: Bearer {idToken}`
7. Demo mode: auto-login with mock JWT, no Cognito calls

### Upload Flow (Web Portal)
1. User clicks "Upload Dictation" on Dictations page
2. File picker opens (accepts audio formats, max 100 MB)
3. Frontend calls `POST /uploads/presign` with metadata
4. Backend returns pre-signed S3 PUT URL
5. Frontend uploads file directly to S3 via PUT
6. S3 event triggers transcription pipeline
7. Frontend polls/refreshes task list to show progress

---

## 8. iPhone Shortcut Instructions

### Option A: iOS Shortcuts App

Create an iOS Shortcut named "Send Dictation" with these actions:

**Step 1: Get API Token**
```
Action: Get Contents of URL
URL: https://cognito-idp.us-east-1.amazonaws.com/
Method: POST
Headers:
  Content-Type: application/x-amz-json-1.1
  X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth
Body (JSON):
  {
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "{your-cognito-client-id}",
    "AuthParameters": {
      "USERNAME": "{your-email}",
      "PASSWORD": "{stored-in-keychain}"
    }
  }
Result: Extract AuthenticationResult.IdToken → save to variable "Token"
```

**Step 2: Select Audio File**
```
Action: Select File
  Types: Audio
  → Variable "AudioFile"
```

**Step 3: Get Pre-Signed URL**
```
Action: Get Contents of URL
URL: https://{api-id}.execute-api.us-east-1.amazonaws.com/{stage}/uploads/presign
Method: POST
Headers:
  Authorization: Bearer {Token}
  Content-Type: application/json
Body (JSON):
  {
    "provider_id": "{your-provider-id}",
    "filename": "{AudioFile.filename}",
    "content_type": "audio/mp4",
    "note_type": "progress_note",
    "idempotency_key": "{Current Date (UUID format)}"
  }
Result: Extract upload_url → "UploadURL", dictation_id → "DictationID"
```

**Step 4: Upload to S3**
```
Action: Get Contents of URL
URL: {UploadURL}
Method: PUT
Headers:
  Content-Type: audio/mp4
Body: File → {AudioFile}
```

**Step 5: Confirmation**
```
Action: Show Notification
Title: "Dictation Uploaded"
Body: "File sent for transcription. ID: {DictationID}"
```

### Option B: Simplified Shortcut (Using Share Sheet)

1. Record audio in Voice Memos
2. Tap Share → select "Send Dictation" shortcut
3. Shortcut automatically:
   - Authenticates with stored credentials
   - Requests pre-signed URL
   - Uploads the shared audio file
   - Shows confirmation notification

### Option C: Mobile Web Upload

Navigate to `https://portal.vantage.health/dictations` on iPhone Safari:

1. Tap "Upload Dictation" button
2. Select audio file from Files app or Voice Memos
3. File uploads via the same pre-signed URL flow
4. Progress indicator shows upload status
5. Task list auto-refreshes to show new dictation

### Security Notes for iPhone Upload
- No AWS credentials stored on the phone
- Pre-signed URLs expire after 15 minutes
- Each upload gets a unique idempotency key
- Cognito tokens stored in iOS Keychain (via Shortcuts)
- Audio encrypted in transit (HTTPS) and at rest (SSE-KMS)

---

## 9. Billing Integration Stubs

### Interface: IChargeProvider

```typescript
interface IChargeProvider {
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  refundCharge(request: ChargeRequest): Promise<RefundResult>;
  recordEvent(request: ChargeRequest): Promise<RecordResult>;
}
```

### ChargeRequest (no PHI)
```typescript
interface ChargeRequest {
  billing_event_id: string;
  provider_id: string;       // Internal reference only
  task_id: string | null;    // Internal reference only
  amount_cents: number;
  currency: string;
  description: string;       // Generic, no PHI
  billing_reference: string; // Opaque billing ID
  idempotency_key: string;
  requested_at: string;
  requested_by: string;      // Email of requester
}
```

### Flow

```
POST /billing/charge
    → Lambda validates request
    → Writes billing event to DynamoDB (status: "submitted")
    → Publishes to EventBridge bus
    → Returns billing_event_id to caller

EventBridge routes event by detail.provider:
    "stripe"     → Stripe Processor Lambda
    "quickbooks" → QuickBooks Processor Lambda

Processor Lambda:
    → Fetches API credentials from Secrets Manager
    → Calls external API (stub in current code)
    → Updates billing event in DynamoDB
    → Writes audit log

On failure:
    → Lambda retries 2x
    → Falls through to SQS Dead Letter Queue
    → Ops team monitors DLQ for manual intervention
```

### Enabling Integrations

**Stripe:** Store API key in Secrets Manager at `vantage/stripe-key-{stage}`
```bash
aws secretsmanager create-secret \
  --name vantage/stripe-key-dev \
  --secret-string "sk_test_..." \
  --region us-east-1
```

**QuickBooks:** Store OAuth credentials at `vantage/quickbooks-{stage}`
```bash
aws secretsmanager create-secret \
  --name vantage/quickbooks-dev \
  --secret-string '{"clientId":"...","clientSecret":"...","refreshToken":"...","realmId":"..."}' \
  --region us-east-1
```

### Disabling Integrations

If no secrets are stored, the processors will fail gracefully and log the error. The system operates normally without billing integrations — the `/billing/charge` endpoint simply returns "submitted" and the EventBridge event goes to the DLQ.

---

## 10. Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Upload interrupted | Idempotency key prevents duplicate processing; retry with same key |
| Duplicate upload | Same idempotency key → same dictation_id, no duplicate records |
| Transcription failure | Task status → TranscriptionFailed, UI shows retry button |
| Large audio file | Max 100 MB enforced in pre-sign Lambda; S3 handles multipart |
| Provider isolation | All queries scoped to caller's provider_id unless admin role |
| Token expiry | 60-minute access tokens; frontend redirects to login on 401 |
| Billing failure | 2 retries + DLQ; billing event status updated to "failed" |
| Concurrent updates | DynamoDB conditional writes prevent lost updates |
| S3 event duplication | Step Functions execution name includes dictation_id for idempotency |

---

## 11. Implementation Priorities

### Phase 1 (MVP)
1. Deploy CDK stacks (Storage, Auth, API)
2. Create first Cognito user manually
3. Verify presign + upload + task CRUD via curl/Postman
4. Deploy Pipeline stack, test end-to-end dictation flow
5. Connect frontend to real API (set `VITE_API_BASE_URL`)

### Phase 2
1. Deploy Billing stack
2. Configure Stripe/QuickBooks secrets
3. Replace billing stubs with real SDK calls
4. Add pagination to task/appointment queries

### Phase 3
1. iOS Shortcut for physician uploads
2. Appointment sync (import from scheduling system)
3. NLP summarization of transcripts (optional)
4. Patient-facing portal (future)
