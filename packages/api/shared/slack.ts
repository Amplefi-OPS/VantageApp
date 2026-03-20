/**
 * Slack Notification Helper
 *
 * Sends formatted alerts to a Slack channel via incoming webhook.
 * Non-throwing — Slack failures never break app functionality.
 */

import { getSecrets } from './secrets';

export type AlertLevel = 'critical' | 'warning' | 'info';

const LEVEL_COLORS: Record<AlertLevel, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#22c55e',
};

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  critical: ':rotating_light:',
  warning: ':warning:',
  info: ':white_check_mark:',
};

interface SlackField {
  label: string;
  value: string;
}

/**
 * Send a formatted alert to Slack. Never throws.
 *
 * @param title   - Alert headline (e.g., "Failed Login Attempt")
 * @param level   - critical | warning | info
 * @param fields  - Key-value pairs shown in the message body
 */
export async function sendSlackAlert(
  title: string,
  level: AlertLevel,
  fields: SlackField[],
): Promise<void> {
  try {
    const secrets = await getSecrets();
    const webhookUrl = secrets.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
      console.warn('SLACK_WEBHOOK_URL not configured — skipping alert');
      return;
    }

    const env = process.env.STAGE || 'dev';
    const timestamp = new Date().toISOString();
    const fieldLines = fields.map((f) => `*${f.label}:* ${f.value}`).join('\n');

    const payload = {
      attachments: [
        {
          color: LEVEL_COLORS[level],
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${LEVEL_EMOJI[level]} *${title}*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: fieldLines || '_No details_',
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `*Environment:* ${env} | *Time:* ${timestamp}`,
                },
              ],
            },
          ],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Slack webhook failed (HTTP ${response.status})`);
    }
  } catch (err) {
    console.error('Slack alert failed (non-fatal):', (err as Error).message);
  }
}
