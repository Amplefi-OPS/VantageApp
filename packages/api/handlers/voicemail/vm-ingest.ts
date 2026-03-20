/**
 * Voicemail Ingest Handler
 *
 * Triggered when a voicemail audio file is saved to S3.
 * Stores the voicemail record in DynamoDB and kicks off a
 * Transcribe Medical job automatically.
 *
 * TODO: Wire up S3 event notification or EventBridge rule to invoke this handler.
 * TODO: Implement full voicemail metadata extraction from the trigger event.
 */

import type { Handler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { putItem, writeAuditLog } from '../../shared/dynamo';
import {
  startMedicalTranscriptionJob,
  AUDIO_BUCKET_NAME,
  TRANSCRIPTION_KMS_KEY_ARN,
} from '../../shared/transcribe';

interface VmIngestInput {
  s3Key: string;
  providerId: string;
  callerNumber?: string;
  callerName?: string;
}

const EXT_TO_FORMAT: Record<string, 'wav' | 'mp4' | 'webm' | 'ogg'> = {
  wav: 'wav',
  mp4: 'mp4',
  m4a: 'mp4',
  webm: 'webm',
  ogg: 'ogg',
};

export const handler: Handler<VmIngestInput> = async (input) => {
  const { s3Key, providerId, callerNumber, callerName } = input;
  const voicemailId = `vm-${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  // Save voicemail record to DynamoDB
  const jobName = `voicemail-${randomUUID()}`;
  const outputKey = `transcriptions/${jobName}.json`;
  const ext = s3Key.split('.').pop()?.toLowerCase() || 'webm';
  const mediaFormat = EXT_TO_FORMAT[ext] || 'webm';

  await putItem({
    PK: `PROVIDER#${providerId}`,
    SK: `VOICEMAIL#${voicemailId}`,
    voicemailId,
    providerId,
    s3Key,
    callerNumber: callerNumber || null,
    callerName: callerName || null,
    transcriptionJobName: jobName,
    transcriptionStatus: 'IN_PROGRESS',
    transcript: null,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `PROVIDER#${providerId}`,
    GSI1SK: `VOICEMAIL#${now}`,
    entityType: 'Voicemail',
  });

  // Kick off Transcribe Medical job
  await startMedicalTranscriptionJob({
    jobName,
    s3Uri: `s3://${AUDIO_BUCKET_NAME}/${s3Key}`,
    mediaFormat,
    specialty: 'PRIMARYCARE',
    type: 'CONVERSATION',
    outputBucket: AUDIO_BUCKET_NAME,
    outputKey,
    kmsKeyArn: TRANSCRIPTION_KMS_KEY_ARN,
  });

  await writeAuditLog({
    providerId,
    action: 'VOICEMAIL_INGESTED',
    entityType: 'Voicemail',
    entityId: voicemailId,
    details: { jobName, s3Key },
  });

  console.log(`Voicemail ingested: ${voicemailId}, transcription job: ${jobName}`);

  return { voicemailId, jobName, status: 'IN_PROGRESS' };
};
