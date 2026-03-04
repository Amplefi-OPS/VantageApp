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
import { setRequestOrigin } from '../shared/response';
import { success, badRequest, serverError } from '../shared/response';
import { sendSlackAlert } from '../shared/slack';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Set CORS origin
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);

    let body: { email?: string; reason?: string } | null = null;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch {
      return badRequest('Invalid JSON');
    }

    if (!body?.email) {
      return badRequest('Email is required');
    }

    // Sanitize — never forward raw user input to Slack
    const email = body.email.slice(0, 100).replace(/[<>&]/g, '');
    const reason = (body.reason || 'Unknown').slice(0, 200).replace(/[<>&]/g, '');

    // Determine severity
    const isLockout = reason.toLowerCase().includes('too many') || reason.toLowerCase().includes('locked');
    const level = isLockout ? 'critical' as const : 'critical' as const;
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
