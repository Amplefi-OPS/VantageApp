/**
 * DELETE /patients/{id}/notes/{noteId}
 *
 * Deletes a clinical note for a patient.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity, canAccessProvider } from '../../shared/auth';
import { getItem, queryItems, deleteItem, writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, forbidden, notFound, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const patientId = event.pathParameters?.id;
    const noteId = event.pathParameters?.noteId;

    if (!patientId || !noteId) {
      return badRequest('Missing patient ID or note ID');
    }

    // Verify caller owns this patient
    const patient = await getItem(`PATIENT#${patientId}`, 'PROFILE');
    if (!patient) {
      return notFound('Patient not found');
    }
    if (patient.providerId && !canAccessProvider(caller, patient.providerId as string)) {
      return forbidden('You do not have access to this patient');
    }

    // Find the note SK (it includes timestamp: NOTE#<timestamp>#<noteId>)
    const notes = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PATIENT#${patientId}`,
        ':sk': 'NOTE#',
      },
    });

    const note = notes.find((n) => n.noteId === noteId);
    if (!note) {
      return notFound('Note not found');
    }

    await deleteItem(`PATIENT#${patientId}`, note.SK as string);

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'DELETE_NOTE',
      entityType: 'Note',
      entityId: noteId,
      details: { patientId, deletedBy: caller.email },
    });

    return success({ deleted: true, noteId });
  } catch (err) {
    console.error('Delete note error:', (err as Error).message);
    return serverError('Failed to delete note');
  }
};
