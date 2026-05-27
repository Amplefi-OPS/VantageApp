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

const STRIPE_BASE = 'https://api.stripe.com/v1';

/**
 * StripeChargeProvider — real Stripe REST integration (fetch-based, no SDK,
 * consistent with packages/api/shared/stripe.ts). Charges are made against a
 * stored Stripe customer id (opaque, NOT PHI) per
 * PATIENT_IDENTITY_PAYMENT_CONTRACT.md — never an email/PHI search. The
 * billing event's idempotency_key is sent as Stripe's Idempotency-Key so a
 * replayed EventBridge event cannot double-charge.
 */
class StripeChargeProvider implements IChargeProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async post<T>(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<{ data: T; ok: boolean }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(`${STRIPE_BASE}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(params).toString(),
    });
    return { data: (await res.json()) as T, ok: res.ok };
  }

  private async get<T>(path: string): Promise<{ data: T; ok: boolean }> {
    const res = await fetch(`${STRIPE_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return { data: (await res.json()) as T, ok: res.ok };
  }

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    console.log('Stripe createCharge:', {
      amount: request.amount_cents,
      currency: request.currency,
      reference: request.billing_reference,
      // NOTE: No PHI fields logged or sent
    });

    const customerId = request.stripe_customer_id;
    if (!customerId) {
      // No Stripe component — producer must route to the QuickBooks fallback
      // (see PATIENT_IDENTITY_PAYMENT_CONTRACT.md §4).
      return { success: false, error: 'no_stripe_customer' };
    }

    // Resolve the payment method: explicit, else the customer's default.
    let paymentMethodId = request.stripe_payment_method_id;
    if (!paymentMethodId) {
      const cust = await this.get<{ invoice_settings?: { default_payment_method?: string | null } }>(
        `/customers/${encodeURIComponent(customerId)}`,
      );
      paymentMethodId = cust.data.invoice_settings?.default_payment_method || undefined;
    }
    if (!paymentMethodId) {
      return { success: false, error: 'no_payment_method' };
    }

    const pi = await this.post<{ id?: string; error?: { message: string } }>(
      '/payment_intents',
      {
        amount: String(request.amount_cents),
        currency: request.currency,
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: 'true',
        off_session: 'true',
        description: request.description,
        'metadata[billing_reference]': request.billing_reference,
        'metadata[vantage_event_id]': request.billing_event_id,
      },
      request.idempotency_key,
    );
    if (!pi.ok || !pi.data.id) {
      return { success: false, error: pi.data.error?.message || 'Stripe charge failed' };
    }
    return { success: true, external_id: pi.data.id };
  }

  async refundCharge(request: ChargeRequest): Promise<RefundResult> {
    console.log('Stripe refundCharge:', {
      reference: request.billing_reference,
      amount: request.amount_cents,
    });

    const paymentIntentId = request.charge_external_id;
    if (!paymentIntentId) {
      return { success: false, error: 'no_charge_reference' };
    }

    const refund = await this.post<{ id?: string; error?: { message: string } }>(
      '/refunds',
      {
        payment_intent: paymentIntentId,
        amount: String(request.amount_cents),
      },
      request.idempotency_key,
    );
    if (!refund.ok || !refund.data.id) {
      return { success: false, error: refund.data.error?.message || 'Stripe refund failed' };
    }
    return { success: true, external_id: refund.data.id };
  }

  async recordEvent(_request: ChargeRequest): Promise<RecordResult> {
    // Stripe doesn't have a "record" concept — bookkeeping goes to QuickBooks.
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
  stripe_customer_id?: string;
  stripe_payment_method_id?: string;
  charge_external_id?: string;
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
