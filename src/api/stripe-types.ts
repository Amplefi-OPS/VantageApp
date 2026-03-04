/**
 * Stripe billing types and constants.
 */

export interface ServicePackage {
  id: string
  name: string
  price: number
}

export const SERVICE_PACKAGES: ServicePackage[] = [
  { id: 'initial-consult', name: 'Initial Consultation', price: 35000 },
  { id: 'follow-up', name: 'Follow-Up Visit', price: 17500 },
  { id: 'no-show-fee', name: 'No-Show Fee', price: 3000 },
  { id: 'hormone-package', name: 'Hormone Optimization Package', price: 120000 },
  { id: 'wellness-package', name: 'Total Wellness Package', price: 240000 },
]

export interface StripeCustomer {
  id: string
  name: string
  email: string
  phone: string | null
  defaultPaymentMethod: {
    id: string
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
  created: number
}

export interface PaymentIntentRequest {
  customerId: string
  amount: number
  description: string
  metadata?: Record<string, string>
}

export interface NoShowChargeRequest {
  customerId: string
  reason?: string
}

export interface PaymentResult {
  id: string
  status: string
  amount: number
  created: number
}

export interface Transaction {
  id: string
  amount: number
  status: string
  description: string | null
  customerName: string | null
  customerEmail: string | null
  created: number
  metadata?: Record<string, string>
}

export interface TransactionListResponse {
  transactions: Transaction[]
  hasMore: boolean
  totalCount: number
}

export interface CustomerSearchResponse {
  customers: StripeCustomer[]
}
