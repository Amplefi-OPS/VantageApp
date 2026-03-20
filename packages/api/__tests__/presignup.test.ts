/**
 * HIPAA Technical Safeguard: Domain Allowlist (Pre-Sign-Up Trigger)
 *
 * Verifies that the Cognito pre-sign-up trigger enforces the email
 * domain allowlist. Only authorized domains can create accounts.
 * Subdomain spoofing attacks must be blocked.
 */

import { handler } from '../handlers/auth/pre-sign-up';

function signUpEvent(email: string | undefined, triggerSource = 'PreSignUp_SignUp'): any {
  return {
    triggerSource,
    request: {
      userAttributes: { email },
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  };
}

describe('HIPAA — Domain Allowlist (Pre-Sign-Up)', () => {
  it('allows @vantagerefinery.com', async () => {
    const event = signUpEvent('dr.smith@vantagerefinery.com');
    const result = await handler(event);
    expect(result).toBeDefined();
    expect(result.request.userAttributes.email).toBe('dr.smith@vantagerefinery.com');
  });

  it('allows @amplefi.com', async () => {
    const event = signUpEvent('admin@amplefi.com');
    const result = await handler(event);
    expect(result).toBeDefined();
    expect(result.request.userAttributes.email).toBe('admin@amplefi.com');
  });

  it('blocks @gmail.com', async () => {
    const event = signUpEvent('attacker@gmail.com');
    await expect(handler(event)).rejects.toThrow(
      'Account creation is restricted to authorized email domains.',
    );
  });

  it('blocks subdomain attack @vantagerefinery.com.evil.com', async () => {
    const event = signUpEvent('phish@vantagerefinery.com.evil.com');
    await expect(handler(event)).rejects.toThrow(
      'Account creation is restricted to authorized email domains.',
    );
  });

  it('throws on missing email', async () => {
    const event = signUpEvent(undefined);
    await expect(handler(event)).rejects.toThrow(
      'Email is required for account creation.',
    );
  });

  it('sets autoVerifyEmail to true for PreSignUp_AdminCreateUser', async () => {
    const event = signUpEvent('admin@vantagerefinery.com', 'PreSignUp_AdminCreateUser');
    const result = await handler(event);
    expect(result.response.autoVerifyEmail).toBe(true);
  });
});
