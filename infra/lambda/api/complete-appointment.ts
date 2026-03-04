/**
 * PUT /appointments/{id}/complete
 *
 * Marks an appointment as completed by storing a record in DynamoDB.
 * Acuity doesn't have a "completed" status, so we track it locally.
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
    if (!/^\d+$/.test(appointmentId)) return badRequest('Invalid appointment ID');

    const now = new Date();

    await putItem({
      PK: `APPOINTMENT#${appointmentId}`,
      SK: 'COMPLETED',
      GSI1PK: `PROVIDER#${caller.providerId}`,
      GSI1SK: `APPT_COMPLETE#${appointmentId}`,
      appointmentId,
      completedAt: now.toISOString(),
      completedBy: caller.providerId,
      // Auto-expire after 1 year
      ttl: Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60,
    });

    return success({ completed: true, appointmentId });
  } catch (err) {
    console.error('Complete appointment error:', (err as Error).message);
    return serverError('Failed to mark appointment as completed');
  }
};
