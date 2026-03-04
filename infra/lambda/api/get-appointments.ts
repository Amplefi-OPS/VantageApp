/**
 * GET /appointments?provider_id=...&date=...
 *
 * Returns appointments for a provider on a given date.
 *
 * Query params:
 *   provider_id (required)
 *   date        (optional) - ISO date string (YYYY-MM-DD), defaults to today
 *   range_end   (optional) - ISO date string, for multi-day range
 *
 * Response:
 * {
 *   "appointments": [
 *     {
 *       "appointment_id": "appt-abc123",
 *       "provider_id": "dr-smith-001",
 *       "patient_id": "pt-token-abc",
 *       "patient_name": "J. Doe",
 *       "type": "in_office",
 *       "start_time": "2024-01-15T09:00:00Z",
 *       "end_time": "2024-01-15T09:30:00Z",
 *       "status": "scheduled",
 *       "reason": "Follow-up visit",
 *       "notes": ""
 *     }
 *   ],
 *   "count": 1
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity, canAccessProvider } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { success, badRequest, forbidden, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const params = event.queryStringParameters || {};

    const providerId = params.provider_id;
    if (!providerId) {
      return badRequest('Missing required query parameter: provider_id');
    }

    if (!canAccessProvider(caller, providerId)) {
      return forbidden('Cannot access appointments for another provider');
    }

    const date = params.date || new Date().toISOString().slice(0, 10);
    const rangeEnd = params.range_end || date;

    // Query: PK = PROVIDER#{id}, SK between APPT#{date} and APPT#{rangeEnd}~
    const items = await queryItems({
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :skStart AND :skEnd',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':skStart': `APPT#${date}`,
        ':skEnd': `APPT#${rangeEnd}~`,  // ~ sorts after any time value
      },
    });

    const appointments = items.map((item) => ({
      appointment_id: item.appointmentId,
      provider_id: item.providerId,
      patient_id: item.patientId,
      patient_name: item.patientName,
      type: item.appointmentType, // in_office | telehealth | phone
      start_time: item.startTime,
      end_time: item.endTime,
      status: item.status,        // scheduled | checked_in | completed | cancelled | no_show
      reason: item.reason,
      notes: item.notes,
    }));

    return success({
      appointments,
      count: appointments.length,
    });
  } catch (err) {
    console.error('Get appointments error:', (err as Error).message);
    return serverError('Failed to retrieve appointments');
  }
};
