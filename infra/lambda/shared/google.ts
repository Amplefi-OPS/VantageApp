/**
 * Google Calendar API authentication helper.
 *
 * Uses OAuth2 refresh token flow to get short-lived access tokens.
 * Credentials (client ID, client secret, refresh token) are stored
 * in AWS Secrets Manager. Tokens are cached in Lambda memory.
 */

import { getSecrets } from './secrets';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a valid Google OAuth2 access token for Calendar API.
 * Caches the token and refreshes 60s before expiry.
 */
export async function getGoogleAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const secrets = await getSecrets();
  if (!secrets.GOOGLE_CLIENT_ID || !secrets.GOOGLE_CLIENT_SECRET || !secrets.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Calendar credentials not configured in Secrets Manager (need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.GOOGLE_CLIENT_ID,
      client_secret: secrets.GOOGLE_CLIENT_SECRET,
      refresh_token: secrets.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth2 token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

/**
 * Get the Google Calendar ID from Secrets Manager.
 */
export async function getCalendarId(): Promise<string> {
  const secrets = await getSecrets();
  if (!secrets.GOOGLE_CALENDAR_ID) {
    throw new Error('GOOGLE_CALENDAR_ID not configured in Secrets Manager');
  }
  return secrets.GOOGLE_CALENDAR_ID;
}
