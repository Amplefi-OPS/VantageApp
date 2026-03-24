/**
 * Stripe API helpers.
 *
 * Fetches the Stripe secret key from Secrets Manager (cached in-memory).
 * Provides typed GET/POST wrappers for the Stripe REST API.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
const STRIPE_SECRET_NAME = process.env.STRIPE_SECRET_NAME || 'vantage/stripe/secret-key';
const STRIPE_BASE = 'https://api.stripe.com/v1';

let cachedKey: string | null = null;

export async function getStripeKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const result = await sm.send(
    new GetSecretValueCommand({ SecretId: STRIPE_SECRET_NAME }),
  );

  const raw = result.SecretString;
  if (!raw) throw new Error(`Secret ${STRIPE_SECRET_NAME} has no string value`);

  // The secret may be a plain key string or a JSON object with a "key" field
  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    cachedKey = parsed.key || parsed.STRIPE_SECRET_KEY || parsed.secret_key;
  } else {
    cachedKey = raw.trim();
  }

  if (!cachedKey) throw new Error('Stripe secret key is empty');
  return cachedKey;
}

export async function stripeGet<T = unknown>(path: string): Promise<{ data: T; ok: boolean; status: number }> {
  const key = await getStripeKey();
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = (await res.json()) as T;
  return { data, ok: res.ok, status: res.status };
}

export async function stripePost<T = unknown>(
  path: string,
  params: Record<string, string>,
): Promise<{ data: T; ok: boolean; status: number }> {
  const key = await getStripeKey();
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json()) as T;
  return { data, ok: res.ok, status: res.status };
}
