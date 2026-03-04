/**
 * POST /billing/charge
 *
 * Initiates a billing action by publishing an event to EventBridge.
 * Does NOT directly call Stripe or QuickBooks — those are handled
 * asynchronously by their respective Lambda processors.
 *
 * Request body:
 * {
 *   "provider_id": "dr-smith-001",
 *   "task_id": "task-123",
 *   "action": "charge",            // charge | refund | record
 *   "provider_type": "stripe",     // stripe | quickbooks | both
 *   "amount_cents": 5000,
 *   "currency": "usd",
 *   "description": "Office visit copay",
 *   "billing_reference": "INV-2024-001",
 *   "idempotency_key": "uuid-here"
 * }
 *
 * IMPORTANT: No PHI is sent to billing providers. Only:
 *   - billing_reference (opaque identifier)
 *   - amount, currency, description (clinical details excluded)
 *   - provider_id (internal reference)
 *
 * Response:
 * {
 *   "billing_event_id": "bill-abc123",
 *   "status": "submitted",
 *   "message": "Billing event submitted for processing"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { getCallerIdentity, canAccessProvider } from '../shared/auth';
import { putItem, writeAuditLog } from '../shared/dynamo';
import { success, badRequest, forbidden, serverError, parseBody } from '../shared/response';

const eb = new EventBridgeClient({});
const BILLING_EVENT_BUS = process.env.BILLING_EVENT_BUS!;

const VALID_ACTIONS = new Set(['charge', 'refund', 'record']);
const VALID_PROVIDERS = new Set(['stripe', 'quickbooks', 'both']);

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const {
      provider_id,
      task_id,
      action,
      provider_type,
      amount_cents,
      currency = 'usd',
      description,
      billing_reference,
      idempotency_key,
    } = body;

    if (!provider_id || !action || !provider_type || !amount_cents) {
      return badRequest('Missing required fields: provider_id, action, provider_type, amount_cents');
    }

    if (!canAccessProvider(caller, provider_id)) {
      return forbidden('Cannot create billing events for another provider');
    }

    if (!VALID_ACTIONS.has(action)) {
      return badRequest(`Invalid action. Valid: ${[...VALID_ACTIONS].join(', ')}`);
    }

    if (!VALID_PROVIDERS.has(provider_type)) {
      return badRequest(`Invalid provider_type. Valid: ${[...VALID_PROVIDERS].join(', ')}`);
    }

    const billingEventId = `bill-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const idemKey = idempotency_key || randomUUID();

    // Determine detail type
    const detailTypeMap: Record<string, string> = {
      charge: 'ChargeRequested',
      refund: 'RefundRequested',
      record: 'RecordEvent',
    };

    // Determine which providers to target
    const targets = provider_type === 'both' ? ['stripe', 'quickbooks'] : [provider_type];

    // Publish events to EventBridge
    const entries = targets.map((target) => ({
      Source: 'vantage.billing',
      DetailType: detailTypeMap[action],
      EventBusName: BILLING_EVENT_BUS,
      Detail: JSON.stringify({
        billing_event_id: billingEventId,
        provider: target,
        provider_id,
        task_id: task_id || null,
        amount_cents,
        currency,
        description: description || '',
        billing_reference: billing_reference || billingEventId,
        idempotency_key: idemKey,
        requested_at: now,
        requested_by: caller.email,
      }),
    }));

    const ebResult = await eb.send(new PutEventsCommand({ Entries: entries }));
    if (ebResult.FailedEntryCount && ebResult.FailedEntryCount > 0) {
      console.error('EventBridge PutEvents partial failure:', JSON.stringify(ebResult.Entries));
    }

    // Record billing event in DynamoDB
    await putItem({
      PK: `BILLING#${billingEventId}`,
      SK: 'EVENT',
      billingEventId,
      providerId: provider_id,
      taskId: task_id || null,
      action,
      providerType: provider_type,
      amountCents: amount_cents,
      currency,
      description: description || '',
      billingReference: billing_reference || billingEventId,
      idempotencyKey: idemKey,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${provider_id}`,
      GSI1SK: `BILLING#${now}`,
      GSI2PK: 'BILLING',
      GSI2SK: `${now}#${billingEventId}`,
      entityType: 'BillingEvent',
    });

    await writeAuditLog({
      providerId: provider_id,
      action: `BILLING_${action.toUpperCase()}`,
      entityType: 'BillingEvent',
      entityId: billingEventId,
      details: {
        providerType: provider_type,
        amountCents: amount_cents,
        billingReference: billing_reference,
        submittedBy: caller.email,
      },
    });

    return success({
      billing_event_id: billingEventId,
      status: 'submitted',
      message: 'Billing event submitted for processing',
    });
  } catch (err) {
    console.error('Billing charge error:', (err as Error).message);
    return serverError('Failed to submit billing event');
  }
};
