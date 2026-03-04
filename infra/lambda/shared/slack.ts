/**
 * Shared Slack webhook utility.
 *
 * Sends alerts to a Slack channel via an incoming webhook.
 * **Never throws** — Slack failure must never break a billing operation.
 */

import { getSecrets } from './secrets';

export interface SlackAlert {
  level: 'error' | 'warning' | 'info';
  title: string;
  details: Record<string, string>;
  source: string;
}

const LEVEL_EMOJI: Record<SlackAlert['level'], string> = {
  error: ':red_circle:',
  warning: ':large_yellow_circle:',
  info: ':large_blue_circle:',
};

export async function sendSlackAlert(alert: SlackAlert): Promise<void> {
  try {
    const secrets = await getSecrets();
    const webhookUrl = secrets.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return; // Slack not configured — skip silently

    const stage = process.env.STAGE || 'unknown';
    const fields = Object.entries(alert.details).map(([key, value]) => ({
      type: 'mrkdwn' as const,
      text: `*${key}:*\n${value}`,
    }));

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${LEVEL_EMOJI[alert.level]} ${alert.title}` },
      },
      {
        type: 'section',
        fields,
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Source:* ${alert.source} | *Stage:* ${stage} | *Time:* ${new Date().toISOString()}`,
          },
        ],
      },
    ];

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
  } catch {
    // Never throw — Slack failure must not break billing operations
    console.warn('Slack alert failed (non-fatal):', alert.title);
  }
}
