/**
 * DELETE /voicemails/{id}?providerId=...
 *
 * Deletes a voicemail from Zoom, S3, and DynamoDB.
 * Only allowed after the linked todo task is completed (status = 'Done').
 *
 * Path param: id (voicemail ID)
 * Query param: providerId (optional, defaults to caller's providerId)
 *
 * Returns 204 on success.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getCallerIdentity } from '../../shared/auth';
import { getItem, deleteItem, writeAuditLog } from '../../shared/dynamo';
import { badRequest, forbidden, notFound, serverError } from '../../shared/response';
import { zoomDelete } from '../../shared/zoom';

const s3 = new S3Client({});
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const voicemailId = event.pathParameters?.id;
    if (!voicemailId) return badRequest('Missing path parameter: id');

    const providerId = event.queryStringParameters?.providerId || caller.providerId;

    // 1. Get voicemail record
    const voicemail = await getItem(`PROVIDER#${providerId}`, `VOICEMAIL#${voicemailId}`);
    if (!voicemail) return notFound('Voicemail not found');

    // 2. Verify linked task exists and is completed
    const taskId = voicemail.taskId as string | undefined;
    if (!taskId) {
      return forbidden('Voicemail can only be deleted after the related task is completed.');
    }

    const task = await getItem(`PROVIDER#${providerId}`, `TASK#${taskId}`);
    if (!task || task.status !== 'Done') {
      return forbidden('Voicemail can only be deleted after the related task is completed.');
    }

    // 3. Delete voicemail from Zoom
    try {
      await zoomDelete(`/phone/voice_mails/${voicemailId}`);
    } catch (err) {
      console.warn('Zoom voicemail delete failed (non-fatal):', (err as Error).message);
    }

    // 4. Delete S3 audio file
    const s3Key = (voicemail.s3Key as string)
      || `voicemails/${providerId}/${voicemailId}.mp3`;
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: s3Key,
      }));
    } catch (err) {
      console.warn('S3 audio delete failed (non-fatal):', (err as Error).message);
    }

    // 5. Delete DynamoDB record
    await deleteItem(`PROVIDER#${providerId}`, `VOICEMAIL#${voicemailId}`);

    // 6. Audit log
    await writeAuditLog({
      providerId,
      action: 'VOICEMAIL_DELETED',
      entityType: 'Voicemail',
      entityId: voicemailId,
      details: {
        deletedBy: caller.email,
        taskId,
      },
    });

    // 7. Return 204 No Content
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
      },
      body: '',
    };
  } catch (err) {
    console.error('Delete voicemail error:', (err as Error).message);
    return serverError('Failed to delete voicemail');
  }
};
