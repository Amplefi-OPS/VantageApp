/**
 * PUT /appointments/{id}/no-show
 *
 * Marks an appointment as no-show by storing a record in DynamoDB.
 * Google Calendar doesn't have a no-show concept, so we track it locally.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { putItem } from '../shared/dynamo';
import { success, badRequest, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const appointmentId = event.pathParameters?.id;
    if (!appointmentId) return badRequest('Missing appointment ID');

    const now = new Date();

    await putItem({
      PK: `APPOINTMENT#${appointmentId}`,
      SK: 'NOSHOW',
      GSI1PK: `PROVIDER#${caller.providerId}`,
      GSI1SK: `APPT_NOSHOW#${appointmentId}`,
      appointmentId,
      markedAt: now.toISOString(),
      markedBy: caller.providerId,
      ttl: Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60,
    });

    return success({ noShow: true, appointmentId });
  } catch (err) {
    console.error('No-show appointment error:', (err as Error).message);
    return serverError('Failed to mark appointment as no-show');
  }
};
