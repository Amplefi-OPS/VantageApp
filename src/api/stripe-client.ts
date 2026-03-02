/**
 * Stripe API Client — separate fetch wrapper for the Stripe backend.
 *
 * Uses VITE_STRIPE_API_BASE_URL for the base URL.
 * Staff-authenticated endpoints use VITE_STAFF_API_KEY as Bearer token.
 * Regular endpoints use Cognito auth headers.
 */

import { ApiError } from './client'
import { getAuthHeader } from '../auth/cognito'

function stripeBaseUrl(): string {
  return import.meta.env.VITE_STRIPE_API_BASE_URL || ''
}

function cognitoHeaders(): Record<string, string> {
  const auth = getAuthHeader()
  return auth ? { Authorization: auth } : {}
}

function staffHeaders(): Record<string, string> {
  const apiKey = import.meta.env.VITE_STAFF_API_KEY || ''
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/** GET request to the Stripe API using Cognito auth. */
export async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${stripeBaseUrl()}${path}`, {
    headers: { ...cognitoHeaders() },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

/** POST request to the Stripe API using Cognito auth. */
export async function stripePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${stripeBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cognitoHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

/** POST request using the staff API key (for no-show charges, etc.). */
export async function staffPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${stripeBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...staffHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}
