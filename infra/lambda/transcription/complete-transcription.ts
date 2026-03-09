/**
 * Step Functions State: Complete Transcription
 *
 * Called when transcription job is COMPLETED or FAILED.
 * - Reads the transcript JSON from S3
 * - Extracts plain text and confidence score
 * - Updates the dictation record in DynamoDB
 * - Updates or creates the linked task (status -> DraftReady or TranscriptionFailed)
 *
 * Input:
 * {
 *   "jobName": "vantage-dict-abc123-...",
 *   "dictationId": "dict-abc123",
 *   "providerId": "dr-smith-001",
 *   "date": "2024-01-15",
 *   "outputKey": "transcripts/.../dict-abc123.json",
 *   "status": "COMPLETED",
 *   "transcriptUri": "s3://..."
 * }
 */

import type { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import {
  getItem,
  putItem,
  updateItem,
  buildUpdateExpression,
  writeAuditLog,
} from '../shared/dynamo';

const s3 = new S3Client({});
const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET!;

interface CompleteInput {
  jobName: string;
  dictationId: string;
  providerId: string;
  date: string;
  outputKey: string;
  status: string;
  error?: string;
  transcriptUri?: string;
}

export const handler: Handler<CompleteInput> = async (input) => {
  const { dictationId, providerId, outputKey, status, error } = input;
  const now = new Date().toISOString();

  // Get the existing dictation record
  const dictation = await getItem(`PROVIDER#${providerId}`, `DICT#${dictationId}`);

  if (status === 'FAILED') {
    console.error(`Transcription failed for ${dictationId}: ${error}`);

    // Update dictation status
    const failUpdates = buildUpdateExpression({
      status: 'TranscriptionFailed',
      failureReason: error,
      updatedAt: now,
      GSI1SK: `DICTSTATUS#TranscriptionFailed#${now}`,
    });

    if (failUpdates) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `DICT#${dictationId}` },
        ...failUpdates,
      });
    }

    // Update linked task if exists
    if (dictation?.taskId) {
      const taskUpdates = buildUpdateExpression({
        status: 'TranscriptionFailed',
        notes: `Transcription failed: ${error}`,
        updatedAt: now,
        GSI1SK: `TASKSTATUS#TranscriptionFailed#${now}`,
      });
      if (taskUpdates) {
        await updateItem({
          Key: { PK: `PROVIDER#${providerId}`, SK: `TASK#${dictation.taskId}` },
          ...taskUpdates,
        });
      }
    }

    await writeAuditLog({
      providerId,
      action: 'TRANSCRIPTION_FAILED',
      entityType: 'Dictation',
      entityId: dictationId,
      details: { error },
    });

    return { dictationId, status: 'TranscriptionFailed', error };
  }

  // ── COMPLETED: Read transcript from S3 ──
  console.log(`Reading transcript from s3://${TRANSCRIPT_BUCKET}/${outputKey}`);

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
      // AWS Transcribe Medical output format
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
    console.error('Failed to read transcript:', err);
    transcriptText = '[Error reading transcript]';
  }

  // Update dictation record
  const dictUpdates = buildUpdateExpression({
    status: 'DraftReady',
    transcriptText: transcriptText.slice(0, 4000), // Store preview in DynamoDB (full in S3)
    confidence,
    updatedAt: now,
    GSI1SK: `DICTSTATUS#DraftReady#${now}`,
  });

  if (dictUpdates) {
    await updateItem({
      Key: { PK: `PROVIDER#${providerId}`, SK: `DICT#${dictationId}` },
      ...dictUpdates,
    });
  }

  // Update or create linked task
  const taskId = dictation?.taskId;
  if (taskId) {
    const taskUpdates = buildUpdateExpression({
      status: 'DraftReady',
      notes: `Transcript ready (confidence: ${(confidence * 100).toFixed(1)}%)`,
      updatedAt: now,
      GSI1SK: `TASKSTATUS#DraftReady#${now}`,
    });
    if (taskUpdates) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `TASK#${taskId}` },
        ...taskUpdates,
      });
    }
  } else {
    // Create a new task for this dictation
    const newTaskId = `task-${randomUUID().slice(0, 12)}`;
    await putItem({
      PK: `PROVIDER#${providerId}`,
      SK: `TASK#${newTaskId}`,
      taskId: newTaskId,
      providerId,
      patientId: dictation?.patientId || null,
      type: 'Dictation',
      title: `Review dictation: ${dictation?.noteType || 'note'}`,
      status: 'DraftReady',
      priority: 'Med',
      dueDate: null,
      assignedTo: null,
      notes: `Transcript ready (confidence: ${(confidence * 100).toFixed(1)}%)`,
      dictationId,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${providerId}`,
      GSI1SK: `TASKSTATUS#DraftReady#${now}`,
      GSI2PK: 'TASK',
      GSI2SK: `${now}#${newTaskId}`,
      entityType: 'Task',
    });

    // Link task back to dictation
    const linkUpdate = buildUpdateExpression({ taskId: newTaskId });
    if (linkUpdate) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `DICT#${dictationId}` },
        ...linkUpdate,
      });
    }
  }

  // ── Auto-create Note for the patient if linked ──
  const patientId = dictation?.patientId;
  if (patientId && transcriptText && transcriptText !== '[Error reading transcript]') {
    try {
      const noteId = `note-${randomUUID().slice(0, 12)}`;
      const dictDate = new Date(dictation?.createdAt || now);
      const noteTitle = `Dictation — ${dictDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${dictDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

      await putItem({
        PK: `PATIENT#${patientId}`,
        SK: `NOTE#${now}#${noteId}`,
        noteId,
        patientId,
        title: noteTitle,
        body: transcriptText,
        createdAt: now,
        createdBy: 'aws-transcribe',
        GSI1PK: `PROVIDER#${providerId}`,
        GSI1SK: `NOTE#${now}#${noteId}`,
        entityType: 'Note',
      });
      console.log(`Auto-created note ${noteId} for patient ${patientId} from dictation ${dictationId}`);
    } catch (err) {
      console.warn('Failed to auto-create note from dictation:', (err as Error).message);
    }
  }

  await writeAuditLog({
    providerId,
    action: 'TRANSCRIPTION_COMPLETED',
    entityType: 'Dictation',
    entityId: dictationId,
    details: {
      confidence,
      transcriptLength: transcriptText.length,
      taskId: taskId || 'auto-created',
    },
  });

  return {
    dictationId,
    status: 'DraftReady',
    confidence,
    transcriptLength: transcriptText.length,
  };
};
