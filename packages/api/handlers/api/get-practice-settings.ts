/**
 * GET /settings/practice
 *
 * Returns practice-wide configuration: appointment types and prices.
 * Stored at PRACTICE#vantage / SETTINGS in DynamoDB.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getItem } from '../../shared/dynamo';
import { success, serverError, setRequestOrigin } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);
    const item = await getItem('PRACTICE#vantage', 'SETTINGS');
    return success({
      appointmentTypes: (item?.appointmentTypes as { name: string; amountCents: number }[]) || [],
    });
  } catch (err) {
    console.error('Get practice settings error:', (err as Error).message);
    return serverError('Failed to load settings');
  }
};
