/**
 * POST /visits/start
 *
 * The single "Start Visit" trigger the doctor taps (via AppSheet) at the
 * start of an appointment. One tap is the seam for two downstream phases:
 *   - Phase 3: tags the subsequent dictation audio to this patient/appointment
 *   - Phase 5: emits the appointment-started event that drives billing
 *
 * Persists a VISIT_STARTED record (so a no-show = a scheduled appointment with
 * no VISIT_STARTED in its window) and emits a `VisitStarted` event on the
 * events bus. Idempotent: a second tap for the same appointment does NOT
 * re-emit (prevents double-billing).
 *
 * Request body: { "patientId": "pt-...", "appointmentId": "..." }
 *
 * NOTE: no PHI in the event detail — only internal tokenized IDs.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getCallerIdentity } from '../../shared/auth';
import { getItem, putItem, writeAuditLog } from '../../shared/dynamo';
import { created, badRequest, serverError, parseBody } from '../../shared/response';

const eb = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const patientId = body.patientId as string | undefined;
    const appointmentId = body.appointmentId as string | undefined;
    if (!patientId || !appointmentId) {
      return badRequest('Missing required fields: patientId, appointmentId');
    }

    const now = new Date().toISOString();

    // Idempotency: if this appointment already has a VISIT_STARTED, return it
    // without re-emitting the billing/dictation trigger.
    const existing = await getItem(`APPT#${appointmentId}`, 'VISIT_STARTED');
    if (existing) {
      return created({
        appointmentId,
        patientId: existing.patientId,
        startedAt: existing.startedAt,
        alreadyStarted: true,
      });
    }

    await putItem({
      PK: `APPT#${appointmentId}`,
      SK: 'VISIT_STARTED',
      entityType: 'VisitStarted',
      appointmentId,
      patientId,
      providerId: caller.providerId,
      startedBy: caller.email,
      startedAt: now,
      // Provider-scoped + global GSIs (mirror existing single-table conventions)
      GSI1PK: `PROVIDER#${caller.providerId}`,
      GSI1SK: `VISIT#${now}`,
      GSI2PK: 'VISIT_STARTED',
      GSI2SK: `${now}#${appointmentId}`,
    });

    // Emit the appointment-started event. Detail carries internal IDs only —
    // never PHI. Phase 3 (dictation tag) and Phase 5 (billing) subscribe.
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EVENT_BUS_NAME,
        Source: 'vantage.visit',
        DetailType: 'VisitStarted',
        Detail: JSON.stringify({ appointmentId, patientId, providerId: caller.providerId, startedAt: now }),
      }],
    }));

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'VISIT_STARTED',
      entityType: 'Appointment',
      entityId: appointmentId,
      details: { startedBy: caller.email, patientId },
    });

    return created({ appointmentId, patientId, startedAt: now, alreadyStarted: false });
  } catch (err) {
    console.error('Start visit error:', (err as Error).message);
    return serverError('Failed to start visit');
  }
};
