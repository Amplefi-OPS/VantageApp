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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
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
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}
