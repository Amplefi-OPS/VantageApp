/**
 * GET /dictations/{dictation_id}?provider_id=...
 *
 * Returns a single dictation record with transcript text.
 *
 * Response:
 * {
 *   "dictation_id": "dict-abc123",
 *   "provider_id": "dr-smith-001",
 *   "patient_id": "pt-token-abc",
 *   "status": "DraftReady",
 *   "note_type": "progress_note",
 *   "audio_key": "dictations/dr-smith-001/2024-01-15/dict-abc123.m4a",
 *   "transcript_text": "Patient presents with...",
 *   "confidence": 0.95,
 *   "job_name": "vantage-dict-abc123",
 *   "task_id": "task-123",
 *   "appointment_id": "appt-456",
 *   "created_at": "2024-01-15T10:30:00Z",
 *   "updated_at": "2024-01-15T10:35:00Z"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getCallerIdentity, canAccessProvider } from '../shared/auth';
import { getItem } from '../shared/dynamo';
import { success, badRequest, forbidden, notFound, serverError } from '../shared/response';

const s3 = new S3Client({});
const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const dictationId = event.pathParameters?.dictation_id;
    if (!dictationId) return badRequest('Missing path parameter: dictation_id');

    const params = event.queryStringParameters || {};
    const providerId = params.provider_id || caller.providerId;

    if (!canAccessProvider(caller, providerId)) {
      return forbidden('Cannot access dictations for another provider');
    }

    const item = await getItem(`PROVIDER#${providerId}`, `DICT#${dictationId}`);
    if (!item) return notFound('Dictation not found');

    // If transcript is stored in S3, fetch it
    let transcriptText = item.transcriptText;
    if (!transcriptText && item.transcriptKey) {
      try {
        const obj = await s3.send(new GetObjectCommand({
          Bucket: TRANSCRIPT_BUCKET,
          Key: item.transcriptKey,
        }));
        transcriptText = await obj.Body?.transformToString('utf-8');
      } catch (s3Err) {
        console.error('Failed to fetch transcript from S3:', (s3Err as Error).message);
        transcriptText = null;
      }
    }

    return success({
      dictation_id: item.dictationId,
      provider_id: item.providerId,
      patient_id: item.patientId,
      status: item.status,
      note_type: item.noteType,
      audio_key: item.audioKey,
      transcript_key: item.transcriptKey,
      transcript_text: transcriptText,
      confidence: item.confidence,
      job_name: item.jobName,
      task_id: item.taskId,
      appointment_id: item.appointmentId,
      original_filename: item.originalFilename,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    });
  } catch (err) {
    console.error('Get dictation error:', (err as Error).message);
    return serverError('Failed to retrieve dictation');
  }
};
