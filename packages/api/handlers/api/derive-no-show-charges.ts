/**
 * Scheduled Lambda — triggered by EventBridge (weekday, after hours).
 *
 * Phase 5 — deterministic no-show event producer.
 *
 * Derives no-shows from the authoritative schedule (Google Calendar) and the
 * Phase-2 "Start Visit" seam: a scheduled appointment whose window has closed
 * (end + grace < now) with NO `APPT#{id}/VISIT_STARTED` record, that was not
 * marked completed, and was not cancelled, is a no-show. For each, emit ONE
 * `ChargeRequested` event on the existing `vantage-billing-{stage}` bus
 * (consumed by stripe-processor.ts).
 *
 * IDEMPOTENCY FIRST (top flagged risk — double-billing on replay):
 *   - A conditional dedup record `APPT#{id}/NOSHOW_BILLED` is written with
 *     `attribute_not_exists` BEFORE any event is emitted. Only the writer that
 *     wins the conditional put proceeds; a re-run or overlapping schedule is a
 *     no-op. This is the primary replay guard.
 *   - The billing_event_id / idempotency_key are deterministic
 *     (`noshow-{appointmentId}`), so even an EventBridge re-delivery to the
 *     processor maps to the same Stripe Idempotency-Key and cannot double
 *     charge. Two independent layers.
 *
 * DEFERRED (open sub-parts, intentionally NOT done here):
 *   - QuickBooks fallback EMISSION for no-Stripe patients. The no-Stripe case
 *     is recorded as a queryable `BILLING#` row + audit log (NOT silently
 *     dropped), for the deferred QuickBooks-fallback unit to consume.
 *   - Bedrock transcript→billable classification.
 *
 * No PHI leaves AWS and none is persisted on the billing/event records: the
 * appointment id is an opaque Google event id, the patient id is an internal
 * token, the Stripe customer id is an opaque `cus_` token (contract §7).
 * Patient name/phone/email are used only in-memory for the match and are
 * never written to BILLING#/NOSHOW_BILLED or the event detail.
 */

import type { ScheduledHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getItem, putItem, queryItems, writeAuditLog } from '../../shared/dynamo';
import { getGoogleAccessToken, getCalendarId } from '../../shared/google';

const eb = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const PROVIDER_ID = process.env.PROVIDER_ID;
const NO_SHOW_FEE_CENTS = Number(process.env.NO_SHOW_FEE_CENTS ?? '3000');
// Don't bill until this long after the appointment ended — leaves room for a
// late "Start Visit" tap before we conclude it was a no-show. Conservative.
const GRACE_MINUTES = Number(process.env.NO_SHOW_GRACE_MINUTES ?? '120');
// How far back each run scans. Comfortably covers a missed daily run.
const LOOKBACK_HOURS = Number(process.env.NO_SHOW_LOOKBACK_HOURS ?? '72');

// Local doc client — used ONLY for the conditional dedup put (the shared
// putItem has no ConditionExpression support and shared DynamoDB code is
// deliberately not being widened). Everything else uses shared helpers.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE_NAME = process.env.TABLE_NAME;

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

interface GoogleEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface EventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Extract a phone from a calendar event description (mirror list-acuity-appointments.ts). */
function parsePhone(desc: string): string {
  if (!desc) return '';
  const clean = stripHtml(desc);
  const phoneMatch = clean.match(/(?:phone|tel|cell|mobile)\s*[:=]\s*([\d\s()+-]+)/i);
  const barePhone = !phoneMatch
    ? clean.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/)
    : null;
  return phoneMatch?.[1]?.trim() || barePhone?.[1]?.trim() || '';
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

async function fetchEvents(
  calendarId: string,
  token: string,
  params: URLSearchParams,
): Promise<GoogleEvent[]> {
  const all: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams(params);
    if (pageToken) p.set('pageToken', pageToken);
    const res = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${p}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Google Calendar API error (HTTP ${res.status})`);
    const data = (await res.json()) as EventsListResponse;
    if (data.items) all.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

interface PatientBilling {
  patientId: string;
  stripeCustomerId?: string;
  billingRail?: string;
  paymentMethodOnFile?: boolean;
}

/**
 * Claim the no-show for billing. Returns true iff THIS invocation won the
 * conditional write (i.e. it is responsible for emitting). A losing write
 * (ConditionalCheckFailedException) means another run already handled it.
 */
async function claimNoShow(
  appointmentId: string,
  billingEventId: string,
  outcome: string,
  now: string,
): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `APPT#${appointmentId}`,
          SK: 'NOSHOW_BILLED',
          entityType: 'NoShowBilled',
          appointmentId,
          billingEventId,
          providerId: PROVIDER_ID,
          outcome,
          billedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export const handler: ScheduledHandler = async () => {
  if (!PROVIDER_ID) throw new Error('PROVIDER_ID environment variable is required');

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const windowStart = new Date(nowMs - LOOKBACK_HOURS * 60 * 60 * 1000);
  const graceMs = GRACE_MINUTES * 60 * 1000;

  const token = await getGoogleAccessToken();
  const calendarId = await getCalendarId();

  const events = await fetchEvents(
    calendarId,
    token,
    new URLSearchParams({
      timeMin: windowStart.toISOString(),
      timeMax: nowIso,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      showDeleted: 'true',
    }),
  );

  // Phone → patient billing linkage (GSI2 'PATIENT', same as list-acuity).
  const patients = await queryItems({
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: { ':pk': 'PATIENT' },
  });
  const phoneToPatient = new Map<string, PatientBilling>();
  for (const p of patients) {
    if (!p.phone) continue;
    phoneToPatient.set(normalizePhone(p.phone as string), {
      patientId: p.patientId as string,
      stripeCustomerId: p.stripeCustomerId as string | undefined,
      billingRail: p.billingRail as string | undefined,
      paymentMethodOnFile: p.paymentMethodOnFile as boolean | undefined,
    });
  }

  // Appointments staff already resolved as completed → not a no-show.
  const completed = await queryItems({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `PROVIDER#${PROVIDER_ID}`,
      ':sk': 'APPT_COMPLETE#',
    },
  });
  const completedIds = new Set(completed.map((c) => c.appointmentId as string));

  let scanned = 0;
  let emitted = 0;
  let pendingQuickbooks = 0;
  let unresolvedPatient = 0;
  let alreadyHandled = 0;
  let showedUp = 0;

  for (const e of events) {
    if (e.status === 'cancelled') continue; // a cancellation is not a no-show
    const endIso = e.end?.dateTime || e.end?.date;
    if (!endIso) continue;
    const endMs = new Date(endIso).getTime();
    if (Number.isNaN(endMs)) continue;
    if (endMs + graceMs > nowMs) continue; // still within grace / future

    scanned += 1;

    if (completedIds.has(e.id)) continue;

    // Phase-2 seam: a VISIT_STARTED record means the patient showed up.
    const visitStarted = await getItem(`APPT#${e.id}`, 'VISIT_STARTED');
    if (visitStarted) {
      showedUp += 1;
      continue;
    }

    const billingEventId = `noshow-${e.id}`;

    // Resolve the patient deterministically (stored phone link, no PHI search).
    const normPhone = normalizePhone(parsePhone(e.description || ''));
    const patient = normPhone ? phoneToPatient.get(normPhone) : undefined;

    const hasStripe = Boolean(
      patient?.stripeCustomerId &&
        (patient?.paymentMethodOnFile !== false) &&
        (patient?.billingRail ?? 'stripe') === 'stripe',
    );

    const outcome = !patient
      ? 'unresolved_patient'
      : hasStripe
        ? 'emitted'
        : 'pending_quickbooks';

    // ── Idempotency gate: claim before doing anything billable ──
    const won = await claimNoShow(e.id, billingEventId, outcome, nowIso);
    if (!won) {
      alreadyHandled += 1;
      continue;
    }

    // System-of-record billing event row (queryable; processors update it).
    // No PHI: only opaque tokens.
    await putItem({
      PK: `BILLING#${billingEventId}`,
      SK: 'EVENT',
      entityType: 'BillingEvent',
      billingEventId,
      kind: 'no_show',
      providerId: PROVIDER_ID,
      patientId: patient?.patientId ?? null,
      appointmentId: e.id,
      amountCents: NO_SHOW_FEE_CENTS,
      currency: 'usd',
      billingRail: hasStripe ? 'stripe' : 'quickbooks',
      stripeCustomerId: patient?.stripeCustomerId ?? null,
      idempotencyKey: billingEventId,
      status: outcome === 'emitted' ? 'pending' : outcome,
      createdAt: nowIso,
      updatedAt: nowIso,
      GSI1PK: `PROVIDER#${PROVIDER_ID}`,
      GSI1SK: `BILLING#${nowIso}`,
      GSI2PK: 'BILLING',
      GSI2SK: `${nowIso}#${billingEventId}`,
    });

    if (outcome === 'unresolved_patient') {
      unresolvedPatient += 1;
      await writeAuditLog({
        providerId: PROVIDER_ID,
        action: 'NO_SHOW_DERIVED_UNRESOLVED',
        entityType: 'BillingEvent',
        entityId: billingEventId,
        details: { appointmentId: e.id, reason: 'no_patient_match' },
      });
      continue;
    }

    if (outcome === 'pending_quickbooks') {
      // No Stripe component. Recorded above as a queryable BILLING# row for the
      // deferred QuickBooks-fallback unit — deliberately NOT emitting a charge
      // and NOT silently dropping.
      pendingQuickbooks += 1;
      await writeAuditLog({
        providerId: PROVIDER_ID,
        action: 'NO_SHOW_DERIVED_PENDING_QUICKBOOKS',
        entityType: 'BillingEvent',
        entityId: billingEventId,
        details: { appointmentId: e.id, patientId: patient?.patientId },
      });
      continue;
    }

    // ── Stripe path: emit exactly one ChargeRequested ──
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_NAME,
            Source: 'vantage.billing',
            DetailType: 'ChargeRequested',
            Detail: JSON.stringify({
              billing_event_id: billingEventId,
              provider: 'stripe',
              provider_id: PROVIDER_ID,
              task_id: null,
              amount_cents: NO_SHOW_FEE_CENTS,
              currency: 'usd',
              description: 'No-show / late cancellation fee',
              billing_reference: billingEventId,
              idempotency_key: billingEventId,
              requested_at: nowIso,
              requested_by: 'system:no-show-producer',
              stripe_customer_id: patient?.stripeCustomerId,
            }),
          },
        ],
      }),
    );

    await writeAuditLog({
      providerId: PROVIDER_ID,
      action: 'NO_SHOW_CHARGE_REQUESTED',
      entityType: 'BillingEvent',
      entityId: billingEventId,
      details: { appointmentId: e.id, patientId: patient?.patientId, amountCents: NO_SHOW_FEE_CENTS },
    });
    emitted += 1;
  }

  console.log(
    `derive-no-show-charges: scanned ${scanned} past-window appt(s) — ` +
      `emitted ${emitted}, pendingQuickbooks ${pendingQuickbooks}, ` +
      `unresolvedPatient ${unresolvedPatient}, alreadyHandled ${alreadyHandled}, ` +
      `showedUp ${showedUp} (grace ${GRACE_MINUTES}m, lookback ${LOOKBACK_HOURS}h)`,
  );
};
