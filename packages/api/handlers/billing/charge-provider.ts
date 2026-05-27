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
  // Opaque Stripe refs (NOT PHI). Per PATIENT_IDENTITY_PAYMENT_CONTRACT.md the
  // patient↔Stripe link is a stored customer id, not an email search.
  stripe_customer_id?: string;
  stripe_payment_method_id?: string;
  // Original PaymentIntent id, required for refunds.
  charge_external_id?: string;
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
