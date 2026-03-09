/**
 * POST /uploads/presign
 *
 * Generates a pre-signed S3 PUT URL for audio upload.
 * The iPhone or web portal uses this to upload directly to S3
 * without needing AWS credentials on the device.
 *
 * Request body:
 * {
 *   "provider_id": "dr-smith-001",
 *   "patient_id": "pt-token-abc",      // tokenized patient reference
 *   "task_id": "task-123",              // optional, links to existing task
 *   "note_type": "progress_note",       // progress_note | soap | hpi | discharge | other
 *   "appointment_id": "appt-456",       // optional
 *   "filename": "recording.m4a",
 *   "content_type": "audio/mp4",
 *   "idempotency_key": "uuid-here"      // for duplicate detection
 * }
 *
 * Response:
 * {
 *   "upload_url": "https://s3...presigned PUT URL",
 *   "object_key": "dictations/dr-smith-001/2024-01-15/abc123.m4a",
 *   "dictation_id": "dict-abc123",
 *   "expires_in": 900
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { getCallerIdentity, canAccessProvider } from '../shared/auth';
import { putItem, writeAuditLog } from '../shared/dynamo';
import { success, badRequest, forbidden, serverError, parseBody } from '../shared/response';

const s3 = new S3Client({});
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN!;
const PRESIGN_EXPIRY = parseInt(process.env.PRESIGN_EXPIRY_SECONDS || '900', 10);
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '100', 10) * 1024 * 1024;

const ACCEPTED_TYPES = new Set([
  'audio/mp4',       // .m4a
  'audio/mpeg',      // .mp3
  'video/mp4',       // .mp4 with audio
  'audio/wav',       // .wav
  'audio/x-wav',
  'audio/flac',      // .flac
  'audio/x-flac',
  'audio/webm',      // .webm (MediaRecorder default on Chrome)
  'audio/ogg',       // .ogg (MediaRecorder fallback)
]);

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const {
      provider_id,
      patient_id,
      task_id,
      note_type = 'progress_note',
      appointment_id,
      filename,
      content_type,
      idempotency_key,
    } = body;

    // Validate required fields
    if (!provider_id || !filename || !content_type) {
      return badRequest('Missing required fields: provider_id, filename, content_type');
    }

    // Authorization: provider can only upload for themselves
    if (!canAccessProvider(caller, provider_id)) {
      return forbidden('Cannot upload for another provider');
    }

    // Validate content type
    if (!ACCEPTED_TYPES.has(content_type)) {
      return badRequest(`Unsupported content type: ${content_type}. Accepted: ${[...ACCEPTED_TYPES].join(', ')}`);
    }

    // Generate object key
    // Pattern: dictations/{provider_id}/{date}/{dictation_id}.{ext}
    const dictationId = `dict-${randomUUID().slice(0, 12)}`;
    const date = new Date().toISOString().slice(0, 10);
    const ext = filename.split('.').pop() || 'm4a';
    const objectKey = `dictations/${provider_id}/${date}/${dictationId}.${ext}`;

    // Generate pre-signed PUT URL
    // NOTE: Only include ContentType — omit Metadata and SSE headers so the
    // browser can PUT with just Content-Type. S3 bucket default encryption
    // handles KMS. All metadata is stored in DynamoDB instead.
    const command = new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: objectKey,
      ContentType: content_type as string,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGN_EXPIRY,
    });

    // Create dictation record in DynamoDB with "Uploading" status
    const now = new Date().toISOString();
    await putItem({
      PK: `PROVIDER#${provider_id}`,
      SK: `DICT#${dictationId}`,
      dictationId,
      providerId: provider_id,
      patientId: patient_id || null,
      taskId: task_id || null,
      appointmentId: appointment_id || null,
      noteType: note_type,
      status: 'Uploading',
      audioKey: objectKey,
      transcriptKey: null,
      transcriptText: null,
      confidence: null,
      jobName: null,
      originalFilename: filename,
      contentType: content_type,
      idempotencyKey: idempotency_key || null,
      createdAt: now,
      updatedAt: now,
      // GSI1: Query dictations by status
      GSI1PK: `PROVIDER#${provider_id}`,
      GSI1SK: `DICTSTATUS#Uploading#${now}`,
      // GSI2: Query all dictations by date
      GSI2PK: `DICTATION`,
      GSI2SK: `${date}#${dictationId}`,
      entityType: 'Dictation',
    });

    await writeAuditLog({
      providerId: provider_id,
      action: 'PRESIGN_UPLOAD',
      entityType: 'Dictation',
      entityId: dictationId,
      details: { objectKey, noteType: note_type },
    });

    return success({
      upload_url: uploadUrl,
      object_key: objectKey,
      dictation_id: dictationId,
      expires_in: PRESIGN_EXPIRY,
    });
  } catch (err) {
    console.error('Presign upload error:', (err as Error).message);
    return serverError('Failed to generate upload URL');
  }
};
