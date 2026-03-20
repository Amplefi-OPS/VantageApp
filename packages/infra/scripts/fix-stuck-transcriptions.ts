#!/usr/bin/env npx tsx
/**
 * One-time cleanup: Reset stuck "Transcribing" voicemail records to "Pending"
 * so they re-enter the transcription pipeline on next trigger.
 *
 * Usage:
 *   npx tsx infra/scripts/fix-stuck-transcriptions.ts
 *
 * Requires AWS credentials with DynamoDB read/write on vantage-dev table.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'vantage-dev';
const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function main() {
  console.log(`Scanning ${TABLE_NAME} for stuck voicemails (transcriptStatus = "Transcribing")...\n`);

  const result = await ddb.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'entityType = :et AND transcriptStatus = :ts',
    ExpressionAttributeValues: {
      ':et': 'VoicemailAttachment',
      ':ts': 'Transcribing',
    },
  }));

  const items = result.Items || [];
  console.log(`Found ${items.length} stuck voicemail(s).\n`);

  if (items.length === 0) {
    console.log('Nothing to fix.');
    return;
  }

  for (const item of items) {
    const pk = item.PK as string;
    const sk = item.SK as string;
    const vmId = item.voicemailId as string;
    const caller = item.callerName || item.callerNumber || 'Unknown';

    console.log(`  Resetting ${vmId} (${caller}) from "Transcribing" → "Pending"`);

    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'SET transcriptStatus = :status, updatedAt = :now REMOVE jobName, transcriptKey, failureReason',
      ExpressionAttributeValues: {
        ':status': 'Pending',
        ':now': new Date().toISOString(),
      },
    }));
  }

  console.log(`\nDone. Reset ${items.length} voicemail(s) to "Pending".`);
  console.log('They will be transcribed on the next S3 trigger or page load.');
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
