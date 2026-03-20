/**
 * GET /transcription/upload-url?format=webm
 *
 * Generates a presigned S3 PutObject URL for uploading audio files
 * for transcription (dictation or voicemail).
 *
 * Returns: { uploadUrl: string, s3Key: string }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../../shared/auth';
import { success, badRequest, serverError } from '../../shared/response';

const s3 = new S3Client({});
const AUDIO_BUCKET_NAME = process.env.AUDIO_BUCKET_NAME!;

const VALID_FORMATS = new Set(['wav', 'mp4', 'webm', 'ogg']);

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  wav: 'audio/wav',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    const format = event.queryStringParameters?.format;
    if (!format || !VALID_FORMATS.has(format)) {
      return badRequest(`Invalid format. Must be one of: ${[...VALID_FORMATS].join(', ')}`);
    }

    const id = randomUUID();
    const s3Key = `audio/dictation/${id}.${format}`;

    const command = new PutObjectCommand({
      Bucket: AUDIO_BUCKET_NAME,
      Key: s3Key,
      ContentType: FORMAT_CONTENT_TYPE[format],
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return success({ uploadUrl, s3Key });
  } catch (err) {
    console.error('Get upload URL error:', (err as Error).message);
    return serverError('Failed to generate upload URL');
  }
};
