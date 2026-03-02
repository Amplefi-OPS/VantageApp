/**
 * Zoom Server-to-Server OAuth helper.
 *
 * Reads ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET from env vars.
 * Caches the access token in-memory so warm Lambda invocations reuse it.
 */

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

  const accountId = process.env.ZOOM_ACCOUNT_ID!;
  const clientId = process.env.ZOOM_CLIENT_ID!;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${ZOOM_AUTH_URL}?grant_type=account_credentials&account_id=${accountId}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom OAuth failed (${res.status}): ${body}`);
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
    const body = await res.text();
    throw new Error(`Zoom API error (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}
