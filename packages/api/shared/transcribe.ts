/**
 * AWS Transcribe Medical — shared helper
 *
 * Wraps StartMedicalTranscriptionJobCommand and GetMedicalTranscriptionJobCommand
 * for dictation and voicemail transcription pipelines.
 */

import {
  TranscribeClient,
  StartMedicalTranscriptionJobCommand,
  GetMedicalTranscriptionJobCommand,
  type LanguageCode,
  type MediaFormat,
  type Specialty,
  type Type,
} from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const transcribe = new TranscribeClient({});
const s3 = new S3Client({});

if (!process.env.AUDIO_BUCKET_NAME) {
  throw new Error('AUDIO_BUCKET_NAME environment variable is required');
}
if (!process.env.TRANSCRIPTION_KMS_KEY_ARN) {
  throw new Error('TRANSCRIPTION_KMS_KEY_ARN environment variable is required');
}

export const AUDIO_BUCKET_NAME: string = process.env.AUDIO_BUCKET_NAME;
export const TRANSCRIPTION_KMS_KEY_ARN: string = process.env.TRANSCRIPTION_KMS_KEY_ARN;

export async function startMedicalTranscriptionJob(params: {
  jobName: string;
  s3Uri: string;
  mediaFormat: 'wav' | 'mp4' | 'webm' | 'ogg';
  specialty: 'PRIMARYCARE';
  type: 'DICTATION' | 'CONVERSATION';
  outputBucket: string;
  outputKey: string;
  kmsKeyArn: string;
}): Promise<void> {
  await transcribe.send(new StartMedicalTranscriptionJobCommand({
    MedicalTranscriptionJobName: params.jobName,
    LanguageCode: 'en-US' as LanguageCode,
    MediaFormat: params.mediaFormat as MediaFormat,
    Media: {
      MediaFileUri: params.s3Uri,
    },
    OutputBucketName: params.outputBucket,
    OutputKey: params.outputKey,
    OutputEncryptionKMSKeyId: params.kmsKeyArn,
    Specialty: params.specialty as Specialty,
    Type: params.type as Type,
    Settings: {
      ShowSpeakerLabels: false,
      ChannelIdentification: false,
    },
  }));
}

export async function getMedicalTranscriptionResult(jobName: string): Promise<{
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  transcript?: string;
}> {
  const result = await transcribe.send(new GetMedicalTranscriptionJobCommand({
    MedicalTranscriptionJobName: jobName,
  }));

  const job = result.MedicalTranscriptionJob;
  const status = job?.TranscriptionJobStatus as 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | undefined;

  if (!status) {
    return { status: 'FAILED' };
  }

  if (status !== 'COMPLETED') {
    return { status };
  }

  // COMPLETED: fetch transcript JSON from S3
  const outputUri = job?.Transcript?.TranscriptFileUri;
  if (!outputUri) {
    return { status: 'COMPLETED' };
  }

  // Parse s3://bucket/key from the URI
  const uriMatch = outputUri.match(/^(?:https:\/\/s3[^/]*\.amazonaws\.com\/([^/]+)\/(.+)|s3:\/\/([^/]+)\/(.+))$/);
  const bucket = uriMatch?.[1] || uriMatch?.[3];
  const key = uriMatch?.[2] || uriMatch?.[4];

  if (!bucket || !key) {
    console.error('Could not parse transcript URI:', outputUri);
    return { status: 'COMPLETED' };
  }

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = await obj.Body?.transformToString('utf-8');
    if (raw) {
      const parsed = JSON.parse(raw);
      const transcript = parsed.results?.transcripts?.[0]?.transcript;
      return { status: 'COMPLETED', transcript };
    }
  } catch (err) {
    console.error('Failed to read transcript from S3:', (err as Error).message);
  }

  return { status: 'COMPLETED' };
}
