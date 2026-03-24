/**
 * POST /billing/payment-intent
 *
 * Creates a Stripe PaymentIntent for client-side confirmation.
 * Optionally saves the card for future off-session charges.
 *
 * Body: { customerId, amount, description?, saveCard? }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, serverError, parseBody } from '../../shared/response';
import { stripePost } from '../../shared/stripe';

interface StripePaymentIntent {
  id: string;
  client_secret: string;
  status: string;
  amount: number;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const customerId = body.customerId as string | undefined;
    const amount = body.amount as number | undefined;
    const description = body.description as string | undefined;
    const saveCard = body.saveCard as boolean | undefined;

    if (!customerId) return badRequest('Missing required field: customerId');

    if (amount === undefined || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 50) {
      return badRequest('amount must be an integer >= 50 (cents)');
    }
    if (amount > 999999) {
      return badRequest('amount must be <= 999999 (≈$10,000)');
    }

    const params: Record<string, string> = {
      amount: String(amount),
      currency: 'usd',
      customer: customerId,
      'payment_method_types[0]': 'card',
    };

    if (description) params.description = description;
    if (saveCard) params.setup_future_usage = 'off_session';

    const res = await stripePost<StripePaymentIntent>('/payment_intents', params);

    if (!res.ok) {
      const errData = res.data as unknown as { error?: { message?: string } };
      return {
        statusCode: 402,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: errData.error?.message || 'Payment intent creation failed' }),
      };
    }

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'PAYMENT_INTENT_CREATED',
      entityType: 'Billing',
      entityId: res.data.id,
      details: {
        customerId,
        amountCents: amount,
        saveCard: !!saveCard,
        createdBy: caller.email,
      },
    });

    return success({
      clientSecret: res.data.client_secret,
      paymentIntentId: res.data.id,
    });
  } catch (err) {
    console.error('Payment intent error:', (err as Error).message);
    return serverError('Failed to create payment intent');
  }
};
