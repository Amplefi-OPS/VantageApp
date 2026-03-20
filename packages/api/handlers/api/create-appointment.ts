/**
 * POST /appointments
 *
 * Creates a new appointment in Google Calendar.
 *
 * Request body:
 * {
 *   "patientName": "John Smith",
 *   "patientPhone": "+17275551234",
 *   "patientEmail": "john@example.com",
 *   "type": "New Patient",
 *   "startTime": "2026-02-27T09:00:00-05:00",
 *   "endTime": "2026-02-27T09:30:00-05:00",
 *   "notes": ""
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { writeAuditLog } from '../../shared/dynamo';
import { created, badRequest, serverError, parseBody } from '../../shared/response';
import { getGoogleAccessToken, getCalendarId } from '../../shared/google';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const patientName = body.patientName as string | undefined;
    const type = body.type as string | undefined;
    const startTime = body.startTime as string | undefined;
    const endTime = body.endTime as string | undefined;

    if (!patientName || !type || !startTime || !endTime) {
      return badRequest('Missing required fields: patientName, type, startTime, endTime');
    }

    // Build Google Calendar event summary: "FirstName LastName - Type"
    const summary = `${patientName} - ${type}`;

    // Build description with phone and email for the list Lambda to parse
    const descLines: string[] = [];
    if (body.patientPhone) descLines.push(`Phone: ${body.patientPhone}`);
    if (body.patientEmail) descLines.push(`Email: ${body.patientEmail}`);
    if (body.notes) descLines.push(body.notes as string);
    const description = descLines.join('\n');

    const token = await getGoogleAccessToken();
    const calendarId = await getCalendarId();

    const gcalEvent = {
      summary,
      description,
      start: { dateTime: startTime, timeZone: 'America/New_York' },
      end: { dateTime: endTime, timeZone: 'America/New_York' },
      status: 'confirmed',
    };

    const res = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(gcalEvent),
      },
    );

    if (!res.ok) {
      console.error(`Google Calendar create failed (HTTP ${res.status})`);
      return serverError('Failed to create appointment in Google Calendar');
    }

    const created_event = (await res.json()) as { id: string; htmlLink?: string };

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'CREATE_APPOINTMENT',
      entityType: 'Appointment',
      entityId: created_event.id,
      details: { createdBy: caller.email, patientName, type },
    });

    return created({
      appointmentId: created_event.id,
      patientName,
      type,
      startTime,
      endTime,
      calendarLink: created_event.htmlLink || null,
    });
  } catch (err) {
    console.error('Create appointment error:', (err as Error).message);
    return serverError('Failed to create appointment');
  }
};
