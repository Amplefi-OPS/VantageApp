/**
 * GET /patients/{id}  (EMR)
 *
 * Fetches the PROFILE item for a given patient_id from the EMR table.
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

    const { PK, SK, GSI1PK, GSI1SK, entity_type, ...rest } = item;
    return success(rest);
  } catch (err) {
    console.error('EMR get patient error:', (err as Error).message);
    return serverError('Failed to retrieve patient');
  }
};
