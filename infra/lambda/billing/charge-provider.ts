/**
 * IChargeProvider Interface
 *
 * All billing integrations implement this interface.
 * Implementations must NOT include PHI in external API calls.
 * Only billing_reference (opaque ID), amount, currency, and description are sent.
 */

export interface ChargeRequest {
  billing_event_id: string;
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

export interface ChargeResult {
  success: boolean;
  external_id?: string;  // Stripe charge ID, QuickBooks entry ID, etc.
  error?: string;
}

export interface RefundResult {
  success: boolean;
  external_id?: string;
  error?: string;
}

export interface RecordResult {
  success: boolean;
  external_id?: string;
  error?: string;
}

export interface IChargeProvider {
  /** Create a charge (payment collection) */
  createCharge(request: ChargeRequest): Promise<ChargeResult>;

  /** Refund a previous charge */
  refundCharge(request: ChargeRequest): Promise<RefundResult>;

  /** Record an event (bookkeeping entry, no payment) */
  recordEvent(request: ChargeRequest): Promise<RecordResult>;
}
