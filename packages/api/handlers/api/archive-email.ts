/**
 * PATCH /emails/{id}/archive
 *
 * Soft-archive an inbound email so it disappears from the Unmatched view.
 * Idempotent — already-archived rows are returned as-is.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { getItem, updateItem, buildUpdateExpression, writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, notFound, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const emailId = event.pathParameters?.id;
    if (!emailId) return badRequest('emailId path param required');

    const row = await getItem('PRACTICE#vantage', `EMAIL#${emailId}`);
    if (!row) return notFound('Email not found');

    if (row.status !== 'Archived') {
      const upd = buildUpdateExpression({
        status: 'Archived',
        updatedAt: new Date().toISOString(),
      });
      if (upd) {
        await updateItem({
          Key: { PK: 'PRACTICE#vantage', SK: `EMAIL#${emailId}` },
          ...upd,
        });
      }
      await writeAuditLog({
        providerId: caller.providerId,
        action: 'ARCHIVE_EMAIL',
        entityType: 'Email',
        entityId: emailId,
        details: { archivedBy: caller.email },
      });
    }

    return success({ id: emailId, status: 'Archived' });
  } catch (err) {
    console.error('Archive email error:', (err as Error).message);
    return serverError('Failed to archive email');
  }
};
