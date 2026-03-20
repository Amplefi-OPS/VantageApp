/**
 * S3 Event -> Lambda Trigger
 *
 * When an audio file lands in s3://audio-bucket/dictations/...,
 * this function starts the Step Functions transcription pipeline.
 *
 * It reads the object metadata to determine provider_id, dictation_id, etc.
 */

import type { Handler } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

/**
 * Handles both EventBridge S3 events and direct S3 notification events.
 * EventBridge format: { detail: { bucket: { name }, object: { key, size } } }
 * S3 notification:    { Records: [{ s3: { bucket: { name }, object: { key, size } } }] }
 */
export const handler: Handler = async (event) => {
  // Normalize: extract bucket/key/size from either event format
  const uploads: { bucket: string; key: string; size: number; eventTime: string }[] = [];

  if (event.detail?.bucket && event.detail?.object) {
    // EventBridge format
    uploads.push({
      bucket: event.detail.bucket.name,
      key: decodeURIComponent(event.detail.object.key.replace(/\+/g, ' ')),
      size: event.detail.object.size || 0,
      eventTime: event.time || new Date().toISOString(),
    });
  } else if (event.Records) {
    // S3 notification format
    for (const record of event.Records) {
      uploads.push({
        bucket: record.s3.bucket.name,
        key: decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
        size: record.s3.object.size || 0,
        eventTime: record.eventTime || new Date().toISOString(),
      });
    }
  } else {
    console.error('Unknown event format:', JSON.stringify(event).slice(0, 500));
    return;
  }

  for (const upload of uploads) {
    const { bucket, key, size, eventTime } = upload;
    console.log(`New audio uploaded: s3://${bucket}/${key} (${size} bytes)`);

    // Extract metadata from key pattern: dictations/{provider_id}/{date}/{dictation_id}.{ext}
    const parts = key.split('/');
    if (parts.length < 4 || parts[0] !== 'dictations') {
      console.log('Skipping non-dictation object:', key);
      continue;
    }

    const providerId = parts[1];
    const date = parts[2];
    const filename = parts[3];
    const dictationId = filename.split('.')[0]; // dict-abc123

    const input = {
      bucket,
      key,
      providerId,
      date,
      dictationId,
      size,
      eventTime,
    };

    const executionName = `${dictationId}-${Date.now()}`;

    await sfn.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify(input),
    }));

    console.log(`Started transcription pipeline: ${executionName}`);
  }
};
