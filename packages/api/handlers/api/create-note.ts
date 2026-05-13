/**
 * POST /patients/{id}/notes
 *
 * Creates a clinical note for a patient.
 *
 * Request body:
 * {
 *   "title": "SOAP Note",
 *   "body": "SUBJECTIVE:\n..."
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity, canAccessProvider } from '../../shared/auth';
import { getItem, putItem, writeAuditLog } from '../../shared/dynamo';
import { created, badRequest, forbidden, serverError, parseBody } from '../../shared/response';
import { chargeCustomerByEmail } from '../../shared/stripe';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const patientId = event.pathParameters?.id;

    if (!patientId) {
      return badRequest('Missing patient ID');
    }

    // Verify caller owns this patient
    const patient = await getItem(`PATIENT#${patientId}`, 'PROFILE');
    if (patient?.providerId && !canAccessProvider(caller, patient.providerId as string)) {
      return forbidden('You do not have access to this patient');
    }

    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');
    const { title, body: noteBody, audioUrl, appointmentType } = body as {
      title?: string; body?: string; audioUrl?: string; appointmentType?: string;
    };

    if (!title || !noteBody) {
      return badRequest('Missing required fields: title, body');
    }

    const noteId = `note-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      PK: `PATIENT#${patientId}`,
      SK: `NOTE#${now}#${noteId}`,
      noteId,
      patientId,
      title,
      body: noteBody,
      audioUrl: audioUrl || null,
      createdAt: now,
      createdBy: caller.email,
      // GSI keys for provider-scoped queries
      GSI1PK: `PROVIDER#${caller.providerId}`,
      GSI1SK: `NOTE#${now}#${noteId}`,
      entityType: 'Note',
    };

    await putItem(item);

    // HIPAA: Audit log — no PHI in details
    await writeAuditLog({
      providerId: caller.providerId,
      action: 'CREATE_NOTE',
      entityType: 'Note',
      entityId: noteId,
      details: { patientId, createdBy: caller.email },
    });

    // ── Auto-charge for visit billing (non-throwing) ──────────────────────────
    if (appointmentType) {
      try {
        const [settings, patientRecord] = await Promise.all([
          getItem('PRACTICE#vantage', 'SETTINGS'),
          getItem(`PATIENT#${patientId}`, 'PROFILE'),
        ]);
        const types = (settings?.appointmentTypes as { name: string; amountCents: number }[]) || [];
        const apptType = types.find((t) => t.name === appointmentType);
        const patientEmail = patientRecord?.email as string | undefined;

        if (apptType && patientEmail) {
          const charge = await chargeCustomerByEmail(
            patientEmail,
            apptType.amountCents,
            `${appointmentType} — Vantage Refinery`,
          );
          if (!charge.success) {
            const patientName = patientRecord
              ? `${patientRecord.firstName || ''} ${patientRecord.lastName || ''}`.trim()
              : patientId;
            const reason = charge.reason === 'no_customer'
              ? 'No Stripe account on file'
              : charge.reason === 'no_payment_method'
                ? 'No payment method on file'
                : `Charge failed: ${charge.error || 'unknown'}`;
            const todoId = `task-${randomUUID().slice(0, 12)}`;
            const todoNow = new Date().toISOString();
            await putItem({
              PK: `PROVIDER#${caller.providerId}`,
              SK: `TASK#${todoId}`,
              taskId: todoId,
              providerId: caller.providerId,
              patientId,
              type: 'General',
              title: `Collect payment: ${patientName} — ${appointmentType}`,
              status: 'Open',
              priority: 'High',
              assignedTo: 'Admin',
              notes: reason,
              createdAt: todoNow,
              updatedAt: todoNow,
              GSI1PK: `PROVIDER#${caller.providerId}`,
              GSI1SK: `TASKSTATUS#Open#${todoNow}`,
              GSI2PK: 'TASK',
              GSI2SK: `${todoNow}#${todoId}`,
              entityType: 'Task',
            });
          }
        }
      } catch (billingErr) {
        console.error('[create-note] billing step failed (non-fatal):', (billingErr as Error).message);
      }
    }

    return created({
      id: noteId,
      patientId,
      title,
      body: noteBody,
      audioUrl: audioUrl || undefined,
      createdAt: now,
    });
  } catch (err) {
    console.error('Create note error:', (err as Error).message);
    return serverError('Failed to create note');
  }
};
