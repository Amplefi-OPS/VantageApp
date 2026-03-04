/**
 * Stripe API Client — fetch wrapper for Stripe billing endpoints.
 *
 * All requests go through the same API Gateway as the main API,
 * authenticated via Cognito. The Lambdas call Stripe server-side.
 */

import { ApiError } from './client'
import { getAuthHeader } from '../auth/cognito'

function stripeBaseUrl(): string {
  const url = import.meta.env.VITE_STRIPE_API_BASE_URL
  if (!url) {
    console.warn('VITE_STRIPE_API_BASE_URL is not set — Stripe calls will fail')
  }
  return url || ''
}

function cognitoHeaders(): Record<string, string> {
  const auth = getAuthHeader()
  return auth ? { Authorization: auth } : {}
}

async function safeJson<T>(res: Response): Promise<T> {
  try {
    return await res.json()
  } catch {
    throw new ApiError(res.status, `Unexpected response (status ${res.status})`)
  }
}

function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    sessionStorage.clear()
    window.location.replace('/dashboard')
  }
}

async function errorMessage(res: Response): Promise<string> {
  handleUnauthorized(res)
  try {
    const text = await res.text()
    const parsed = JSON.parse(text)
    if (parsed.error && typeof parsed.error === 'string') return parsed.error
    if (parsed.message && typeof parsed.message === 'string') return parsed.message
  } catch { /* ignore */ }
  return `Request failed (${res.status})`
}

/** GET request to the Stripe API using Cognito auth. */
export async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${stripeBaseUrl()}${path}`, {
    headers: { ...cognitoHeaders() },
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}

/** POST request to the Stripe API using Cognito auth. */
export async function stripePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${stripeBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cognitoHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}
