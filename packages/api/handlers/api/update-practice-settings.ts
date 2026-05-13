/**
 * PUT /settings/practice
 *
 * Saves practice-wide configuration: appointment types and prices.
 * Stored at PRACTICE#vantage / SETTINGS in DynamoDB.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { putItem, writeAuditLog } from '../../shared/dynamo';
import { getCallerIdentity } from '../../shared/auth';
import { success, badRequest, serverError, parseBody, setRequestOrigin } from '../../shared/response';

interface AppointmentType {
  name: string;
  amountCents: number;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON');

    const types = body.appointmentTypes as AppointmentType[] | undefined;
    if (!Array.isArray(types)) return badRequest('appointmentTypes must be an array');
    for (const t of types) {
      if (!t.name || typeof t.amountCents !== 'number' || t.amountCents < 0) {
        return badRequest('Each appointment type needs a name and amountCents >= 0');
      }
    }

    const now = new Date().toISOString();
    await putItem({
      PK: 'PRACTICE#vantage',
      SK: 'SETTINGS',
      appointmentTypes: types,
      updatedAt: now,
      updatedBy: caller.email,
    });

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'UPDATE_PRACTICE_SETTINGS',
      entityType: 'PracticeSettings',
      entityId: 'vantage',
      details: { appointmentTypeCount: types.length, updatedBy: caller.email },
    });

    return success({ appointmentTypes: types });
  } catch (err) {
    console.error('Update practice settings error:', (err as Error).message);
    return serverError('Failed to save settings');
  }
};
