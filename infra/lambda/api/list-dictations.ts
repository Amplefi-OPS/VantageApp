/**
 * GET /dictations?patient_id=...
 *
 * Returns dictations for the authenticated provider.
 * Optionally filter by patient_id.
 * Includes presigned audio URLs for playback.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { queryItems } from '../shared/dynamo';
import { success, serverError, setRequestOrigin } from '../shared/response';

const s3 = new S3Client({});
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;
const PRESIGN_EXPIRY = 900; // 15 minutes

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);
    const params = event.queryStringParameters || {};
    const patientId = params.patient_id;

    // Query all dictations across all providers via GSI2
    const items = await queryItems({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'DICTATION',
      },
    });

    // Filter by patient_id if specified
    let filtered = items;
    if (patientId) {
      filtered = items.filter((i) => i.patientId === patientId);
    }

    // Sort newest first
    filtered.sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );

    // Generate presigned audio URLs
    const dictations = await Promise.all(
      filtered.map(async (item) => {
        let audioUrl: string | null = null;
        if (item.audioKey) {
          try {
            audioUrl = await getSignedUrl(
              s3,
              new GetObjectCommand({
                Bucket: AUDIO_BUCKET,
                Key: item.audioKey as string,
              }),
              { expiresIn: PRESIGN_EXPIRY },
            );
          } catch (err) {
            console.warn(`Failed to presign audio for ${item.dictationId}:`, (err as Error).message);
          }
        }

        return {
          dictation_id: item.dictationId,
          provider_id: item.providerId,
          patient_id: item.patientId,
          status: item.status,
          note_type: item.noteType,
          transcript_text: item.transcriptText,
          confidence: item.confidence,
          audio_url: audioUrl,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
        };
      }),
    );

    return success({ dictations, count: dictations.length });
  } catch (err) {
    console.error('List dictations error:', (err as Error).message);
    return serverError('Failed to list dictations');
  }
};
