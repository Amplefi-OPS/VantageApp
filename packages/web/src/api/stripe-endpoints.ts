/**
 * Stripe billing endpoint functions.
 */

import { stripeGet, stripePost } from './stripe-client'
import type {
  PaymentIntentRequest,
  NoShowChargeRequest,
  PaymentResult,
  TransactionListResponse,
  CustomerSearchResponse,
  StripeCustomer,
  SetupIntentRequest,
  SetupIntentResponse,
  ConfirmSetupRequest,
  ConfirmSetupResponse,
} from './stripe-types'

// ── Customers ────────────────────────────────────────────

export async function searchCustomers(query: string): Promise<CustomerSearchResponse> {
  return stripeGet<CustomerSearchResponse>(`/stripe/customers?q=${encodeURIComponent(query)}`)
}

export async function getCustomer(customerId: string): Promise<StripeCustomer> {
  return stripeGet<StripeCustomer>(`/stripe/customers/${customerId}`)
}

// ── Payments ─────────────────────────────────────────────

export async function createPaymentIntent(req: PaymentIntentRequest): Promise<PaymentResult> {
  return stripePost<PaymentResult>('/stripe/payment-intent', req)
}

// ── No-Show ──────────────────────────────────────────────

export async function chargeNoShow(req: NoShowChargeRequest): Promise<PaymentResult> {
  return stripePost<PaymentResult>('/stripe/charge-no-show', req)
}

// ── SetupIntent (card-on-file) ───────────────────────────

export async function createSetupIntent(req: SetupIntentRequest): Promise<SetupIntentResponse> {
  return stripePost<SetupIntentResponse>('/stripe/setup-intent', req)
}

export async function confirmSetup(req: ConfirmSetupRequest): Promise<ConfirmSetupResponse> {
  return stripePost<ConfirmSetupResponse>('/stripe/confirm-setup', req)
}

// ── Transactions ─────────────────────────────────────────

export async function listTransactions(): Promise<TransactionListResponse> {
  return stripeGet<TransactionListResponse>('/stripe/transactions')
}
