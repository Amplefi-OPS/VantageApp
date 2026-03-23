/**
 * API Client — typed fetch wrapper for all API calls.
 */

import { getSettings } from '../lib/settings'
import { getAuthHeader } from '../auth/cognito'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function baseUrl(): string {
  return getSettings().apiBaseUrl || '/api'
}

function authHeaders(): Record<string, string> {
  const auth = getAuthHeader()
  return auth ? { Authorization: auth } : {}
}

/** Safely parse JSON from a response, returning null on failure. */
async function safeJson<T>(res: Response): Promise<T> {
  try {
    return await res.json()
  } catch {
    throw new ApiError(res.status, `Unexpected response (status ${res.status})`)
  }
}

/** Handle 401 by clearing session — AuthProvider detects the missing tokens and shows login. */
function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    sessionStorage.removeItem('vantage-auth-tokens')
    // Do NOT call window.location.replace — let AuthProvider handle the redirect
    // by detecting the missing tokens on the next render cycle.
  }
}

/** Extract a user-safe error message from a failed response. */
async function errorMessage(res: Response): Promise<string> {
  handleUnauthorized(res)
  try {
    const text = await res.text()
    // Try to extract a structured error message
    const parsed = JSON.parse(text)
    if (parsed.error && typeof parsed.error === 'string') return parsed.error
    if (parsed.message && typeof parsed.message === 'string') return parsed.message
  } catch {
    // ignore parse failures
  }
  // Fallback: generic message (never expose raw Lambda internals)
  return `Request failed (${res.status})`
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  // Handle 204 No Content (empty body)
  if (res.status === 204) return undefined as T
  return safeJson<T>(res)
}

/**
 * Upload a file via presigned URL workflow.
 */
export async function apiUpload(
  path: string,
  file: File,
  folder: string,
): Promise<{ url: string; key: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('folder', folder)

  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: form,
  })
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return safeJson<{ url: string; key: string }>(res)
}
