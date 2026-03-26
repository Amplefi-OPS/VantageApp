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
    const { title, body: noteBody, audioUrl } = body;

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
