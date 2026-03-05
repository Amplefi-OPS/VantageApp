/**
 * Step Functions State: Complete Voicemail Transcription
 *
 * Called when voicemail transcription job is COMPLETED or FAILED.
 * - Reads the transcript JSON from S3
 * - Extracts plain text and confidence score
 * - Matches patient names in transcript against DynamoDB patients
 * - Updates the voicemail record in DynamoDB
 *
 * Input:
 * {
 *   "jobName": "vantage-vm-abc123-...",
 *   "vmId": "vm-abc123",
 *   "providerId": "provider-001",
 *   "outputKey": "transcripts/.../vm-abc123.json",
 *   "status": "COMPLETED",
 *   "transcriptUri": "s3://..."
 * }
 */

import type { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  updateItem,
  buildUpdateExpression,
  queryItems,
  writeAuditLog,
} from '../shared/dynamo';
import { sendSlackAlert } from '../shared/slack';

const s3 = new S3Client({});
const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET!;

interface VmCompleteInput {
  jobName: string;
  vmId: string;
  providerId: string;
  outputKey: string;
  status: string;
  error?: string;
  transcriptUri?: string;
}

export const handler: Handler<VmCompleteInput> = async (input) => {
  const { vmId, providerId, outputKey, status, error } = input;
  const now = new Date().toISOString();

  if (status === 'FAILED') {
    console.error(`Voicemail transcription failed for ${vmId}: ${error}`);

    const failUpdates = buildUpdateExpression({
      transcriptStatus: 'Failed',
      failureReason: error,
      updatedAt: now,
    });

    if (failUpdates) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `VOICEMAIL#${vmId}` },
        ...failUpdates,
      });
    }

    await sendSlackAlert({
      level: 'error',
      title: 'Voicemail Transcription Failed',
      details: {
        'Voicemail ID': vmId,
        'Error': error || 'Unknown',
      },
      source: 'vm-complete-transcription',
    });

    await writeAuditLog({
      providerId,
      action: 'VM_TRANSCRIPTION_FAILED',
      entityType: 'Voicemail',
      entityId: vmId,
      details: { error },
    });

    return { vmId, status: 'Failed', error };
  }

  // ── COMPLETED: Read transcript from S3 ──
  console.log(`Reading voicemail transcript from s3://${TRANSCRIPT_BUCKET}/${outputKey}`);

  let transcriptText = '';
  let confidence = 0;

  try {
    const obj = await s3.send(new GetObjectCommand({
      Bucket: TRANSCRIPT_BUCKET,
      Key: outputKey,
    }));
    const raw = await obj.Body?.transformToString('utf-8');
    if (raw) {
      const transcriptData = JSON.parse(raw);
      const results = transcriptData.results;
      if (results?.transcripts?.length > 0) {
        transcriptText = results.transcripts[0].transcript;
      }
      // Calculate average confidence from items
      if (results?.items?.length > 0) {
        const confidences = results.items
          .filter((item: { alternatives?: { confidence?: string }[] }) =>
            item.alternatives?.[0]?.confidence,
          )
          .map((item: { alternatives: { confidence: string }[] }) =>
            parseFloat(item.alternatives[0].confidence),
          );
        if (confidences.length > 0) {
          confidence = confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
          confidence = Math.round(confidence * 100) / 100;
        }
      }
    }
  } catch (err) {
    console.error('Failed to read voicemail transcript:', err);
    transcriptText = '[Error reading transcript]';
  }

  // ── Patient matching: find names in transcript ──
  const suggestedPatientIds: string[] = [];

  try {
    const patientItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'PATIENT#',
      },
    });

    const transcriptLower = transcriptText.toLowerCase();

    for (const p of patientItems) {
      const firstName = (p.firstName as string || '').trim();
      const lastName = (p.lastName as string || '').trim();
      if (!firstName || !lastName) continue;

      const fullName = `${firstName} ${lastName}`.toLowerCase();
      if (transcriptLower.includes(fullName)) {
        suggestedPatientIds.push(p.patientId as string);
      }
    }

    if (suggestedPatientIds.length > 0) {
      console.log(`Found ${suggestedPatientIds.length} patient name matches in voicemail ${vmId}`);
    }
  } catch (err) {
    console.warn('Patient matching failed (non-fatal):', (err as Error).message);
  }

  // ── Update voicemail record ──
  const vmUpdates = buildUpdateExpression({
    transcriptStatus: 'Complete',
    transcript: transcriptText.slice(0, 4000),
    transcriptConfidence: confidence,
    suggestedPatientIds: suggestedPatientIds.length > 0 ? suggestedPatientIds : null,
    updatedAt: now,
  });

  if (vmUpdates) {
    await updateItem({
      Key: { PK: `PROVIDER#${providerId}`, SK: `VOICEMAIL#${vmId}` },
      ...vmUpdates,
    });
  }

  await writeAuditLog({
    providerId,
    action: 'VM_TRANSCRIPTION_COMPLETED',
    entityType: 'Voicemail',
    entityId: vmId,
    details: {
      confidence,
      transcriptLength: transcriptText.length,
      suggestedMatches: suggestedPatientIds.length,
    },
  });

  return {
    vmId,
    status: 'Complete',
    confidence,
    transcriptLength: transcriptText.length,
    suggestedMatches: suggestedPatientIds.length,
  };
};
