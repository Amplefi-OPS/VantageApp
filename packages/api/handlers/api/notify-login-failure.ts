/**
 * POST /notifications/login-failure
 *
 * Called by the frontend when a login attempt fails.
 * Sends a Slack alert so the team can monitor for brute-force attempts
 * or users having trouble signing in.
 *
 * Note: This endpoint does NOT require Cognito auth (user isn't logged in yet).
 * Rate limiting is handled by API Gateway throttling.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { setRequestOrigin } from '../../shared/response';
import { success, badRequest, serverError } from '../../shared/response';
import { sendSlackAlert } from '../../shared/slack';

// In-memory rate limiter (per Lambda instance). Limits each IP to 5 requests per minute.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Basic email format check — not a full RFC 5322 validator
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Set CORS origin
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);

    // Per-IP rate limiting to reduce abuse potential
    const sourceIp = event.requestContext.identity?.sourceIp || 'unknown';
    if (isRateLimited(sourceIp)) {
      return { statusCode: 429, headers: {}, body: JSON.stringify({ error: 'Too many requests' }) };
    }

    let body: { email?: string; reason?: string } | null = null;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch {
      return badRequest('Invalid JSON');
    }

    if (!body?.email) {
      return badRequest('Email is required');
    }

    // Validate email format
    if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
      return badRequest('Invalid email format');
    }

    // Sanitize — never forward raw user input to Slack
    const email = body.email.slice(0, 100).replace(/[<>&]/g, '');
    const reason = (body.reason || 'Unknown').slice(0, 200).replace(/[<>&]/g, '');

    // Determine severity
    const isLockout = reason.toLowerCase().includes('too many') || reason.toLowerCase().includes('locked');
    const level = isLockout ? 'critical' as const : 'warning' as const;
    const title = isLockout ? 'Account Lockout' : 'Failed Login Attempt';

    await sendSlackAlert(title, level, [
      { label: 'Email', value: email },
      { label: 'Reason', value: reason },
      { label: 'IP', value: event.requestContext.identity?.sourceIp || 'unknown' },
    ]);

    return success({ ok: true });
  } catch (err) {
    console.error('Login failure notification error:', (err as Error).message);
    return serverError('Failed to send notification');
  }
};
