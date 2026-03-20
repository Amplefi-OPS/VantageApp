/**
 * S3 Event -> Lambda Trigger (Voicemails)
 *
 * When an audio file lands in s3://audio-bucket/voicemails/...,
 * this function starts the Step Functions voicemail transcription pipeline.
 *
 * Wired via EventBridge (not raw S3 notifications), so event format is
 * EventBridge S3 Object Created, NOT S3Event.
 */

import type { Handler } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

interface EventBridgeS3Event {
  detail: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
  time: string;
}

export const handler: Handler<EventBridgeS3Event> = async (event) => {
  const bucket = event.detail.bucket.name;
  const key = decodeURIComponent(event.detail.object.key.replace(/\+/g, ' '));
  const size = event.detail.object.size;

  console.log(`New voicemail audio uploaded: s3://${bucket}/${key} (${size} bytes)`);

  // Extract metadata from key pattern: voicemails/{providerId}/{vmId}.mp3
  const parts = key.split('/');
  if (parts.length < 3 || parts[0] !== 'voicemails') {
    console.log('Skipping non-voicemail object:', key);
    return;
  }

  const providerId = parts[1];
  const filename = parts[2];
  const vmId = filename.split('.')[0];

  const input = {
    bucket,
    key,
    providerId,
    vmId,
    size,
    eventTime: event.time,
  };

  const executionName = `vm-${vmId}-${Date.now()}`;

  await sfn.send(new StartExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    name: executionName,
    input: JSON.stringify(input),
  }));

  console.log(`Started voicemail transcription pipeline: ${executionName}`);
};
