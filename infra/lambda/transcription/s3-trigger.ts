/**
 * S3 Event -> Lambda Trigger
 *
 * When an audio file lands in s3://audio-bucket/dictations/...,
 * this function starts the Step Functions transcription pipeline.
 *
 * It reads the object metadata to determine provider_id, dictation_id, etc.
 */

import type { S3Event, Handler } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

export const handler: Handler<S3Event> = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;

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
      eventTime: record.eventTime,
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
