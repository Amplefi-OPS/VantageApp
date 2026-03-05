/**
 * Step Functions State: Start Voicemail Transcription
 *
 * Starts an AWS Transcribe Medical job for voicemail audio.
 * Uses CONVERSATION type (not DICTATION) since voicemails are conversational.
 * Updates the voicemail record status to "Transcribing".
 *
 * Input (from vm-s3-trigger):
 * {
 *   "bucket": "vantage-audio-dev-...",
 *   "key": "voicemails/provider-001/vm-abc123.mp3",
 *   "providerId": "provider-001",
 *   "vmId": "vm-abc123"
 * }
 *
 * Output:
 * {
 *   "jobName": "vantage-vm-abc123-1705312200000",
 *   "vmId": "vm-abc123",
 *   "providerId": "provider-001",
 *   "outputKey": "transcripts/provider-001/voicemails/vm-abc123.json",
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
import { getItem, updateItem, buildUpdateExpression, writeAuditLog } from '../shared/dynamo';

const transcribe = new TranscribeClient({});
const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET!;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN!;

interface VmTranscriptionInput {
  bucket: string;
  key: string;
  providerId: string;
  vmId: string;
}

const EXT_TO_FORMAT: Record<string, MediaFormat> = {
  mp3: 'mp3',
  m4a: 'mp4',
  mp4: 'mp4',
  wav: 'wav',
  flac: 'flac',
};

export const handler: Handler<VmTranscriptionInput> = async (input) => {
  const { bucket, key, providerId, vmId } = input;

  // ── Idempotency: skip if already transcribed or in progress ──
  const existing = await getItem(`PROVIDER#${providerId}`, `VOICEMAIL#${vmId}`);
  const existingStatus = existing?.transcriptStatus as string | undefined;
  if (existingStatus === 'Complete' || existingStatus === 'Transcribing') {
    console.log(`Skipping transcription for ${vmId}: already ${existingStatus}`);
    return {
      jobName: existing?.jobName || 'skipped',
      vmId,
      providerId,
      outputKey: existing?.transcriptKey || '',
      status: existingStatus === 'Complete' ? 'COMPLETED' : 'ALREADY_IN_PROGRESS',
    };
  }

  const ext = key.split('.').pop()?.toLowerCase() || 'mp3';
  const mediaFormat = EXT_TO_FORMAT[ext] || 'mp3';
  const jobName = `vantage-vm-${vmId}-${Date.now()}`;
  const outputKey = `transcripts/${providerId}/voicemails/${vmId}.json`;

  console.log(`Starting Transcribe Medical job for voicemail: ${jobName}`);

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
    Type: 'CONVERSATION' as Type,
    Settings: {
      ShowSpeakerLabels: false,
      ChannelIdentification: false,
    },
  }));

  // Update voicemail record status
  const now = new Date().toISOString();
  const updates = buildUpdateExpression({
    transcriptStatus: 'Transcribing',
    jobName,
    transcriptKey: outputKey,
    updatedAt: now,
  });

  if (updates) {
    await updateItem({
      Key: {
        PK: `PROVIDER#${providerId}`,
        SK: `VOICEMAIL#${vmId}`,
      },
      ...updates,
    });
  }

  await writeAuditLog({
    providerId,
    action: 'START_VM_TRANSCRIPTION',
    entityType: 'Voicemail',
    entityId: vmId,
    details: { jobName, mediaFormat },
  });

  return {
    jobName,
    vmId,
    providerId,
    outputKey,
    status: 'IN_PROGRESS',
  };
};
