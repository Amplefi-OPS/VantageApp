/**
 * POST /appointments
 *
 * Creates a new appointment.
 *
 * Request body:
 * {
 *   "patientId": "pt-abc123",
 *   "patientName": "John Smith",
 *   "type": "in_office",
 *   "startTime": "2026-02-27T09:00:00Z",
 *   "endTime": "2026-02-27T09:30:00Z",
 *   "reason": "Annual checkup",
 *   "notes": "",
 *   "status": "scheduled"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../shared/auth';
import { putItem, writeAuditLog } from '../shared/dynamo';
import { created, badRequest, serverError } from '../shared/response';

const VALID_TYPES = ['in_office', 'telehealth', 'phone'];
const VALID_STATUSES = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = JSON.parse(event.body || '{}');

    const { patientName, type, startTime, endTime, reason } = body;

    if (!patientName || !type || !startTime || !endTime || !reason) {
      return badRequest('Missing required fields: patientName, type, startTime, endTime, reason');
    }

    if (!VALID_TYPES.includes(type)) {
      return badRequest(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const status = body.status && VALID_STATUSES.includes(body.status) ? body.status : 'scheduled';
    const appointmentId = `appt-${randomUUID().slice(0, 12)}`;
    const date = startTime.slice(0, 10); // YYYY-MM-DD from ISO string
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      PK: `PROVIDER#${caller.providerId}`,
      SK: `APPT#${date}#${appointmentId}`,
      appointmentId,
      providerId: caller.providerId,
      patientId: body.patientId || null,
      patientName,
      appointmentType: type,
      startTime,
      endTime,
      status,
      reason,
      notes: body.notes || '',
      createdAt: now,
      createdBy: caller.email,
      entityType: 'Appointment',
    };

    await putItem(item);

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'CREATE_APPOINTMENT',
      entityType: 'Appointment',
      entityId: appointmentId,
      details: { createdBy: caller.email },
    });

    return created({
      appointment_id: appointmentId,
      provider_id: caller.providerId,
      patient_id: body.patientId || null,
      patient_name: patientName,
      type,
      start_time: startTime,
      end_time: endTime,
      status,
      reason,
      notes: body.notes || '',
    });
  } catch (err) {
    console.error('Create appointment error:', (err as Error).message);
    return serverError('Failed to create appointment');
  }
};
