/**
 * EMR API client — fetch wrapper for the separate functional-medicine EMR
 * backend. Parallel to client.ts (which targets VantageApp/VR).
 *
 * The EMR API lives on its own API Gateway stack (Vantage-EmrApi-{stage})
 * with a different origin, so it needs a separate base URL. Auth header reuse
 * is deliberate: both APIs sit behind the same Cognito User Pool — same token
 * authorizes both.
 */

import { getAuthHeader } from '../auth/cognito'

export class EmrApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'EmrApiError'
  }
}

function baseUrl(): string {
  // Prefer build-time env; fall back to the dev stack so the page works
  // without extra configuration while we validate the workflow.
  const fromEnv = (import.meta as unknown as { env: Record<string, string | undefined> }).env
    .VITE_EMR_API_BASE_URL
  const DEV_FALLBACK = 'https://v3ialwmep8.execute-api.us-east-1.amazonaws.com/dev'
  const url = fromEnv || DEV_FALLBACK
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function authHeaders(): Record<string, string> {
  if (sessionStorage.getItem('vantage-demo-mode')) {
    return { Authorization: 'Bearer demo' }
  }
  const auth = getAuthHeader()
  return auth ? { Authorization: auth } : {}
}

async function safeJson<T>(res: Response): Promise<T> {
  try { return await res.json() as T } catch {
    throw new EmrApiError(res.status, `Unexpected response (status ${res.status})`)
  }
}

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('vantage-session-expired'))
  }
  try {
    const text = await res.text()
    const parsed = JSON.parse(text)
    if (parsed.error && typeof parsed.error === 'string') return parsed.error
    if (parsed.message && typeof parsed.message === 'string') return parsed.message
  } catch { /* ignore */ }
  return `Request failed (${res.status})`
}

export async function emrGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, { headers: { ...authHeaders() } })
  if (!res.ok) throw new EmrApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}

export async function emrPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new EmrApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}
