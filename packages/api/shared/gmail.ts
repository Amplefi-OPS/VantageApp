/**
 * Gmail API helper for reading inbound mail labeled by Gmail filters.
 * Separate from shared/google.ts because Gmail uses a different refresh
 * token (scoped to gmail.modify + gmail.readonly) for a mailbox member
 * that receives content@vantagerefinery.com group mail.
 */

import { getSecrets } from './secrets';
import { thirdPartyError } from './safe-error';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGmailAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const secrets = await getSecrets();
  const clientId = secrets.GMAIL_CLIENT_ID || secrets.GOOGLE_CLIENT_ID;
  const clientSecret = secrets.GMAIL_CLIENT_SECRET || secrets.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !secrets.GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail credentials not configured (need GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: secrets.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw thirdPartyError('Gmail', 'OAuth2 token refresh', res.status);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function gmailFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGmailAccessToken();
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail API ${path} failed ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
}

export async function listLabeledMessages(
  labelId: string,
  excludeLabelId?: string,
  max = 50,
): Promise<GmailMessageSummary[]> {
  const q = excludeLabelId ? `-label:${await labelNameForId(excludeLabelId)}` : undefined;
  const params = new URLSearchParams({
    labelIds: labelId,
    maxResults: String(max),
  });
  if (q) params.set('q', q);
  const data = await gmailFetch<{ messages?: GmailMessageSummary[] }>(`/messages?${params}`);
  return data.messages || [];
}

const labelNameCache = new Map<string, string>();
async function labelNameForId(labelId: string): Promise<string> {
  if (labelNameCache.has(labelId)) return labelNameCache.get(labelId)!;
  const data = await gmailFetch<{ name?: string }>(`/labels/${labelId}`);
  const name = data.name || labelId;
  labelNameCache.set(labelId, name);
  return name;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

export async function getMessage(id: string): Promise<GmailMessage> {
  return gmailFetch(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`) as Promise<GmailMessage>;
}

export async function addLabel(messageId: string, labelId: string): Promise<void> {
  await gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export function headerValue(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** Parse "Jane Doe <jane@x.com>" → { name, email }. */
export function parseFromHeader(from: string | undefined): { name?: string; email: string } {
  if (!from) return { email: '' };
  const m = from.match(/^\s*(?:"?([^"<]+?)"?\s+)?<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim(), email: m[2].trim() };
  return { email: from.trim() };
}
