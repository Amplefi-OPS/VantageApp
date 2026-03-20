/**
 * PUT /appointments/{id}/cancel
 *
 * Cancels an appointment in Google Calendar by setting status to 'cancelled'.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { success, badRequest, serverError } from '../../shared/response';
import { getGoogleAccessToken, getCalendarId } from '../../shared/google';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);
    const appointmentId = event.pathParameters?.id;
    if (!appointmentId) return badRequest('Missing appointment ID');

    const token = await getGoogleAccessToken();
    const calendarId = await getCalendarId();

    const res = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(appointmentId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' }),
      },
    );

    if (!res.ok) {
      throw new Error(`Google Calendar API error (HTTP ${res.status})`);
    }

    return success({ cancelled: true, appointmentId });
  } catch (err) {
    console.error('Cancel appointment error:', (err as Error).message);
    return serverError('Failed to cancel appointment');
  }
};
