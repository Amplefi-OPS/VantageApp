/**
 * GET /patients
 *
 * Returns all patients for the authenticated provider.
 * Admins can see all patients.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { queryItemsPaginated } from '../../shared/dynamo';
import { success, badRequest, serverError } from '../../shared/response';

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
    const params = event.queryStringParameters || {};

    const limit = Math.min(Math.max(parseInt(params.limit || '25', 10), 1), 100);
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (params.nextToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(params.nextToken, 'base64').toString('utf-8'));
      } catch {
        return badRequest('Invalid nextToken');
      }
    }

    const result = await queryItemsPaginated({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'PATIENT',
      },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    });

    const patients = result.items.map(mapPatient);
    const nextToken = result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
      : null;

    return success({ patients, nextToken });
  } catch (err) {
    console.error('List patients error:', (err as Error).message);
    return serverError('Failed to retrieve patients');
  }
};
