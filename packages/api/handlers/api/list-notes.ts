/**
 * GET /patients/{id}/notes
 *
 * Lists all clinical notes for a given patient.
 * Returns notes in reverse chronological order (newest first).
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity, canAccessProvider } from '../../shared/auth';
import { queryItems, getItem } from '../../shared/dynamo';
import { success, badRequest, forbidden, notFound, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const patientId = event.pathParameters?.id;

    if (!patientId) {
      return badRequest('Missing patient ID');
    }

    // Verify caller owns this patient
    const patient = await getItem(`PATIENT#${patientId}`, 'PROFILE');
    if (!patient) {
      return notFound('Patient not found');
    }
    if (patient.providerId && !canAccessProvider(caller, patient.providerId as string)) {
      return forbidden('You do not have access to this patient');
    }

    const items = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PATIENT#${patientId}`,
        ':sk': 'NOTE#',
      },
      ScanIndexForward: false, // Newest first
    });

    const notes = items.map((item) => ({
      id: item.noteId,
      patientId: item.patientId,
      title: item.title,
      body: item.body,
      createdAt: item.createdAt,
    }));

    return success(notes);
  } catch (err) {
    console.error('List notes error:', (err as Error).message);
    return serverError('Failed to list notes');
  }
};
