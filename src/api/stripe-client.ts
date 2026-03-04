/**
 * Stripe API Client — fetch wrapper for Stripe billing endpoints.
 *
 * All requests go through the same API Gateway as the main API,
 * authenticated via Cognito. The Lambdas call Stripe server-side.
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
