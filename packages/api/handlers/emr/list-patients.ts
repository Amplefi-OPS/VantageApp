/**
 * GET /patients  (EMR)
 *
 * Roster browse + match-oriented lookup, all on one endpoint. Priority order
 * when multiple search params are present: phone > email > dob > q.
 *
 *   ?phone=7275551234      exact match on mobile_phone OR home_phone (digits only)
 *   ?email=foo@bar.com     exact match on email (lowercased)
 *   ?dob=1974-11-11        exact match on dob (ISO)
 *   ?q=smith               begins_with GSI1SK = `{last}#{first}` (lowercased)
 *   (none)                 roster browse via GSI1 PATIENT partition
 *
 *   ?limit=25              1..100, default 25 (applied to the roster/prefix browse only;
 *                          phone/email/dob drain the full partition and return all matches)
 *   ?nextToken=...         base64 LastEvaluatedKey (browse/prefix modes only)
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { queryItemsPaginated } from '../../shared/dynamo';
import { success, badRequest, serverError, setRequestOrigin } from '../../shared/response';

function mapProfile(item: Record<string, unknown>) {
  const { PK, SK, GSI1PK, GSI1SK, entity_type, ...rest } = item;
  return rest;
}

async function drainPatientPartition(
  filterExpression: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await queryItemsPaginated({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: filterExpression,
      ExpressionAttributeValues: { ':pk': 'PATIENT', ...values },
      ExclusiveStartKey: lastKey,
    });
    items.push(...page.items);
    lastKey = page.lastEvaluatedKey;
  } while (lastKey);
  return items;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);
    const params = event.queryStringParameters || {};

    const phone = (params.phone || '').replace(/\D/g, '');
    const email = (params.email || '').trim().toLowerCase();
    const dob = (params.dob || '').trim();
    const q = (params.q || '').trim().toLowerCase();

    // Match-oriented lookups drain the partition and return all hits.
    if (phone) {
      const items = await drainPatientPartition(
        'mobile_phone = :p OR home_phone = :p',
        { ':p': phone },
      );
      return success({ patients: items.map(mapProfile), nextToken: null });
    }
    if (email) {
      const items = await drainPatientPartition('email = :e', { ':e': email });
      return success({ patients: items.map(mapProfile), nextToken: null });
    }
    if (dob) {
      const items = await drainPatientPartition('dob = :d', { ':d': dob });
      return success({ patients: items.map(mapProfile), nextToken: null });
    }

    // Browse / prefix modes are paginated.
    const limit = Math.min(Math.max(parseInt(params.limit || '25', 10), 1), 100);
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (params.nextToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(params.nextToken, 'base64').toString('utf-8'));
      } catch {
        return badRequest('Invalid nextToken');
      }
    }

    const query = q
      ? {
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
          ExpressionAttributeValues: { ':pk': 'PATIENT', ':sk': q },
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }
      : {
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': 'PATIENT' },
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        };

    const result = await queryItemsPaginated(query);
    const patients = result.items.map(mapProfile);
    const nextToken = result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
      : null;

    return success({ patients, nextToken });
  } catch (err) {
    console.error('EMR list patients error:', (err as Error).message);
    return serverError('Failed to retrieve patients');
  }
};
