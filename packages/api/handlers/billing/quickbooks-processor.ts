/**
 * QuickBooks Processor
 *
 * EventBridge Lambda target for QuickBooks bookkeeping events.
 * Implements IChargeProvider for recording charges, refunds, and general events.
 *
 * QuickBooks OAuth credentials are fetched from AWS Secrets Manager.
 * No PHI is included in QuickBooks API calls.
 */

import type { EventBridgeEvent, Handler } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { updateItem, buildUpdateExpression, writeAuditLog } from '../../shared/dynamo';
import type { IChargeProvider, ChargeRequest, ChargeResult, RefundResult, RecordResult } from './charge-provider';

const sm = new SecretsManagerClient({});
const QB_CREDENTIALS_ARN = process.env.QB_CREDENTIALS_ARN!;

interface QBCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
}

let cachedCredentials: QBCredentials | null = null;

async function getQBCredentials(): Promise<QBCredentials> {
  if (cachedCredentials) return cachedCredentials;
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: QB_CREDENTIALS_ARN }),
  );
  cachedCredentials = JSON.parse(secret.SecretString || '{}');
  return cachedCredentials!;
}

/**
 * QuickBooksProvider
 *
 * In production, replace stubs with actual QuickBooks Online SDK calls:
 *   - Use OAuth2 token refresh flow
 *   - Create Invoice or SalesReceipt for charges
 *   - Create RefundReceipt for refunds
 *   - Create JournalEntry for general records
 */
class QuickBooksProvider implements IChargeProvider {
  private credentials: QBCredentials;

  constructor(credentials: QBCredentials) {
    this.credentials = credentials;
  }

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    console.log('QuickBooks createCharge:', {
      amount: request.amount_cents,
      reference: request.billing_reference,
    });

    // ── STUB: Replace with QuickBooks API call ──
    // const qbo = new QuickBooks(this.credentials);
    // const invoice = await qbo.createInvoice({
    //   Line: [{
    //     Amount: request.amount_cents / 100,
    //     Description: request.description,
    //     DetailType: 'SalesItemLineDetail',
    //     SalesItemLineDetail: { ItemRef: { value: '1' } },
    //   }],
    //   CustomerRef: { value: request.billing_reference },
    // });
    // return { success: true, external_id: invoice.Id };

    const stubId = `qb_inv_${Date.now()}`;
    console.log(`[STUB] QuickBooks invoice created: ${stubId}`);
    return { success: true, external_id: stubId };
  }

  async refundCharge(request: ChargeRequest): Promise<RefundResult> {
    console.log('QuickBooks refundCharge:', {
      reference: request.billing_reference,
      amount: request.amount_cents,
    });

    // ── STUB: Replace with QuickBooks RefundReceipt ──
    const stubId = `qb_ref_${Date.now()}`;
    console.log(`[STUB] QuickBooks refund created: ${stubId}`);
    return { success: true, external_id: stubId };
  }

  async recordEvent(request: ChargeRequest): Promise<RecordResult> {
    console.log('QuickBooks recordEvent:', {
      reference: request.billing_reference,
      amount: request.amount_cents,
      description: request.description,
    });

    // ── STUB: Replace with QuickBooks JournalEntry ──
    // const qbo = new QuickBooks(this.credentials);
    // const entry = await qbo.createJournalEntry({
    //   Line: [{
    //     Amount: request.amount_cents / 100,
    //     Description: request.description,
    //     DetailType: 'JournalEntryLineDetail',
    //     JournalEntryLineDetail: {
    //       PostingType: 'Debit',
    //       AccountRef: { value: 'accounts_receivable_id' },
    //     },
    //   }],
    // });
    // return { success: true, external_id: entry.Id };

    const stubId = `qb_je_${Date.now()}`;
    console.log(`[STUB] QuickBooks journal entry created: ${stubId}`);
    return { success: true, external_id: stubId };
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

  console.log(`Processing QuickBooks event: ${detailType} for ${detail.billing_event_id}`);

  const credentials = await getQBCredentials();
  const provider = new QuickBooksProvider(credentials);

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

  // Update billing event record
  const now = new Date().toISOString();
  const updates = buildUpdateExpression({
    quickbooksStatus: result.success ? 'completed' : 'failed',
    quickbooksExternalId: result.external_id || null,
    quickbooksError: result.error || null,
    quickbooksProcessedAt: now,
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
    action: `QUICKBOOKS_${detailType.toUpperCase()}_${result.success ? 'SUCCESS' : 'FAILURE'}`,
    entityType: 'BillingEvent',
    entityId: detail.billing_event_id,
    details: {
      externalId: result.external_id,
      error: result.error,
    },
  });

  console.log(`QuickBooks processing complete: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
};
