/**
 * PUT /appointments/{id}/cancel
 *
 * Cancels an appointment in Acuity Scheduling.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { success, badRequest, serverError } from '../shared/response';

const ACUITY_USER_ID = process.env.ACUITY_USER_ID!;
const ACUITY_API_KEY = process.env.ACUITY_API_KEY!;
const ACUITY_BASE = 'https://acuityscheduling.com/api/v1';

async function acuityPut(path: string): Promise<unknown> {
  const auth = Buffer.from(`${ACUITY_USER_ID}:${ACUITY_API_KEY}`).toString('base64');
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

    await acuityPut(`/appointments/${appointmentId}/cancel`);
    return success({ cancelled: true, appointmentId });
  } catch (err) {
    console.error('Cancel Acuity appointment error:', err);
    return serverError('Failed to cancel appointment');
  }
};
