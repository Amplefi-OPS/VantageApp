/**
 * Confirm Password Reset
 *
 * Validates the 6-digit code from DynamoDB and uses AdminSetUserPassword
 * to apply the new permanent password. Part of the custom forgot-password
 * flow that works alongside EMAIL_OTP MFA.
 *
 * POST /auth/confirm-forgot-password  (unauthenticated)
 * Body: { email: string, code: string, newPassword: string }
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHash } from 'crypto';
import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getItem, deleteItem } from '../../shared/dynamo';
import {
  success,
  badRequest,
  serverError,
  parseBody,
  getOrigin,
  setRequestOrigin,
} from '../../shared/response';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = getOrigin(event);
  setRequestOrigin(origin);

  const body = parseBody(event);
  if (!body) return badRequest('Invalid request body');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!email || !code || !newPassword) {
    return badRequest('Email, code, and new password are required');
  }

  try {
    const stored = await getItem(`PWRESET#${email}`, 'CODE');

    if (!stored) {
      return badRequest('Invalid or expired reset code. Please request a new one.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (stored.expiresAt < now) {
      await deleteItem(`PWRESET#${email}`, 'CODE');
      return badRequest('Reset code has expired. Please request a new one.');
    }

    if (stored.codeHash !== hashCode(code)) {
      return badRequest('Invalid verification code. Please check and try again.');
    }

    // Code is valid — set the new permanent password via admin API
    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: newPassword,
      Permanent: true,
    }));

    // Clean up the used code
    await deleteItem(`PWRESET#${email}`, 'CODE');

    return success({ message: 'Password reset successfully.' });
  } catch (err: any) {
    console.error('[confirm-password-reset] error:', err.message);
    if (err.name === 'InvalidPasswordException') {
      return badRequest('Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.');
    }
    if (err.name === 'UserNotFoundException') {
      return badRequest('Invalid or expired reset code. Please request a new one.');
    }
    return serverError('Failed to reset password');
  }
}
