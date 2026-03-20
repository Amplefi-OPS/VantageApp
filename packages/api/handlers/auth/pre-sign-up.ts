/**
 * Cognito Pre Sign-Up Lambda Trigger
 *
 * Validates that the email address belongs to an allowed domain.
 * This runs for both admin-created users and (if ever enabled) self-sign-up.
 */

const ALLOWED_DOMAINS = ['vantagerefinery.com', 'amplefi.com'];

interface PreSignUpEvent {
  triggerSource: string;
  request: {
    userAttributes: {
      email?: string;
      [key: string]: string | undefined;
    };
  };
  response: {
    autoConfirmUser: boolean;
    autoVerifyEmail: boolean;
    autoVerifyPhone: boolean;
  };
}

export async function handler(event: PreSignUpEvent): Promise<PreSignUpEvent> {
  const email = event.request.userAttributes.email;

  if (!email) {
    throw new Error('Email is required for account creation.');
  }

  const domain = email.split('@')[1]?.toLowerCase();

  if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
    throw new Error('Account creation is restricted to authorized email domains.');
  }

  // For admin-created users, auto-confirm email (they're trusted)
  if (event.triggerSource === 'PreSignUp_AdminCreateUser') {
    event.response.autoVerifyEmail = true;
  }

  return event;
}
