/**
 * PATCH /voicemails/{id}/archive
 *
 * Marks a voicemail as archived so it moves out of the active view.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { getItem, updateItem, buildUpdateExpression, writeAuditLog } from '../shared/dynamo';
import { success, badRequest, notFound, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const voicemailId = event.pathParameters?.id;

    if (!voicemailId) {
      return badRequest('Missing voicemail ID');
    }

    const existing = await getItem(`PROVIDER#${providerId}`, `VOICEMAIL#${voicemailId}`);
    if (!existing) {
      return notFound('Voicemail not found');
    }

    if (existing.status === 'Archived') {
      return success({ status: 'Archived' });
    }

    const now = new Date().toISOString();
    const expr = buildUpdateExpression({
      status: 'Archived',
      updatedAt: now,
    });

    if (expr) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `VOICEMAIL#${voicemailId}` },
        ...expr,
      });
    }

    await writeAuditLog({
      providerId,
      action: 'ARCHIVE_VOICEMAIL',
      entityType: 'VoicemailAttachment',
      entityId: voicemailId,
      details: { previousStatus: existing.status as string },
    });

    return success({ status: 'Archived' });
  } catch (err) {
    console.error('Archive voicemail error:', err);
    return serverError('Failed to archive voicemail');
  }
};
