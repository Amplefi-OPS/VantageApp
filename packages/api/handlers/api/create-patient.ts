/**
 * POST /patients
 *
 * Creates a new patient record.
 *
 * Request body:
 * {
 *   "firstName": "John",
 *   "lastName": "Smith",
 *   "phone": "(555) 000-0000",
 *   "dob": "1990-01-15",
 *   "email": "john@example.com",
 *   "gender": "Male",
 *   "preferredLanguage": "English",
 *   "addressStreet": "123 Main St",
 *   "addressCity": "Springfield",
 *   "addressState": "IL",
 *   "addressZip": "62701",
 *   "emergencyContactName": "Jane Smith",
 *   "emergencyContactPhone": "(555) 000-0001",
 *   "emergencyContactRelationship": "Spouse",
 *   "primaryCareProvider": "Dr. Chen",
 *   "allergies": "Penicillin",
 *   "insuranceProvider": "Blue Cross",
 *   "insuranceId": "BCB123456",
 *   "insuranceGroupNumber": "GRP001",
 *   "insurancePolicyHolder": "Self",
 *   "notes": "Referred by Dr. Park"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../../shared/auth';
import { putItem, queryItems, writeAuditLog } from '../../shared/dynamo';
import { created, badRequest, serverError, parseBody } from '../../shared/response';
import { sendSlackAlert } from '../../shared/slack';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const firstName = body.firstName as string | undefined;
    const lastName = body.lastName as string | undefined;
    const phone = body.phone as string | undefined;
    if (!firstName || !lastName || !phone) {
      return badRequest('Missing required fields: firstName, lastName, phone');
    }

    // Check for duplicate patient by normalized phone or email
    const email = body.email as string | undefined;
    const normalizeDigits = (p: string) => p.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    const inputDigits = normalizeDigits(phone);

    const allPatients = await queryItems({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'PATIENT',
      },
      ProjectionExpression: 'patientId, firstName, lastName, phone, email',
    });

    const match = allPatients.find((p) => {
      const existingDigits = normalizeDigits((p.phone as string) || '');
      if (inputDigits.length >= 10 && existingDigits.length >= 10 && inputDigits === existingDigits) return true;
      if (email && p.email && (p.email as string).toLowerCase() === email.toLowerCase()) return true;
      return false;
    });

    if (match) {
      return badRequest(
        `A patient with this phone number already exists: ${match.firstName} ${match.lastName}`,
      );
    }

    const patientId = `pt-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      PK: `PATIENT#${patientId}`,
      SK: 'PROFILE',
      patientId,
      firstName,
      lastName,
      phone,
      dob: body.dob || null,
      email: body.email || null,
      gender: body.gender || null,
      preferredLanguage: body.preferredLanguage || null,
      addressStreet: body.addressStreet || null,
      addressCity: body.addressCity || null,
      addressState: body.addressState || null,
      addressZip: body.addressZip || null,
      emergencyContactName: body.emergencyContactName || null,
      emergencyContactPhone: body.emergencyContactPhone || null,
      emergencyContactRelationship: body.emergencyContactRelationship || null,
      primaryCareProvider: body.primaryCareProvider || null,
      allergies: body.allergies || null,
      insuranceProvider: body.insuranceProvider || null,
      insuranceId: body.insuranceId || null,
      insuranceGroupNumber: body.insuranceGroupNumber || null,
      insurancePolicyHolder: body.insurancePolicyHolder || null,
      notes: body.notes || null,
      createdAt: now,
      updatedAt: now,
      providerId: caller.providerId,
      createdBy: caller.email,
      // GSI keys for provider-scoped queries
      GSI1PK: `PROVIDER#${caller.providerId}`,
      GSI1SK: `PATIENT#${now}`,
      GSI2PK: 'PATIENT',
      GSI2SK: `${now}#${patientId}`,
      entityType: 'Patient',
    };

    await putItem(item);

    // Slack notification — no PHI (only first name initial + last name)
    await sendSlackAlert('New Patient Created', 'info', [
      { label: 'Patient', value: `${firstName.charAt(0)}. ${lastName}` },
      { label: 'Created by', value: caller.email },
    ]);

    // HIPAA: Audit log — no PHI in details
    await writeAuditLog({
      providerId: caller.providerId,
      action: 'CREATE_PATIENT',
      entityType: 'Patient',
      entityId: patientId,
      details: { createdBy: caller.email },
    });

    return created({
      id: patientId,
      firstName,
      lastName,
      phone,
      dob: body.dob || undefined,
      email: body.email || undefined,
      gender: body.gender || undefined,
      preferredLanguage: body.preferredLanguage || undefined,
      addressStreet: body.addressStreet || undefined,
      addressCity: body.addressCity || undefined,
      addressState: body.addressState || undefined,
      addressZip: body.addressZip || undefined,
      emergencyContactName: body.emergencyContactName || undefined,
      emergencyContactPhone: body.emergencyContactPhone || undefined,
      emergencyContactRelationship: body.emergencyContactRelationship || undefined,
      primaryCareProvider: body.primaryCareProvider || undefined,
      allergies: body.allergies || undefined,
      insuranceProvider: body.insuranceProvider || undefined,
      insuranceId: body.insuranceId || undefined,
      insuranceGroupNumber: body.insuranceGroupNumber || undefined,
      insurancePolicyHolder: body.insurancePolicyHolder || undefined,
      notes: body.notes || undefined,
      createdAt: now,
    });
  } catch (err) {
    // HIPAA: Only log error type, never request body
    console.error('Create patient error:', (err as Error).message);
    return serverError('Failed to create patient');
  }
};
