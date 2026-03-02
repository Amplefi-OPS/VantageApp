/**
 * Stripe billing endpoint functions.
 */

import { stripeGet, stripePost, staffPost } from './stripe-client'
import type {
  PaymentIntentRequest,
  NoShowChargeRequest,
  PaymentResult,
  TransactionListResponse,
  CustomerSearchResponse,
  StripeCustomer,
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
  return staffPost<PaymentResult>('/stripe/charge-no-show', req)
}

// ── Transactions ─────────────────────────────────────────

export async function listTransactions(): Promise<TransactionListResponse> {
  return stripeGet<TransactionListResponse>('/stripe/transactions')
}
