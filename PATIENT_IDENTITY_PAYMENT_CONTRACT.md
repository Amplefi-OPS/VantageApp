# Patient Identity & Payment Contract

**Status:** Phase 0 foundation. Gates Jane's public landing/portal build and all billing (Phase 5) and AI patient-matching (Phase 6) work. Authored against the current code, not idealized.

## Why this exists

Every downstream automation resolves against a patient identity and a billing rail: no-show/visit/Rx charges need something to bill; AI matching needs a canonical ID to match *to*; the EHR keys on it. Today the patient↔Stripe link is **search-based** (`packages/api/handlers/api/stripe-customer-search.ts` looks customers up by email/phone at charge time). That is fragile (duplicate/again-typed emails, renamed patients) and must become a **stored deterministic mapping**. This contract defines the identity, the payment linkage, and the exact interface Jane's portal must conform to.

## 1. Canonical patient identity (current, do not change)

- ID format: `pt-<uuid12>` (see `packages/api/handlers/api/create-patient.ts:79`).
- DynamoDB keys: `PK = PATIENT#{patientId}`, `SK = PROFILE`. Provider-scoped GSI1 (`PROVIDER#{providerId}` / `PATIENT#{createdAt}`), global GSI2 (`PATIENT` / `{createdAt}#{patientId}`).
- Entity shape: `PatientSchema` in `packages/shared/types.ts:38`.
- **The patient ID is the only join key.** Scheduling, intake, EHR (`DICT#`/`TASK#`), billing, voicemail/email matching all reference `patientId`. Nothing may invent a parallel identifier.

## 2. Payment linkage (new fields — additive to PatientSchema)

Add to the patient PROFILE record (additive, optional, backward-compatible):

| Field | Meaning |
|---|---|
| `stripeCustomerId` | Stripe `cus_…`. Presence = "has a Stripe component." Absence = not on the Stripe rail yet. |
| `paymentMethodOnFile` | boolean — true once a default PM is set (`stripe-confirm-setup.ts` sets `invoice_settings.default_payment_method`). |
| `billingRail` | `stripe` \| `quickbooks` — derived, persisted for fast routing. `stripe` iff `stripeCustomerId` + `paymentMethodOnFile`; else `quickbooks`. |

This replaces search-at-charge-time with a stored link. `stripe-customer-search.ts` is retained only for the one-time migration (§5) and as a reconciliation fallback, not the primary path.

## 3. New-patient flow (Jane's portal — the interface contract)

General population → first appointment. Identity and payment are minted **together**, before scheduling is allowed:

1. Portal collects intake via the **existing patient-portal intake form** (reuse — do NOT rebuild).
2. Portal calls `create-patient` → receives `patientId` (the canonical key).
3. Portal runs Stripe setup (`stripe-payment-intent.ts` / `stripe-confirm-setup.ts`): create Stripe customer → attach payment method → set default. Persist `stripeCustomerId`, `paymentMethodOnFile=true`, `billingRail=stripe` on the PROFILE.
4. Only after steps 2–3 succeed may the patient self-schedule the first appointment. The no-show-charge warning is shown at scheduling and is enforceable because the PM is already on file.

**Jane's hard requirements:** use `create-patient` for the key (never mint IDs client-side); store the Stripe linkage on the returned `patientId`; treat "scheduled but no PM on file" as an invalid state.

## 4. Existing-patient flow (already keyed in DynamoDB)

Existing patients already have `PATIENT#{id}` records. Classify by Stripe presence:

- **Has `stripeCustomerId` + default PM** → `billingRail=stripe`. Done.
- **No Stripe component** → `billingRail=quickbooks`. Onboarding = a QuickBooks invoice (`packages/api/handlers/billing/quickbooks-processor.ts`) **plus** an "add a payment method" request (link to the `stripe-confirm-setup.ts` flow). When the patient completes it, backfill `stripeCustomerId`, flip `paymentMethodOnFile`/`billingRail`. This is the path that migrates them onto Stripe without disrupting their care or income.

## 5. Migration (one-time batch)

Scan all `PATIENT#…/PROFILE` (GSI2 `PATIENT`). For each: attempt `stripe-customer-search.ts` by email/phone. If a unique Stripe customer with a default PM is found → persist `stripeCustomerId`, `billingRail=stripe`. Else → `billingRail=quickbooks`, queue the add-PM request. Output: a count of stripe vs quickbooks patients (sizes the QuickBooks-invoice backfill effort — flagged open in the plan).

## 6. Billing-rail selection (reuse, don't rebuild)

`packages/api/handlers/api/billing-charge.ts` already supports `provider_type: stripe | quickbooks | both`. Phase 5 producers set `provider_type = patient.billingRail`. No-Stripe patients route to QuickBooks invoice instead of a silently failed charge. **Invariant (already enforced, restated): no PHI to Stripe — only `billing_reference`.**

## 7. Compliance boundary

Patient PHI lives in the AWS system of record (DynamoDB, BAA'd). Stripe receives only `billing_reference` + amount. QuickBooks receives only bookkeeping refs. The portal (Jane) must transmit PHI only to the AWS API over TLS; no PHI to non-BAA surfaces. Google Workspace identity for any Google-side surface must be the `vantagerefinery.com` Workspace service identity (see plan Phase 0), never personal gmail.

## 8. Open items

- Whether to add `stripeCustomerId` as a GSI for reverse lookup (Stripe webhook → patient) — likely yes for Phase 5 webhook reconciliation; decide during Phase 5.
- Volume of no-Stripe existing patients (migration §5 output) drives the QuickBooks-invoice backfill scope.
- Confirm the existing portal intake form's field set maps cleanly onto `PatientSchema` (`types.ts:38`); gap-list before Jane builds.
