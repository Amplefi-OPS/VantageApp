/**
 * POST /billing/charge
 *
 * Charges a patient's card directly via Stripe PaymentIntent (off-session).
 *
 * Body: { customerId, paymentMethodId, amount, description? }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, serverError, parseBody } from '../../shared/response';
import { stripePost } from '../../shared/stripe';

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  error?: { message?: string };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const customerId = body.customerId as string | undefined;
    const paymentMethodId = body.paymentMethodId as string | undefined;
    const amount = body.amount as number | undefined;
    const description = body.description as string | undefined;

    if (!customerId || !paymentMethodId || amount === undefined) {
      return badRequest('Missing required fields: customerId, paymentMethodId, amount');
    }

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 50) {
      return badRequest('amount must be an integer >= 50 (cents)');
    }

    if (amount > 999999) {
      return badRequest('amount must be <= 999999 (≈$10,000)');
    }

    if (description && description.length > 500) {
      return badRequest('description must be <= 500 characters');
    }

    const params: Record<string, string> = {
      amount: String(amount),
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: 'true',
      confirm: 'true',
      description: description || 'Vantage medical visit',
      'metadata[chargedBy]': caller.email,
      'metadata[type]': 'visit_charge',
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

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'PATIENT_CHARGED',
      entityType: 'Billing',
      entityId: res.data.id,
      details: {
        customerId,
        amountCents: amount,
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
    console.error('Billing charge error:', (err as Error).message);
    return serverError('Failed to process charge');
  }
};
