# Vantage Medical Office

A simple, friendly medical office management app built as an installable web app (PWA). Designed for desktop Chrome and mobile Chrome with an emphasis on ease-of-use for all ages.

**This repository is the frontend only.** Backend integration points are stubbed with typed API clients and mock data so the UI is fully functional in Demo Mode.

---

## Features

### A) Voicemail Inbox + Patient Attachment + Auto-Todos

- **Incoming Voicemails** inbox with caller info, category (Scheduling / Refills / Basic Questions / Everything Else), duration, and playback controls
- **Attach to Patient** — search existing patients or create a new patient record on the fly
- Attaching a voicemail **auto-generates a to-do** based on the call category
- Filter voicemails by Unattached / Attached status

### B) To-Do List

- Filter: All / Open / Today / Overdue / Done
- Sorted by priority (High → Med → Low) then recency
- Each to-do shows patient, category badge, priority, due date, assigned staff
- Actions: Mark done (with confirmation), add notes, assign to staff, set due date, change priority

### C) Patient Profiles + Dictation Notes

- Searchable patient list with large, tap-friendly rows
- Patient profile with tabbed views: Overview, Voicemails, To-Dos, Notes, Documents
- **Dictation Mode** — hands-free note capture:
  - Large mic button using Web Speech API (graceful fallback to typing)
  - Template buttons: SOAP, Follow-up, Medication Change
  - Live transcript editing and save

### D) Fax to Pharmacy

- Compose fax: select patient, enter pharmacy details, fill Rx form
- Optional file attachment (PDF/image) via S3 upload stub
- Fax history list with status badges (Queued / Sent / Failed)

### E) Settings

- Office name, timezone, staff list management
- API base URL configuration
- AWS/S3 and Zoom Phone settings (UI only)
- **Demo Mode toggle** — switches between mock data and real API

### F) Dashboard

- Big tiles for quick navigation: Voicemails, To-Dos, Patients, Fax, Settings
- Live counts: unattached voicemails, open to-dos, overdue alert

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Bundler | Vite 6 |
| Styling | TailwindCSS 3 |
| Routing | React Router 6 |
| Data fetching | TanStack React Query 5 |
| Validation | Zod |
| Icons | lucide-react |
| PWA | Web manifest + theme color |

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Start dev server
npm run dev

# 3. Open in browser
# → http://localhost:5173
```

### Production build

```bash
npm run build
npm run preview  # preview production build locally
```

### Environment Variables

Copy `.env.example` to `.env`:

```
VITE_API_BASE_URL=         # Backend API URL (leave empty for Demo Mode)
VITE_S3_BUCKET=vantage-uploads
VITE_S3_REGION=us-east-1
VITE_ZOOM_PHONE_NUMBER=
```

> In Demo Mode, all environment variables are ignored — mock data is used.

---

## Project Structure

```
src/
├── api/
│   ├── types.ts          # All TypeScript interfaces + Zod schemas
│   ├── client.ts         # Typed fetch wrapper (GET/POST/PUT/DELETE/Upload)
│   ├── endpoints.ts      # API functions with mock fallback
│   └── mock-data.ts      # Seed data (10 patients, 12 voicemails, etc.)
├── components/
│   ├── ui/               # Reusable UI components
│   │   ├── Badge.tsx
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Input.tsx     # Input + TextArea
│   │   ├── LoadingSpinner.tsx
│   │   ├── Modal.tsx
│   │   ├── Select.tsx
│   │   ├── Tabs.tsx
│   │   └── Toast.tsx     # Toast context provider + useToast hook
│   ├── Layout.tsx        # Main layout with sidebar + bottom nav
│   ├── Sidebar.tsx       # Desktop left sidebar
│   └── BottomNav.tsx     # Mobile bottom navigation
├── lib/
│   ├── settings.ts       # localStorage-backed settings
│   └── utils.ts          # Formatting helpers (dates, phone, etc.)
├── pages/
│   ├── Dashboard.tsx
│   ├── Voicemails.tsx
│   ├── Todos.tsx
│   ├── Patients.tsx
│   ├── PatientProfile.tsx
│   ├── DictationMode.tsx
│   ├── Fax.tsx
│   └── Settings.tsx
├── App.tsx               # Router + Query provider setup
├── main.tsx              # Entry point
└── index.css             # Tailwind + custom styles
```

---

## API Contract for Backend Engineer

The frontend expects these REST endpoints. In Demo Mode, `src/api/endpoints.ts` intercepts all calls and returns mock data. When `demoMode` is off, real HTTP requests are made to `{apiBaseUrl}{path}`.

### Endpoints

| Method | Path | Request Body | Response |
|---|---|---|---|
| `GET` | `/dashboard/counts` | — | `{ unattachedVoicemails, openTodos, overdueTodos, totalPatients }` |
| `GET` | `/patients` | — | `Patient[]` |
| `GET` | `/patients/:id` | — | `Patient` |
| `POST` | `/patients` | `{ firstName, lastName, phone, dob? }` | `Patient` |
| `GET` | `/voicemails` | — | `Voicemail[]` |
| `POST` | `/voicemails/attach` | `{ voicemailId, patientId, isNewPatient }` | `Voicemail` |
| `GET` | `/todos` | — | `Todo[]` |
| `POST` | `/todos` | `Todo` (without id/createdAt) | `Todo` |
| `PUT` | `/todos/:id` | `{ status?, notes?, assignedTo?, dueDate?, priority? }` | `Todo` |
| `GET` | `/patients/:id/notes` | — | `Note[]` |
| `POST` | `/patients/:id/notes` | `{ title, body }` | `Note` |
| `GET` | `/patients/:id/voicemails` | — | `Voicemail[]` |
| `GET` | `/patients/:id/todos` | — | `Todo[]` |
| `GET` | `/faxes` | — | `Fax[]` |
| `POST` | `/faxes` | `SendFaxRequest` | `Fax` |
| `POST` | `/upload` | `FormData { file, folder }` | `{ url, key }` |

### Data Types

See `src/api/types.ts` for full TypeScript interfaces and Zod schemas:

- `Patient` — id, firstName, lastName, phone, dob?, createdAt
- `Voicemail` — id, callerNumber, callerName?, receivedAt, category, durationSeconds, audioUrl, attachedTo, status
- `Todo` — id, patientId?, voicemailId?, type, title, notes?, status, priority, dueDate?, assignedTo?, createdAt
- `Note` — id, patientId, createdAt, title, body
- `Fax` — id, patientId?, createdAt, pharmacyName, pharmacyFax, pharmacyPhone?, status, rxDetails, attachmentUrl?

---

## How Demo Mode Works

1. On first launch, `demoMode` is **on** by default.
2. All API calls in `src/api/endpoints.ts` check `getSettings().demoMode`.
3. When **on**: functions return/mutate in-memory mock data with simulated delays.
4. When **off**: functions call the real HTTP client (`src/api/client.ts`).
5. Toggle Demo Mode in Settings → Demo Mode switch.
6. Mock data resets on page refresh (it lives in module-scope variables).

---

## Accessibility & Responsive Design

- **Keyboard navigation**: All interactive elements are focusable with visible focus rings.
- **ARIA attributes**: Modals use `role="dialog"` + `aria-modal`, tabs use `role="tab"` + `aria-selected`, nav uses `aria-label`.
- **Contrast**: Color palette meets WCAG AA for text on backgrounds.
- **Touch targets**: Minimum 44px height on all buttons and interactive elements.
- **Responsive layout**:
  - Desktop (≥1024px): Left sidebar navigation
  - Mobile (<1024px): Bottom tab bar with "More" overflow menu
- **Large, clear typography**: 16px base font, bold headings, generous whitespace.
- **Forgiving forms**: No required field red-flags until submission, clear error messages.

---

## Security Notes (HIPAA Considerations)

This is a **UI-only** implementation. When connecting to a real backend:

- **Never log PHI** (patient names, DOB, phone numbers) to the browser console in production.
- **No PHI in localStorage** — current implementation only stores settings (office name, staff list). Patient data should only live in the API layer.
- **HTTPS required** — the PWA manifest assumes HTTPS in production.
- **Session management** — implement proper auth tokens (not localStorage sessions) for production.
- **Audit logging** — the backend should log access to patient records.
- **S3 uploads** — use presigned URLs with expiration; never expose AWS credentials to the browser.
- **Fax content** — Rx details should be encrypted in transit and at rest.

---

## Known Limitations

- **No real Zoom Phone integration** — voicemails are mock data. Backend must implement Zoom Phone API webhooks.
- **No real fax sending** — the "Send Fax" button calls a stub. Backend must integrate with a fax API (e.g., Phaxio, RingCentral).
- **No real S3 uploads** — the upload function simulates a response. Backend must implement presigned URL generation.
- **No authentication** — there is no login screen. Add auth (e.g., Cognito, Auth0) before production.
- **No real-time updates** — data refreshes on 30-second intervals via React Query. Consider WebSocket for live voicemail notifications.
- **Web Speech API** — dictation works in Chrome and Edge. Safari and Firefox have limited support; the app gracefully falls back to manual typing.
- **PWA icons** — placeholder icons are included. Replace with properly designed 192x192 and 512x512 PNG icons.
- **Service worker** — not included. Add one for offline support if needed.

---

## Color Palette

| Name | Hex | Usage |
|---|---|---|
| Charcoal | `#1C1C1C` | Primary text |
| Slate Blue | `#55677A` | Primary buttons, active nav, links |
| Tan/Sand | `#BEA883` | Secondary buttons |
| Warm Gray | `#A1A095` | Secondary text, placeholders |
| Off-White | `#F8F7F6` | Page background |
| Light Gray | `#E7E7E7` | Borders, dividers |
