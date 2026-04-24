/**
 * Transactional email helper (SES). Non-throwing — a failed notification
 * must never break the primary write.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getSecrets } from './secrets';

const ses = new SESClient({ region: 'us-east-1' });
const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'noreply@vantagerefinery.com';

export async function sendNotification(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: params.text, Charset: 'UTF-8' } },
      },
    }));
  } catch (err) {
    console.error('[email-notifier] send failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Resolve a staff display name (e.g. "Lori") to an email address using the
 * STAFF_EMAILS_JSON secret. Returns null if no mapping — caller should skip.
 */
export async function resolveStaffEmail(displayName: string | null | undefined): Promise<string | null> {
  if (!displayName) return null;
  // Already an email
  if (displayName.includes('@')) return displayName;
  try {
    const secrets = await getSecrets();
    if (!secrets.STAFF_EMAILS_JSON) return null;
    const map = JSON.parse(secrets.STAFF_EMAILS_JSON) as Record<string, string>;
    return map[displayName] || null;
  } catch (err) {
    console.error('[email-notifier] STAFF_EMAILS_JSON parse failed:', (err as Error).message);
    return null;
  }
}

/** Build the public app URL for deep links (e.g. to a specific todo). */
export function appUrl(path: string): string {
  const base = process.env.APP_BASE_URL || 'https://providerdev.vantagerefinery.com';
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}
