/**
 * POST /transcription/start
 *
 * Kicks off an AWS Transcribe Medical job for a previously-uploaded
 * audio file (dictation or voicemail).
 *
 * Body: { s3Key: string, jobType: 'DICTATION' | 'VOICEMAIL', recordId?: string }
 *
 * Returns 202: { jobName: string }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../../shared/auth';
import { writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, serverError, parseBody } from '../../shared/response';
import {
  startMedicalTranscriptionJob,
  AUDIO_BUCKET_NAME,
  TRANSCRIPTION_KMS_KEY_ARN,
} from '../../shared/transcribe';

const VALID_JOB_TYPES = new Set(['DICTATION', 'VOICEMAIL']);

const EXT_TO_FORMAT: Record<string, 'wav' | 'mp4' | 'webm' | 'ogg'> = {
  wav: 'wav',
  mp4: 'mp4',
  m4a: 'mp4',
  webm: 'webm',
  ogg: 'ogg',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const s3Key = body.s3Key as string | undefined;
    const jobType = body.jobType as string | undefined;
    const recordId = body.recordId as string | undefined;

    if (!s3Key || !jobType) {
      return badRequest('Missing required fields: s3Key, jobType');
    }

    // Path traversal guard
    if (!s3Key.startsWith('audio/')) {
      return badRequest('s3Key must start with "audio/"');
    }

    if (!VALID_JOB_TYPES.has(jobType)) {
      return badRequest('jobType must be DICTATION or VOICEMAIL');
    }

    // Generate job name: sanitize to alphanumeric + hyphens, max 200 chars
    const rawName = `${jobType.toLowerCase()}-${randomUUID()}`;
    const jobName = rawName.replace(/[^a-z0-9-]/g, '').slice(0, 200);

    // Determine media format from file extension
    const ext = s3Key.split('.').pop()?.toLowerCase() || 'webm';
    const mediaFormat = EXT_TO_FORMAT[ext] || 'webm';

    const outputKey = `transcriptions/${jobName}.json`;

    await startMedicalTranscriptionJob({
      jobName,
      s3Uri: `s3://${AUDIO_BUCKET_NAME}/${s3Key}`,
      mediaFormat,
      specialty: 'PRIMARYCARE',
      type: jobType === 'DICTATION' ? 'DICTATION' : 'CONVERSATION',
      outputBucket: AUDIO_BUCKET_NAME,
      outputKey,
      kmsKeyArn: TRANSCRIPTION_KMS_KEY_ARN,
    });

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'TRANSCRIPTION_STARTED',
      entityType: 'Transcription',
      entityId: jobName,
      details: { jobName, jobType, recordId: recordId || null },
    });

    return success({ jobName }, 202);
  } catch (err) {
    console.error('Start transcription error:', (err as Error).message);
    return serverError('Failed to start transcription');
  }
};
