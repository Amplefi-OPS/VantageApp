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
  idempotencyKey?: string,
): Promise<{ data: T; ok: boolean; status: number }> {
  const key = await getStripeKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Stripe dedupes retried POSTs that carry the same Idempotency-Key —
  // this is what prevents a replayed billing event from double-charging.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json()) as T;
  return { data, ok: res.ok, status: res.status };
}

interface StripeCustomerSearchItem {
  id: string;
  email?: string | null;
  invoice_settings?: { default_payment_method?: string | null };
}

export interface ChargeResult {
  success: boolean;
  reason?: 'no_customer' | 'no_payment_method' | 'charge_failed';
  error?: string;
  paymentIntentId?: string;
}

/**
 * Look up a Stripe customer by email, then charge their default payment method.
 * Returns a result object — never throws. Caller decides what to do on failure.
 */
export async function chargeCustomerByEmail(
  email: string,
  amountCents: number,
  description: string,
): Promise<ChargeResult> {
  try {
    const q = `email:'${email.replace(/'/g, "\\'")}'`;
    const search = await stripeGet<{ data: StripeCustomerSearchItem[] }>(
      `/customers/search?query=${encodeURIComponent(q)}&limit=1`,
    );
    if (!search.ok || !search.data.data?.length) {
      return { success: false, reason: 'no_customer' };
    }
    const customer = search.data.data[0];
    const pmId = customer.invoice_settings?.default_payment_method;
    if (!pmId) {
      return { success: false, reason: 'no_payment_method' };
    }

    const params: Record<string, string> = {
      amount: String(amountCents),
      currency: 'usd',
      customer: customer.id,
      payment_method: pmId,
      confirm: 'true',
      off_session: 'true',
      description,
    };
    if (customer.email) params.receipt_email = customer.email;

    const pi = await stripePost<{ id?: string; error?: { message: string } }>(
      '/payment_intents',
      params,
    );
    if (!pi.ok) {
      return { success: false, reason: 'charge_failed', error: pi.data.error?.message || 'Stripe error' };
    }
    return { success: true, paymentIntentId: pi.data.id };
  } catch (err) {
    return { success: false, reason: 'charge_failed', error: (err as Error).message };
  }
}
