/**
 * POST /stripe/charge-no-show
 *
 * Charges a flat $30 no-show fee to a customer's default payment method.
 *
 * Request body:
 * {
 *   "customerId": "cus_xxx",
 *   "reason": "Patient did not show up"   // optional
 * }
 *
 * Returns:
 * {
 *   "id": "pi_xxx",
 *   "status": "succeeded",
 *   "amount": 3000,
 *   "created": 1709000000
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { success, badRequest, serverError } from '../shared/response';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const STRIPE_BASE = 'https://api.stripe.com/v1';
const NO_SHOW_FEE_CENTS = 3000; // $30.00

async function stripePost(path: string, body: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as Record<string, string> | undefined;
    throw new Error(err?.message || `Stripe error (${res.status})`);
  }
  return data;
}

async function stripeGet(path: string): Promise<unknown> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe API error (${res.status}): ${text}`);
  }
  return res.json();
}

interface StripeCustomer {
  invoice_settings?: { default_payment_method?: string | null };
}

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  created: number;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    const body = JSON.parse(event.body || '{}');
    const { customerId, reason } = body;

    if (!customerId) {
      return badRequest('Missing required field: customerId');
    }

    // Look up customer's default payment method
    const customer = (await stripeGet(`/customers/${customerId}`)) as StripeCustomer;
    const defaultPm = customer.invoice_settings?.default_payment_method;

    if (!defaultPm) {
      return badRequest('Customer has no default payment method on file');
    }

    const params: Record<string, string> = {
      amount: String(NO_SHOW_FEE_CENTS),
      currency: 'usd',
      customer: customerId,
      payment_method: defaultPm,
      confirm: 'true',
      off_session: 'true',
      description: 'No-Show Fee',
      'metadata[type]': 'no-show',
    };

    if (reason) {
      params['metadata[reason]'] = reason;
    }

    const pi = (await stripePost('/payment_intents', params)) as StripePaymentIntent;

    return success({
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      created: pi.created,
    });
  } catch (err) {
    console.error('Stripe no-show charge error:', err);
    const message = err instanceof Error ? err.message : 'Failed to charge no-show fee';
    return serverError(message);
  }
};
