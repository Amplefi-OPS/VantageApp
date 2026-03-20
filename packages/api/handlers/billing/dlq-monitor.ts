/**
 * Scheduled Lambda — DLQ Monitor
 *
 * Runs every 5 minutes via CloudWatch Events. Checks the billing DLQ
 * for pending messages and sends a Slack alert if any are found.
 */

import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { sendSlackAlert } from '../../shared/slack';

const sqsClient = new SQSClient({});
const DLQ_URL = process.env.DLQ_URL || '';

export const handler = async (): Promise<void> => {
  try {
    const result = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: DLQ_URL,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );

    const count = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);

    if (count > 0) {
      await sendSlackAlert('Billing DLQ Has Messages', 'warning', [
        { label: 'Message Count', value: String(count) },
        { label: 'Queue URL', value: DLQ_URL },
      ]);
    }
  } catch (err) {
    console.error('DLQ monitor error:', (err as Error).message);
    await sendSlackAlert('DLQ Monitor Failed', 'critical', [
      { label: 'Error', value: (err as Error).message },
    ]);
  }
};
