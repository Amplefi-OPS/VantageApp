/**
 * Step Functions State: Start Transcription
 *
 * Starts an AWS Transcribe Medical job for the uploaded audio file.
 * Updates the dictation record status to "Transcribing".
 *
 * Input (from S3 trigger):
 * {
 *   "bucket": "vantage-audio-dev-...",
 *   "key": "dictations/dr-smith-001/2024-01-15/dict-abc123.m4a",
 *   "providerId": "dr-smith-001",
 *   "dictationId": "dict-abc123",
 *   "date": "2024-01-15"
 * }
 *
 * Output:
 * {
 *   "jobName": "vantage-dict-abc123-1705312200000",
 *   "dictationId": "dict-abc123",
 *   "providerId": "dr-smith-001",
 *   "status": "IN_PROGRESS"
 * }
 */

import type { Handler } from 'aws-lambda';
import {
  TranscribeClient,
  StartMedicalTranscriptionJobCommand,
  type LanguageCode,
  type MediaFormat,
  type Specialty,
  type Type,
} from '@aws-sdk/client-transcribe';
import { updateItem, buildUpdateExpression, writeAuditLog } from '../../shared/dynamo';

const transcribe = new TranscribeClient({});
const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET!;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN!;

interface TranscriptionInput {
  bucket: string;
  key: string;
  providerId: string;
  dictationId: string;
  date: string;
}

const EXT_TO_FORMAT: Record<string, MediaFormat> = {
  m4a: 'mp4',
  mp3: 'mp3',
  mp4: 'mp4',
  wav: 'wav',
  flac: 'flac',
};

export const handler: Handler<TranscriptionInput> = async (input) => {
  const { bucket, key, providerId, dictationId, date } = input;

  const ext = key.split('.').pop()?.toLowerCase() || 'm4a';
  const mediaFormat = EXT_TO_FORMAT[ext] || 'mp4';
  const jobName = `vantage-${dictationId}-${Date.now()}`;
  const outputKey = `transcripts/${providerId}/${date}/${dictationId}.json`;

  console.log(`Starting Transcribe Medical job: ${jobName}`);

  await transcribe.send(new StartMedicalTranscriptionJobCommand({
    MedicalTranscriptionJobName: jobName,
    LanguageCode: 'en-US' as LanguageCode,
    MediaFormat: mediaFormat as MediaFormat,
    Media: {
      MediaFileUri: `s3://${bucket}/${key}`,
    },
    OutputBucketName: TRANSCRIPT_BUCKET,
    OutputKey: outputKey,
    OutputEncryptionKMSKeyId: KMS_KEY_ARN,
    Specialty: 'PRIMARYCARE' as Specialty,
    Type: 'DICTATION' as Type,
    Settings: {
      ShowSpeakerLabels: false,
      ChannelIdentification: false,
    },
  }));

  // Update dictation record: Uploading -> Transcribing
  const now = new Date().toISOString();
  const updates = buildUpdateExpression({
    status: 'Transcribing',
    jobName,
    transcriptKey: outputKey,
    updatedAt: now,
    GSI1SK: `DICTSTATUS#Transcribing#${now}`,
  });

  if (updates) {
    await updateItem({
      Key: {
        PK: `PROVIDER#${providerId}`,
        SK: `DICT#${dictationId}`,
      },
      ...updates,
    });
  }

  // Also update the linked task if one exists
  // (The task_id is stored in the dictation record, but we update it during completion)

  await writeAuditLog({
    providerId,
    action: 'START_TRANSCRIPTION',
    entityType: 'Dictation',
    entityId: dictationId,
    details: { jobName, mediaFormat },
  });

  return {
    jobName,
    dictationId,
    providerId,
    date,
    outputKey,
    status: 'IN_PROGRESS',
  };
};
