/**
 * Initiate Password Reset
 *
 * Custom forgot-password flow to work around AWS Cognito's limitation:
 * email OTP MFA and email account recovery cannot coexist. This handler
 * generates a code, stores it in DynamoDB, and sends it via SES directly.
 *
 * POST /auth/forgot-password  (unauthenticated)
 * Body: { email: string }
 * Always returns 200 — never reveals whether the email is registered.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomInt, createHash } from 'crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getItem, putItem } from '../../shared/dynamo';
import {
  success,
  badRequest,
  serverError,
  parseBody,
  getOrigin,
  setRequestOrigin,
} from '../../shared/response';

const ses = new SESClient({ region: 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID!;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vantagerefinery.com';
const CODE_TTL_SECONDS = 15 * 60; // 15 minutes
const RESEND_COOLDOWN_SECONDS = 60; // 1 minute between resend requests

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = getOrigin(event);
  setRequestOrigin(origin);

  const body = parseBody(event);
  if (!body) return badRequest('Invalid request body');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest('Valid email is required');
  }

  // Always return the same success message to avoid user enumeration
  const okResponse = success({ message: 'If that email is registered, a reset code has been sent.' });

  try {
    // Rate limiting: silently succeed if a code was sent in the last minute
    const existing = await getItem(`PWRESET#${email}`, 'CODE');
    const now = Math.floor(Date.now() / 1000);
    if (existing?.createdAtUnix && now - existing.createdAtUnix < RESEND_COOLDOWN_SECONDS) {
      return okResponse;
    }

    // Check user exists in Cognito — silently succeed if not (don't reveal existence)
    try {
      await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
    } catch (err: any) {
      if (err.name === 'UserNotFoundException') return okResponse;
      throw err;
    }

    // Generate 6-digit code and store it (hashed) in DynamoDB with TTL
    const code = String(randomInt(100000, 999999));
    const expiresAt = now + CODE_TTL_SECONDS;

    await putItem({
      PK: `PWRESET#${email}`,
      SK: 'CODE',
      codeHash: hashCode(code),
      email,
      expiresAt,
      createdAtUnix: now,
      ttl: expiresAt,
    });

    // Send the code via SES
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: 'Vantage — Password Reset Code', Charset: 'UTF-8' },
        Body: {
          Text: {
            Data: [
              `Your Vantage password reset code is: ${code}`,
              '',
              'This code expires in 15 minutes.',
              '',
              'If you did not request a password reset, you can safely ignore this email.',
            ].join('\n'),
            Charset: 'UTF-8',
          },
        },
      },
    }));

    return okResponse;
  } catch (err) {
    console.error('[initiate-password-reset] error:', (err as Error).message);
    return serverError('Failed to process request');
  }
}
