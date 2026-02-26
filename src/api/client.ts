/**
 * API Client — typed fetch wrapper.
 *
 * In Demo Mode the mock layer intercepts every call.
 * When a real backend is connected, these functions hit actual HTTP endpoints.
 */

import { getSettings } from '../lib/settings'

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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`)
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}

/**
 * Upload a file (for S3 stub).
 * In production this would use a presigned URL workflow.
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
    body: form,
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json()
}
