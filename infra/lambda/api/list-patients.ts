/**
 * GET /patients
 *
 * Returns all patients for the authenticated provider.
 * Admins can see all patients.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { success, serverError } from '../shared/response';

function mapPatient(item: Record<string, unknown>) {
  return {
    id: item.patientId,
    firstName: item.firstName,
    lastName: item.lastName,
    phone: item.phone,
    dob: item.dob || undefined,
    email: item.email || undefined,
    gender: item.gender || undefined,
    preferredLanguage: item.preferredLanguage || undefined,
    addressStreet: item.addressStreet || undefined,
    addressCity: item.addressCity || undefined,
    addressState: item.addressState || undefined,
    addressZip: item.addressZip || undefined,
    emergencyContactName: item.emergencyContactName || undefined,
    emergencyContactPhone: item.emergencyContactPhone || undefined,
    emergencyContactRelationship: item.emergencyContactRelationship || undefined,
    primaryCareProvider: item.primaryCareProvider || undefined,
    allergies: item.allergies || undefined,
    insuranceProvider: item.insuranceProvider || undefined,
    insuranceId: item.insuranceId || undefined,
    insuranceGroupNumber: item.insuranceGroupNumber || undefined,
    insurancePolicyHolder: item.insurancePolicyHolder || undefined,
    notes: item.notes || undefined,
    createdAt: item.createdAt,
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);

    // Query patients created by this provider via GSI1
    const items = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${caller.providerId}`,
        ':sk': 'PATIENT#',
      },
    });

    const patients = items.map(mapPatient);

    return success(patients);
  } catch (err) {
    console.error('List patients error:', (err as Error).message);
    return serverError('Failed to retrieve patients');
  }
};
