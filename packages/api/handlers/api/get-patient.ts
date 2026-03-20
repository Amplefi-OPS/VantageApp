/**
 * GET /patients/{id}
 *
 * Returns a single patient by ID.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getItem } from '../../shared/dynamo';
import { success, notFound, serverError, setRequestOrigin } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);
    const patientId = event.pathParameters?.id;
    if (!patientId) {
      return notFound('Patient not found');
    }

    const item = await getItem(`PATIENT#${patientId}`, 'PROFILE');
    if (!item) {
      return notFound('Patient not found');
    }

    return success({
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
    });
  } catch (err) {
    console.error('Get patient error:', (err as Error).message);
    return serverError('Failed to retrieve patient');
  }
};
