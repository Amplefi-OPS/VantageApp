/**
 * POST /stripe/confirm-setup
 *
 * After a SetupIntent succeeds client-side, this Lambda attaches the
 * payment method to the customer and sets it as the default for invoices.
 *
 * Request body:
 * {
 *   "customerId": "cus_xxx",
 *   "paymentMethodId": "pm_xxx"
 * }
 *
 * Returns:
 * {
 *   "customerId": "cus_xxx",
 *   "paymentMethod": { "id": "pm_xxx", "brand": "visa", "last4": "4242", "expMonth": 12, "expYear": 2026 }
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { success, badRequest, serverError, parseBody } from '../../shared/response';
import { getSecrets } from '../../shared/secrets';
import { sendSlackAlert } from '../../shared/slack';

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

async function stripeGet(path: string): Promise<unknown> {
  const { STRIPE_SECRET_KEY } = await getSecrets();
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Stripe API error (${res.status})`);
  }
  return res.json();
}

interface StripePaymentMethod {
  id: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');
    const { customerId, paymentMethodId } = body;

    if (!customerId || !paymentMethodId) {
      return badRequest('Missing required fields: customerId, paymentMethodId');
    }

    if (typeof customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(customerId)) {
      return badRequest('Invalid customerId format');
    }
    if (typeof paymentMethodId !== 'string' || !/^pm_[A-Za-z0-9]+$/.test(paymentMethodId)) {
      return badRequest('Invalid paymentMethodId format');
    }

    // Attach payment method to customer
    await stripePost(`/payment_methods/${paymentMethodId}/attach`, {
      customer: customerId,
    });

    // Set as default payment method for invoices / off-session charges
    await stripePost(`/customers/${customerId}`, {
      'invoice_settings[default_payment_method]': paymentMethodId,
    });

    // Fetch payment method details to return to the client
    const pm = (await stripeGet(`/payment_methods/${paymentMethodId}`)) as StripePaymentMethod;

    return success({
      customerId,
      paymentMethod: {
        id: pm.id,
        brand: pm.card?.brand || 'unknown',
        last4: pm.card?.last4 || '????',
        expMonth: pm.card?.exp_month || 0,
        expYear: pm.card?.exp_year || 0,
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error('Stripe confirm setup error:', message);
    await sendSlackAlert('Card Setup Failed', 'critical', [
      { label: 'Error', value: message },
      { label: 'Source', value: 'stripe-confirm-setup' },
    ]);
    return serverError('Failed to confirm card setup');
  }
};
