/**
 * POST /billing/no-show
 *
 * Charges a flat $30 no-show / late cancellation fee to a patient's
 * default payment method via Stripe.
 *
 * Body: { customerId }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, serverError, parseBody } from '../../shared/response';
import { stripeGet, stripePost } from '../../shared/stripe';

const NO_SHOW_FEE_CENTS = 3000;

interface StripeCustomer {
  id: string;
  invoice_settings?: { default_payment_method?: string | null };
}

interface StripePaymentMethod {
  id: string;
}

interface StripePaymentMethodList {
  data: StripePaymentMethod[];
}

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const customerId = body.customerId as string | undefined;
    if (!customerId) return badRequest('Missing required field: customerId');

    // 1. Get customer's default payment method
    const custRes = await stripeGet<StripeCustomer>(`/customers/${customerId}`);
    if (!custRes.ok) return badRequest('Customer not found in Stripe');

    let paymentMethodId = custRes.data.invoice_settings?.default_payment_method || null;

    // Fallback: list payment methods
    if (!paymentMethodId) {
      const pmRes = await stripeGet<StripePaymentMethodList>(
        `/payment_methods?customer=${customerId}&type=card&limit=1`,
      );
      if (pmRes.ok && pmRes.data.data?.length > 0) {
        paymentMethodId = pmRes.data.data[0].id;
      }
    }

    if (!paymentMethodId) {
      return badRequest('No card on file for this patient.');
    }

    // 2. Charge $30
    const params: Record<string, string> = {
      amount: String(NO_SHOW_FEE_CENTS),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: 'true',
      confirm: 'true',
      description: 'No-show / late cancellation fee',
      'metadata[chargedBy]': caller.email,
      'metadata[type]': 'no_show_fee',
    };

    const res = await stripePost<StripePaymentIntent>('/payment_intents', params);

    if (!res.ok) {
      const errData = res.data as unknown as { error?: { message?: string } };
      const errMsg = errData.error?.message || 'Payment failed';
      return {
        statusCode: 402,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: errMsg }),
      };
    }

    // 3. Audit log
    await writeAuditLog({
      providerId: caller.providerId,
      action: 'NO_SHOW_CHARGED',
      entityType: 'Billing',
      entityId: res.data.id,
      details: {
        customerId,
        amountCents: NO_SHOW_FEE_CENTS,
        paymentIntentId: res.data.id,
        chargedBy: caller.email,
      },
    });

    return success({
      paymentIntentId: res.data.id,
      status: res.data.status,
      amount: res.data.amount,
    });
  } catch (err) {
    console.error('No-show charge error:', (err as Error).message);
    return serverError('Failed to process no-show fee');
  }
};
