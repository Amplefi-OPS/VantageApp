/**
 * DLQ Alert Lambda
 *
 * Triggered when messages land in the billing dead-letter queue
 * (after all retries are exhausted). Sends a critical Slack alert
 * so the team can investigate immediately.
 */

import type { SQSHandler } from 'aws-lambda';
import { sendSlackAlert } from '../../shared/slack';

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    let detail = 'Unable to parse event body';
    try {
      const body = JSON.parse(record.body);
      // EventBridge wraps the event — extract detail
      const eventDetail = body.detail || body;
      detail = JSON.stringify(eventDetail, null, 2).slice(0, 500);
    } catch {
      detail = record.body.slice(0, 500);
    }

    await sendSlackAlert('Billing Event Failed — DLQ', 'critical', [
      { label: 'Queue', value: record.eventSourceARN?.split(':').pop() || 'unknown' },
      { label: 'Message ID', value: record.messageId },
      { label: 'Details', value: `\`\`\`${detail}\`\`\`` },
      { label: 'Retry Count', value: String(record.attributes?.ApproximateReceiveCount || '?') },
    ]);
  }
};
