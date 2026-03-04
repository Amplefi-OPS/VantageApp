/**
 * POST /stripe/setup-intent
 *
 * Creates a Stripe SetupIntent (and optionally a new customer) for
 * collecting a card on file without charging it.
 *
 * Request body:
 * {
 *   "customerId": "cus_xxx",      // optional — omit to create a new customer
 *   "name": "Jane Doe",           // used when creating a new customer
 *   "email": "jane@example.com",  // used when creating a new customer
 *   "phone": "+15551234567"       // optional
 * }
 *
 * Returns:
 * {
 *   "clientSecret": "seti_xxx_secret_yyy",
 *   "customerId": "cus_xxx",
 *   "setupIntentId": "seti_xxx"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { success, badRequest, serverError, parseBody } from '../shared/response';
import { getSecrets } from '../shared/secrets';
import { sendSlackAlert } from '../shared/slack';

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripePost(path: string, body: Record<string, string>): Promise<unknown> {
  const { STRIPE_SECRET_KEY } = await getSecrets();
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

interface StripeCustomerResponse {
  id: string;
}

interface StripeSetupIntent {
  id: string;
  client_secret: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');
    let { customerId } = body;
    const { name, email, phone } = body;

    // Create a new Stripe customer if no customerId provided
    if (!customerId) {
      if (!name) {
        return badRequest('Either customerId or name is required');
      }
      const customerParams: Record<string, string> = { name };
      if (email) customerParams.email = email;
      if (phone) customerParams.phone = phone;

      const customer = (await stripePost('/customers', customerParams)) as StripeCustomerResponse;
      customerId = customer.id;
    } else {
      if (typeof customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(customerId)) {
        return badRequest('Invalid customerId format');
      }
    }

    // Create a SetupIntent for off-session card collection
    const si = (await stripePost('/setup_intents', {
      customer: customerId,
      usage: 'off_session',
      'automatic_payment_methods[enabled]': 'true',
    })) as StripeSetupIntent;

    return success({
      clientSecret: si.client_secret,
      customerId,
      setupIntentId: si.id,
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error('Stripe setup intent error:', message);
    await sendSlackAlert({
      level: 'error',
      title: 'SetupIntent Failed',
      details: { Error: message },
      source: 'stripe-setup-intent',
    });
    return serverError('Failed to create setup intent');
  }
};
