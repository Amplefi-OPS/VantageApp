/**
 * GET /emails?status=Unmatched
 *
 * Lists practice-wide inbound emails (fed by the content@ Gmail poller).
 * Default: Unmatched only, newest first.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { queryItems } from '../../shared/dynamo';
import { getCallerIdentity } from '../../shared/auth';
import { success, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);
    const params = event.queryStringParameters || {};
    const statusFilter = params.status || 'Unmatched';
    const limit = Math.min(Math.max(parseInt(params.limit || '100', 10), 1), 250);

    const items = await queryItems({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': 'EMAIL' },
      ScanIndexForward: false, // newest first
      Limit: limit,
    });

    const emails = items
      .filter((i) => statusFilter === 'all' || i.status === statusFilter)
      .map((i) => ({
        id: i.emailId,
        from: i.from,
        fromName: i.fromName || undefined,
        subject: i.subject,
        snippet: i.snippet,
        receivedAt: i.receivedAt,
        status: i.status,
        gmailThreadId: i.gmailThreadId,
        attachedTodoId: i.attachedTodoId || undefined,
        assignedTo: i.assignedTo || undefined,
      }));

    return success({ emails, count: emails.length });
  } catch (err) {
    console.error('List emails error:', (err as Error).message);
    return serverError('Failed to list emails');
  }
};
