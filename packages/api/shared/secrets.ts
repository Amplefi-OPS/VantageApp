/**
 * Secrets Manager helper for Lambda functions.
 *
 * Fetches credentials from AWS Secrets Manager at cold start and caches them
 * in-memory for the lifetime of the Lambda execution environment.
 *
 * Usage:
 *   const secrets = await getSecrets();
 *   const stripeKey = secrets.STRIPE_SECRET_KEY;
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export interface AppSecrets {
  STRIPE_SECRET_KEY: string;
  ZOOM_ACCOUNT_ID: string;
  ZOOM_CLIENT_ID: string;
  ZOOM_CLIENT_SECRET: string;
  ZOOM_USER_EMAIL: string;
  ZOOM_AUTO_RECEPTIONIST_IDS: string;
  ZOOM_FAX_EXTENSION_ID: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
  GOOGLE_CALENDAR_IDS?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_USER_EMAIL?: string;
  GMAIL_LABEL_ID?: string;
  GMAIL_PROCESSED_LABEL_ID?: string;
  STAFF_EMAILS_JSON?: string;
  SLACK_WEBHOOK_URL?: string;
}

const SECRET_NAME = process.env.SECRET_NAME || 'vantage/credentials/dev';

let cached: AppSecrets | null = null;

const client = new SecretsManagerClient({});

/**
 * Fetch and cache secrets. Safe to call on every invocation —
 * only hits Secrets Manager on cold start.
 */
export async function getSecrets(): Promise<AppSecrets> {
  if (cached) return cached;

  const result = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );

  if (!result.SecretString) {
    throw new Error(`Secret ${SECRET_NAME} has no string value`);
  }

  const parsed = JSON.parse(result.SecretString);
  // Validate required fields are present
  const required: (keyof AppSecrets)[] = [
    'STRIPE_SECRET_KEY', 'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID',
    'ZOOM_CLIENT_SECRET', 'ZOOM_USER_EMAIL', 'ZOOM_AUTO_RECEPTIONIST_IDS',
    'ZOOM_FAX_EXTENSION_ID',
  ];
  const missing = required.filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(`Secret ${SECRET_NAME} is missing required fields: ${missing.join(', ')}`);
  }
  cached = parsed as AppSecrets;
  return cached;
}
