# Notifications Spec

Working spec for extending the existing Slack alerting to cover more events. Edit this file before implementation — anything left as `TBD` is a decision needed from the user.

## Goals

- Never miss a clinically or operationally relevant event.
- Low volume, so err on the side of sending rather than suppressing.
- No PHI in any alert payload. Use initials, IDs, or counts.
- Reuse the existing `sendSlackAlert` helper in `packages/api/shared/slack.ts`.

## Global configuration

| Setting | Value |
|---|---|
| Transport | Slack webhook (existing) |
| Secret | `SLACK_WEBHOOK_URL` in Secrets Manager (`AppSecrets`, `packages/api/shared/secrets.ts:29`) |
| Channel | Single channel today (whatever the webhook is bound to). Multi-channel routing: TBD — probably phase 2. |
| Environment gating | Alerts fire in all stages. If dev noise becomes a problem, gate on `process.env.STAGE === 'prod'`. |
| Failure behavior | Non-throwing — helper logs and swallows. Do not change. |
| Severity levels | `critical` (red), `warning` (orange), `info` (green). |
| Rate limiting | None. Volume is trivial. Revisit only if we see duplicates. |

## Shared message conventions

- Title: short imperative or noun phrase, e.g. `New task created`.
- Fields: 3–6 key/value pairs max. Non-PHI only.
- Patient references: `${firstName.charAt(0)}. ${lastName}` pattern already used in `create-patient.ts:122`. Follow it.
- Free-text content (task title, voicemail caller ID, etc.): truncate to 80 chars, strip newlines.
- Always include: `env`, `timestamp` (helper adds these automatically).

---

## Event 1 — Task created

| | |
|---|---|
| Trigger | `POST /tasks` succeeds (DynamoDB write completed) |
| Handler | `packages/api/handlers/api/create-task.ts` |
| Call site | After audit log write, before response return |
| Severity | `info` |
| Enabled | ✅ |

**Message template**
```
Title:   New Item
Fields:
  Assignee:   <assigneeName or "Unassigned">
  Created by: <creatorName>
  Priority:   <task.priority or "normal">
  Due:        <task.dueDate or "none">
```

**PHI check**
- Task title is intentionally **omitted** from the alert. Recipient clicks through to the app to see details. This sidesteps the risk that providers paste patient references into titles.

---

## Event 2 — Voicemail received

| | |
|---|---|
| Trigger | Zoom webhook creates a new voicemail record in DynamoDB |
| Handler | `packages/api/handlers/voicemail/vm-ingest.ts` |
| Call site | After DynamoDB put, before kicking off Step Functions transcription |
| Severity | `info` (routine) — escalate to `warning` if caller flagged urgent (N/A today) |
| Enabled | ✅ |

**Message template**
```
Title:   New voicemail
Fields:
  From:       <maskedCallerNumber, e.g. "(555) ***-1234">
  Duration:   <seconds>s
  Received:   <timestamp>
  VM ID:      <id>  (for click-through)
```

**PHI check**
- Caller phone number is PHI when tied to a patient. Mask middle digits.
- Do not include transcription text (it's not ready at ingest time anyway, and would be PHI).

---

## Event 3 — New patient created

| | |
|---|---|
| Trigger | `POST /patients` succeeds |
| Handler | `packages/api/handlers/api/create-patient.ts` |
| Status | **Already implemented** at line 122. |
| Action | Verify format still matches spec. No code change expected. |
| Severity | `info` |
| Enabled | ✅ |

Listed here so all active events live in one place.

---

## Login-success alerts — sunset plan

Every successful Cognito login currently fires a Slack alert (`packages/api/handlers/auth/post-authentication.ts`). Keep this **on through 2026-04-29** (one week from 2026-04-22), then:

- Demote login-success to CloudWatch logs only.
- Keep login-**failure** / lockout alerts on Slack (already wired via `notify-login-failure.ts`).
- Rationale: once we have alerts for real activity (tasks, voicemails, patients), login noise stops being useful signal and turns into clutter.

## Future — observability & operational monitoring

Out of scope for this notifications spec, but captured so we design it coherently when we get there. **Event notifications ≠ operational metrics.** Notifications say "something just happened, a human should look." Metrics answer "what's the state of the practice right now?" These want different plumbing:

- **Notifications** → Slack (what this spec covers)
- **Metrics / dashboards** → CloudWatch Metrics + a dashboard (in-app provider view or Grafana/CloudWatch)
- **Threshold alerts** → CloudWatch Alarms that feed into the same Slack helper

Candidate metrics to start tracking once we're in "the real game":

| Metric | Source | Why |
|---|---|---|
| Appointment duration (scheduled vs actual) | `create-appointment` + `complete-appointment` timestamps | Are we running long? Which providers / visit types? |
| Patients currently waiting | Appointments in state "checked-in" but not "in-room" | Live queue depth |
| Wait time per patient | check-in → in-room delta | Flag outliers > threshold |
| Voicemails awaiting response | Count of VMs without a linked task or "resolved" flag | Inbox backlog |
| Tasks open / overdue | Task status + dueDate | Per-provider load |
| Fax queue depth | Unprocessed inbound faxes | Admin backlog |
| Transcription failure rate | `vm-complete-transcription` errors / total | Reliability |
| API error rate, p95 latency | API Gateway / Lambda metrics | Baseline health |

Alert thresholds (example, not decided): "≥ 3 patients waiting > 20 min" → warning in Slack. These are CloudWatch Alarm candidates, not inline Lambda alerts — so they keep the notification pipeline clean.

When we pick this up, the likely next steps are: (1) emit custom CloudWatch metrics from the relevant handlers, (2) build a lightweight provider dashboard page in the web app that reads them, (3) wire threshold alarms into the existing `sendSlackAlert` helper.

## Out of scope for v1

- In-app notification inbox (DynamoDB `NOTIFICATION#` entity, bell icon, unread counter).
- Per-user notification preferences (schema, API, Settings UI).
- Email / SMS / web push channels.
- Per-event routing to different Slack channels.
- Digest / batching.

Revisit if volume grows or if specific providers ask to opt out.

## Open questions

_All v1 decisions resolved. Revisit at end of user-testing._
