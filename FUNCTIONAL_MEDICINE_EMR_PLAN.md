# Functional Medicine EMR — Conceptual Plan (WIP)

> Separate project from VantageApp. Same user, same stack family (Google Workspace + Zoom Healthcare + AWS, all with BAAs). In-progress conceptual planning — not an implementation spec.

## Practice context

- Single provider, functional medicine, "old school," needs a safe and easy environment to navigate.
- Two admin staff, part-time shifts.
- ~20–50 patients per week.
- Provider does most of his notes by **dictation** — biggest manually-managed data source today.
- Limited formulary, established relationships with compounders.
- Core pain: getting information **put away where it is easily retrieved at the moment of truth** (in-room with the patient).
- Stack with BAAs in place: Google Workspace, Zoom Healthcare, AWS.
- No API access to labs / fax senders today — everything is semi-automated to start.

---

## High-level build plan (phases, not timeline)

### 1. Discovery & workflow mapping
- Shadow the provider; map every "moment of truth" where info is needed and where it's lost today.
- Catalog dictation habits: when, on what device, how long, what gets said vs. what ends up in the note.
- Inventory formulary, compounders, standing orders, supplement protocols.
- Map admin split: who owns intake, scheduling, billing, document handling, and the handoffs.

### 2. Compliance & security foundation
- Verify BAAs (Google, Zoom, AWS) and document the data-flow map of PHI paths.
- HIPAA risk assessment, written policies (access, breach, retention), workforce training.
- Define roles/permissions: provider vs admin-clinical vs admin-billing.
- Retention + audit-log strategy (7-year TTL baseline).

### 3. Architecture decisions
- Build vs. extend the existing VantageApp pattern (React + AWS serverless + Cognito + DynamoDB single-table).
- Core data model: Patient, Encounter, Note, Problem, Medication/Supplement, Order, Document, Lab, Compounder.
- Dictation pipeline choice: AWS Transcribe Medical vs. ambient-scribe vendor (with BAA) vs. hybrid. **Highest-leverage decision.**
- Retrieval layer: structured DynamoDB + an index (OpenSearch or vector store) for semantic search across notes, labs, orders.

### 4. Capture layer (dictation first)
- Capture surfaces: browser mic, mobile PWA, phone dial-in; Zoom Healthcare for televisits.
- Transcribe → structure: speech-to-text → LLM (BAA'd path, e.g., Bedrock) → structured SOAP, problem updates, order suggestions, coded data.
- Provider review & sign: nothing commits until signed. Keep raw transcript + structured note both retrievable.
- Versioning + amendments: full audit trail post-signature.

### 5. Chart & retrieval layer ("moment of truth")
- Patient chart: timeline view with pinned summaries.
- Pre-visit briefing: auto-generated one-pager on chart open — last visit, active protocols, outstanding labs, open loops.
- Semantic + structured search across the practice.
- Saved views and protocol templates so repeat decisions are one click.

### 6. Formulary & compounder integration
- Structured formulary DB: compound name, ingredients, strengths, compounder(s), default sigs, cost, stocking status.
- Protocol templates: common functional-medicine regimens as reusable order sets.
- Ordering workflow: generate prescription → route to the right compounder (secure fax, portal, or signed PDF via BAA'd email).
- Refill tracking + patient-facing instructions.

### 7. Document & data ingestion
- Labs: PDF → OCR/parse → structured results + trending.
- Inbound faxes: HIPAA-compliant fax intake, auto-routing, admin triage queue.
- Google Drive/Workspace as the BAA'd document store; metadata in the EMR so docs are findable from the chart.
- Patient intake forms: BAA'd vendor or built-in flow.

### 8. Scheduling, messaging, admin ops
- Google Calendar as schedule source of truth, surfaced in the EMR.
- Zoom Healthcare for televisits, launched from the encounter.
- Secure patient messaging (portal or BAA'd SMS) + admin task inbox.
- Lightweight billing hooks (superbill, Stripe, QuickBooks export).

### 9. Security, audit, operations
- Cognito + MFA, short inactivity timeout.
- Full audit log, tamper-evident, 7-year retention, queryable.
- Backups, DR runbook, break-glass procedure, offboarding checklist.
- Monitoring + alerting on auth anomalies, DLQ, transcription failures.

### 10. Migration, pilot, rollout
- Data migration from current records with a mapping spec.
- Parallel-run pilot for a few weeks; test retrieval on real encounters.
- Train admins on their workflows; train provider on dictation + sign-off.
- Go-live with rollback plan + daily standup for first two weeks.

### 11. Post-launch iteration
- Instrument the Phase 1 retrieval moments; measure whether they actually got faster.
- Feedback loop on note structure, order templates, surfaced summaries.
- Expand protocols, compounder integrations, and patient-facing features only after the core dictation→chart→retrieve loop is boring-reliable.

---

## Conceptual framing

### Two kinds of data, one chart

- **Authored data** — what the practice creates: notes, orders, protocols, messages. Editable, versioned, signed.
- **Received data** — what comes from outside: faxes, lab PDFs, imaging reports, referral letters. **Immutable.** Stored exactly as received. The system can add metadata *around* it (tags, patient link, summary, OCR text) but never touches the original artifact.

This separation is the spine of the system and the HIPAA-friendly posture: original always preserved, interpretation lives next to it, not on top of it.

### The chart as a timeline

One chronological feed per patient mixing encounters, faxes, labs, orders, messages. Each item: type, date, one-line summary, opens to the full source. Retrieval at the moment of truth = open patient → see the story.

### The ingestion conveyor belt

Since there are no APIs, every external source funnels through the same pipeline:

**Arrive → Identify → Attach → Summarize → Surface**

- Arrive: BAA'd e-fax, Drive folder, dedicated email.
- Identify: OCR + light AI classification (proposal, not commit).
- Attach: admin confirms patient match in a triage queue — the human safety valve.
- Summarize: extract key values into structured fields *alongside* the original.
- Surface: appears on the patient timeline, flagged if provider attention is needed.

Admins live in the triage queue. Provider sees the finished chart.

### Provider's environment (old-school safe)

- **One patient, one screen.** No tabs to remember.
- **Dictate-first.** Primary new-encounter button starts a recording.
- **Nothing disappears.** No hidden menus, no mandatory shortcuts; visible buttons.
- **Read mode vs. write mode.** Immutable received data visually distinct from his own notes.
- **Undo everywhere that matters.** Amendable sign-offs (with audit), autosave drafts.

### Admin's environment

Three queues, stateful and shared so either admin can pick up where the other left off:
1. Incoming triage (faxes/labs/docs → patient match).
2. Scheduling + intake.
3. Follow-up loop (orders, results, patient comms).

---

## Refinements from the last pass

### In-room dictation: the reliability contract

> The provider should never have to wonder if the system got it right.

Three layers:
1. **Transcribe** (AWS Transcribe Medical or equivalent).
2. **Self-verify** — second AI pass re-reads transcript against audio, flags low-confidence spans, drug names, dosages, numbers, concepts that don't parse.
3. **Structure** — third pass → SOAP note, problem list updates, order suggestions.

Provider sees structured note with flagged spans highlighted. Tap a flag → hear original audio clip → confirm or correct in one gesture. Nothing commits until signed. **Audio retained as immutable source of truth** — if a transcript is ever wrong, the recording is the fallback (same pattern as the fax PDF for a lab).

Design principle: system earns trust by being openly uncertain where it should be, not by pretending to be perfect.

### The "skill" pattern for incoming data

Every class of incoming data handled by a named, reusable **skill** with a predictable shape:

> **Trigger → Classify → Extract → Act → Notify → Log**

Examples:
- **Lab result skill:** email arrives → classify as lab → extract values + ranges → attach to patient → write plain-English summary → draft patient-facing message → queue for review → notify patient once approved.
- **Fax skill:** PDF arrives → classify (referral / records request / insurance / other) → route to right admin queue with proposed action.
- **Pharmacy/compounder confirmation skill:** order ack → match outbound order → mark fulfilled or flag discrepancy.
- **Referral letter skill:** extract referring provider, reason, enclosures → attach to chart → draft acknowledgment.
- **Patient reply skill:** inbound message → classify (scheduling, clinical, billing) → route.

Each skill small, testable in isolation, same mental model. New data source = write a new skill, not rebuild the pipeline. Over time: a library.

Two safety rules:
1. **Every skill has a human gate by default.** AI proposes, admin confirms. High-confidence / low-risk actions can be promoted to fully automatic later, after track record.
2. **Every skill emits an audit record** — inputs, model version, classification, confidence, human who touched it. HIPAA story + debugging story.

### Google Workspace as the ingestion fabric

- Dedicated mailbox (e.g., `records@`) as universal inbound address.
- A watcher reads new mail, hands message + attachments to classifier, skill takes over.
- Drive folders = immutable store; EMR holds reference + extracted metadata.
- Calendar stays schedule of record; EMR reads/writes, doesn't duplicate.
- Admins retain Gmail as familiar fallback. If a skill mis-classifies, email is still in the mailbox.

### Moving upstream: webhooks instead of email

Email is a degraded protocol for structured data. Skip the degradation where possible.

Offer partners (labs, compounders, imaging centers, referring offices) a simple tradeoff:
- **Their side:** a URL + shared secret. They POST JSON (or multipart with PDF).
- **Your side:** same skill pipeline, but starting from structured data — near-zero classification error, no extraction step. Human gate often skippable for known-good senders.

Uptake strategy:
- **Make it trivially easy.** One-page spec, test endpoint, sample payload, support email.
- **Meet them where they are.** Tiers: full webhook (best), signed-URL upload (good), email-to-webhook bridge (fine). Email skill as fallback for anyone who won't move.
- **Give them something back.** Read-only status page ("received at 2:14, filed at 2:18") reduces their follow-up calls — motivating.
- **Start with the highest-volume partner.** If one compounder or lab sends half the inbound, converting them alone changes the economics.

Over time: email/fax = long tail, webhook = default for anyone sending more than a few items a month.

### How the three reinforce each other

- **Dictation reliability contract** → earns the provider's trust so he'll use the system in the room.
- **Skill pattern** → scales the admin side without adding headcount; clean place to layer AI.
- **Webhooks upstream** → slowly remove the messiest inputs from the skill pipeline, so the skills that remain are the ones that genuinely need human judgment.

Long-term picture: the practice's data boundary has a handful of well-defined skills guarding it, most high-volume partners send structured data directly, and the provider spends his cognitive budget on patients instead of on the EMR.

---

## Open threads to pick up next

- What does the "moment of truth" look like on screen? (The UX sketch for the in-room encounter view.)
- The **shape of a skill** in more detail — so adding a new one is a clear, repeatable exercise.
- Whether to extend VantageApp or greenfield this as a separate tenant/app.
- Which high-volume partner to target first for the webhook conversion.
