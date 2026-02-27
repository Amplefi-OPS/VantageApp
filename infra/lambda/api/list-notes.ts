/**
 * GET /patients/{id}/notes
 *
 * Lists all clinical notes for a given patient.
 * Returns notes in reverse chronological order (newest first).
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { success, badRequest, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event); // Validates auth
    const patientId = event.pathParameters?.id;

    if (!patientId) {
      return badRequest('Missing patient ID');
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
