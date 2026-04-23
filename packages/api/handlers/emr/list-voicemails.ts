/**
 * GET /voicemails?status=unmatched  (EMR)
 *
 * Returns voicemails awaiting admin review, newest-first. Unmatched voicemails
 * live under PK=VOICEMAIL#UNMATCHED with SK=VM#{received_at}#{vm_id}; once
 * attached to a patient they move to PK=PATIENT#{pid}, SK=VOICEMAIL#... and
 * drop out of this listing.
 *
 *   ?limit=25       1..100, default 25
 *   ?nextToken=...  base64 LastEvaluatedKey
 *
 * (status= is currently required to equal "unmatched"; attached voicemails
 * are served via the patient-detail endpoint in a later pass.)
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { queryItemsPaginated } from '../../shared/dynamo';
import { success, badRequest, serverError, setRequestOrigin } from '../../shared/response';

function mapVoicemail(item: Record<string, unknown>) {
  const { PK, SK, entity_type, ...rest } = item;
  return rest;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);
    const params = event.queryStringParameters || {};

    const status = (params.status || 'unmatched').toLowerCase();
    if (status !== 'unmatched') {
      return badRequest('Only status=unmatched is supported on this endpoint');
    }

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
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'VOICEMAIL#UNMATCHED' },
      ScanIndexForward: false, // newest-first
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    });

    const voicemails = result.items.map(mapVoicemail);
    const nextToken = result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
      : null;

    return success({ voicemails, nextToken });
  } catch (err) {
    console.error('EMR list voicemails error:', (err as Error).message);
    return serverError('Failed to retrieve voicemails');
  }
};
