/**
 * PATCH /appointments/{id}
 *
 * Reschedules an appointment in Google Calendar.
 *
 * Request body:
 * {
 *   "startTime": "2026-03-15T10:00:00-05:00",
 *   "endTime": "2026-03-15T10:30:00-05:00"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { writeAuditLog } from '../shared/dynamo';
import { success, badRequest, serverError, parseBody } from '../shared/response';
import { getGoogleAccessToken, getCalendarId } from '../shared/google';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const appointmentId = event.pathParameters?.id;
    if (!appointmentId) return badRequest('Missing appointment ID');

    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const { startTime, endTime } = body;
    if (!startTime || !endTime) {
      return badRequest('Missing required fields: startTime, endTime');
    }

    const token = await getGoogleAccessToken();
    const calendarId = await getCalendarId();

    const patch: Record<string, unknown> = {
      start: { dateTime: startTime, timeZone: 'America/New_York' },
      end: { dateTime: endTime, timeZone: 'America/New_York' },
    };

    const res = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(appointmentId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`Google Calendar update failed (${res.status}): ${text}`);
      return serverError('Failed to reschedule appointment');
    }

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'RESCHEDULE_APPOINTMENT',
      entityType: 'Appointment',
      entityId: appointmentId,
      details: { newStartTime: startTime, newEndTime: endTime },
    });

    return success({ rescheduled: true, appointmentId, startTime, endTime });
  } catch (err) {
    console.error('Reschedule appointment error:', (err as Error).message);
    return serverError('Failed to reschedule appointment');
  }
};
