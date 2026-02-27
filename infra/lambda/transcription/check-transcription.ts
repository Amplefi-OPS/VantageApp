/**
 * Step Functions State: Check Transcription Status
 *
 * Polls AWS Transcribe Medical for job status.
 * Returns status so the Step Functions choice state can route accordingly.
 *
 * Input:
 * {
 *   "jobName": "vantage-dict-abc123-...",
 *   "dictationId": "dict-abc123",
 *   "providerId": "dr-smith-001",
 *   "date": "2024-01-15",
 *   "outputKey": "transcripts/.../dict-abc123.json",
 *   "status": "IN_PROGRESS"
 * }
 *
 * Output:
 * {
 *   ...input,
 *   "status": "COMPLETED" | "FAILED" | "IN_PROGRESS",
 *   "error": "reason" (if failed)
 * }
 */

import type { Handler } from 'aws-lambda';
import {
  TranscribeClient,
  GetMedicalTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';

const transcribe = new TranscribeClient({});

interface CheckInput {
  jobName: string;
  dictationId: string;
  providerId: string;
  date: string;
  outputKey: string;
  status: string;
}

export const handler: Handler<CheckInput> = async (input) => {
  const { jobName } = input;

  console.log(`Checking transcription job status: ${jobName}`);

  const response = await transcribe.send(
    new GetMedicalTranscriptionJobCommand({
      MedicalTranscriptionJobName: jobName,
    }),
  );

  const job = response.MedicalTranscriptionJob;
  const jobStatus = job?.TranscriptionJobStatus || 'IN_PROGRESS';

  console.log(`Job ${jobName} status: ${jobStatus}`);

  if (jobStatus === 'FAILED') {
    return {
      ...input,
      status: 'FAILED',
      error: job?.FailureReason || 'Unknown transcription failure',
    };
  }

  if (jobStatus === 'COMPLETED') {
    return {
      ...input,
      status: 'COMPLETED',
      transcriptUri: job?.Transcript?.TranscriptFileUri,
    };
  }

  // Still in progress
  return {
    ...input,
    status: 'IN_PROGRESS',
  };
};
