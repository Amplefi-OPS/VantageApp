/**
 * POST /billing/charge
 *
 * Charges a patient's saved payment method via Stripe.
 * Writes an audit log to DynamoDB.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, serverError, parseBody } from '../../shared/response';
import { getSecrets } from '../../shared/secrets';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON body');

    const { customerId, paymentMethodId, amountCents, description } = body;
    if (!customerId || !paymentMethodId || !amountCents) {
      return badRequest('Missing required fields: customerId, paymentMethodId, amountCents');
    }

    const secrets = await getSecrets();
    const stripeKey = secrets.STRIPE_SECRET_KEY;

    // Create PaymentIntent via Stripe API
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: 'usd',
        customer: customerId as string,
        payment_method: paymentMethodId as string,
        confirm: 'true',
        off_session: 'true',
        description: (description as string) || 'Vantage billing charge',
      }).toString(),
    });

    const result = (await res.json()) as Record<string, unknown>;

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'BILLING_CHARGE',
      entityType: 'Billing',
      entityId: (result.id as string) || 'unknown',
      details: {
        customerId,
        amountCents,
        status: result.status as string,
        chargedBy: caller.email,
      },
    });

    if (!res.ok) {
      const err = result.error as Record<string, string> | undefined;
      return serverError(`Stripe error: ${err?.message || 'unknown'}`);
    }

    return success({
      paymentIntentId: result.id,
      status: result.status,
      amountCents,
    });
  } catch (err) {
    console.error('Billing charge error:', (err as Error).message);
    return serverError('Failed to process charge');
  }
};
