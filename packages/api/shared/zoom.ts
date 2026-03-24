/**
 * Zoom Server-to-Server OAuth helper.
 *
 * Reads Zoom credentials from Secrets Manager via getSecrets().
 * Caches the access token in-memory so warm Lambda invocations reuse it.
 */

import { getSecrets } from './secrets';
import { thirdPartyError } from './safe-error';

const ZOOM_AUTH_URL = 'https://zoom.us/oauth/token';
const ZOOM_API_BASE = 'https://api.zoom.us/v2';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Fetch a fresh Server-to-Server OAuth access token. */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const secrets = await getSecrets();
  const accountId = secrets.ZOOM_ACCOUNT_ID;
  const clientId = secrets.ZOOM_CLIENT_ID;
  const clientSecret = secrets.ZOOM_CLIENT_SECRET;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${ZOOM_AUTH_URL}?grant_type=account_credentials&account_id=${accountId}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!res.ok) {
    throw thirdPartyError('Zoom', 'OAuth token', res.status);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number; scope: string };
  cachedToken = data.access_token;
  // Expire 5 minutes early to avoid edge-case rejections
  tokenExpiresAt = now + (data.expires_in - 300) * 1000;

  // Log granted scopes for debugging
  console.log('Zoom token scopes:', data.scope);

  return cachedToken;
}

/** Make an authenticated GET request to the Zoom API. */
export async function zoomGet<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getAccessToken();

  const url = new URL(`${ZOOM_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw thirdPartyError('Zoom', `GET ${path}`, res.status);
  }

  return res.json() as Promise<T>;
}

/** Download a binary file from a Zoom URL (e.g. voicemail audio). */
export async function zoomDownload(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await getAccessToken();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw thirdPartyError('Zoom', 'download', res.status);
  }

  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

/** Make an authenticated DELETE request to the Zoom API. */
export async function zoomDelete(path: string): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 204 No Content = success, 404 = already deleted (both OK)
  if (!res.ok && res.status !== 404) {
    throw thirdPartyError('Zoom', `DELETE ${path}`, res.status);
  }
}

/** Make an authenticated POST request to the Zoom API. */
export async function zoomPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();

  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw thirdPartyError('Zoom', `POST ${path}`, res.status);
  }

  return res.json() as Promise<T>;
}
