/**
 * Stripe Charge Processor
 *
 * EventBridge Lambda target for Stripe billing events.
 * Implements IChargeProvider using the Stripe SDK.
 *
 * Stripe API key is fetched from AWS Secrets Manager at cold start.
 * No PHI is included in Stripe API calls — only opaque billing references.
 */

import type { EventBridgeEvent, Handler } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { updateItem, buildUpdateExpression, writeAuditLog } from '../../shared/dynamo';
import type { IChargeProvider, ChargeRequest, ChargeResult, RefundResult, RecordResult } from './charge-provider';

const sm = new SecretsManagerClient({});
const STRIPE_SECRET_ARN = process.env.STRIPE_SECRET_ARN!;

let stripeApiKey: string | null = null;

async function getStripeKey(): Promise<string> {
  if (stripeApiKey) return stripeApiKey;
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: STRIPE_SECRET_ARN }),
  );
  stripeApiKey = secret.SecretString || '';
  return stripeApiKey;
}

/**
 * StripeChargeProvider
 *
 * In production, replace the stub calls with actual Stripe SDK usage:
 *   import Stripe from 'stripe';
 *   const stripe = new Stripe(apiKey);
 *   const charge = await stripe.charges.create({ ... });
 */
class StripeChargeProvider implements IChargeProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    console.log('Stripe createCharge:', {
      amount: request.amount_cents,
      currency: request.currency,
      reference: request.billing_reference,
      // NOTE: No PHI fields logged or sent
    });

    // ── STUB: Replace with actual Stripe SDK call ──
    // const stripe = new Stripe(this.apiKey);
    // const charge = await stripe.charges.create({
    //   amount: request.amount_cents,
    //   currency: request.currency,
    //   description: request.description,
    //   metadata: {
    //     billing_reference: request.billing_reference,
    //     vantage_event_id: request.billing_event_id,
    //   },
    //   idempotencyKey: request.idempotency_key,
    // });
    // return { success: true, external_id: charge.id };

    // Stub response
    const stubId = `ch_stub_${Date.now()}`;
    console.log(`[STUB] Stripe charge created: ${stubId} for ${request.amount_cents} ${request.currency}`);
    return { success: true, external_id: stubId };
  }

  async refundCharge(request: ChargeRequest): Promise<RefundResult> {
    console.log('Stripe refundCharge:', {
      reference: request.billing_reference,
      amount: request.amount_cents,
    });

    // ── STUB: Replace with actual Stripe SDK call ──
    // const stripe = new Stripe(this.apiKey);
    // const refund = await stripe.refunds.create({
    //   charge: externalChargeId,
    //   amount: request.amount_cents,
    // });
    // return { success: true, external_id: refund.id };

    const stubId = `re_stub_${Date.now()}`;
    console.log(`[STUB] Stripe refund created: ${stubId}`);
    return { success: true, external_id: stubId };
  }

  async recordEvent(request: ChargeRequest): Promise<RecordResult> {
    // Stripe doesn't have a "record" concept — this is a no-op for Stripe
    console.log('Stripe recordEvent: no-op (use QuickBooks for bookkeeping)');
    return { success: true, external_id: `stripe_noop_${Date.now()}` };
  }
}

// ── EventBridge Handler ──
interface BillingDetail {
  billing_event_id: string;
  provider: string;
  provider_id: string;
  task_id: string | null;
  amount_cents: number;
  currency: string;
  description: string;
  billing_reference: string;
  idempotency_key: string;
  requested_at: string;
  requested_by: string;
}

export const handler: Handler<EventBridgeEvent<'ChargeRequested' | 'RefundRequested' | 'RecordEvent', BillingDetail>> = async (event) => {
  const detail = event.detail;
  const detailType = event['detail-type'];

  console.log(`Processing billing event: ${detailType} for ${detail.billing_event_id}`);

  const apiKey = await getStripeKey();
  const provider = new StripeChargeProvider(apiKey);

  let result: ChargeResult | RefundResult | RecordResult;

  switch (detailType) {
    case 'ChargeRequested':
      result = await provider.createCharge(detail);
      break;
    case 'RefundRequested':
      result = await provider.refundCharge(detail);
      break;
    case 'RecordEvent':
      result = await provider.recordEvent(detail);
      break;
    default:
      console.error(`Unknown detail type: ${detailType}`);
      return;
  }

  // Update billing event record in DynamoDB
  const now = new Date().toISOString();
  const updates = buildUpdateExpression({
    stripeStatus: result.success ? 'completed' : 'failed',
    stripeExternalId: result.external_id || null,
    stripeError: result.error || null,
    stripeProcessedAt: now,
    updatedAt: now,
  });

  if (updates) {
    await updateItem({
      Key: {
        PK: `BILLING#${detail.billing_event_id}`,
        SK: 'EVENT',
      },
      ...updates,
    });
  }

  await writeAuditLog({
    providerId: detail.provider_id,
    action: `STRIPE_${detailType.toUpperCase()}_${result.success ? 'SUCCESS' : 'FAILURE'}`,
    entityType: 'BillingEvent',
    entityId: detail.billing_event_id,
    details: {
      externalId: result.external_id,
      error: result.error,
    },
  });

  console.log(`Stripe processing complete: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
};
