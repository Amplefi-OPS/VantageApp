/**
 * PUT /appointments/{id}/cancel
 *
 * Cancels an appointment in Acuity Scheduling.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { success, badRequest, serverError } from '../shared/response';
import { getSecrets } from '../shared/secrets';

const ACUITY_BASE = 'https://acuityscheduling.com/api/v1';

async function acuityPut(path: string): Promise<unknown> {
  const secrets = await getSecrets();
  const auth = Buffer.from(`${secrets.ACUITY_USER_ID}:${secrets.ACUITY_API_KEY}`).toString('base64');
  const res = await fetch(`${ACUITY_BASE}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Acuity API error (${res.status}): ${text}`);
  }
  return res.json();
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);
    const appointmentId = event.pathParameters?.id;
    if (!appointmentId) return badRequest('Missing appointment ID');
    if (!/^\d+$/.test(appointmentId)) return badRequest('Invalid appointment ID');

    await acuityPut(`/appointments/${appointmentId}/cancel`);
    return success({ cancelled: true, appointmentId });
  } catch (err) {
    console.error('Cancel Acuity appointment error:', (err as Error).message);
    return serverError('Failed to cancel appointment');
  }
};
