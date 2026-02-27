/**
 * Cognito Authentication Utilities
 *
 * Lightweight wrapper around Cognito USER_SRP_AUTH flow.
 * No Amplify SDK required — uses direct Cognito API calls via fetch.
 *
 * In production, install `amazon-cognito-identity-js` or use AWS Amplify Auth.
 * This module provides the interface that AuthProvider.tsx depends on.
 */

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

export interface AuthUser {
  sub: string;
  email: string;
  givenName: string;
  familyName: string;
  providerId: string;
  role: string;
  groups: string[];
}

const STORAGE_KEY = 'vantage-auth-tokens';

// Track email across challenge steps (never stored persistently)
let pendingEmail = '';
let pendingChallengeName = '';

// Default config — override via environment variables
let config: CognitoConfig = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
};

export function configureCognito(c: Partial<CognitoConfig>) {
  config = { ...config, ...c };
}

/** Store tokens in sessionStorage (not localStorage) for security */
function storeTokens(tokens: AuthTokens) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

function loadTokens(): AuthTokens | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearTokens() {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Decode a JWT payload (without verification — verification happens server-side) */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
}

/** Get current auth tokens, refreshing if needed */
export function getTokens(): AuthTokens | null {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Check if expired (with 5-min buffer)
  if (Date.now() > (tokens.expiresAt - 300) * 1000) {
    // Token expired — caller should redirect to login
    // In production, implement refresh token flow here
    return null;
  }

  return tokens;
}

/** Get current user from ID token */
export function getCurrentUser(): AuthUser | null {
  const tokens = getTokens();
  if (!tokens) return null;

  try {
    const claims = decodeJwtPayload(tokens.idToken);

    // cognito:groups is an array in the JWT, not a comma-separated string
    const groupsClaim = claims['cognito:groups'];
    let groups: string[] = [];
    if (Array.isArray(groupsClaim)) {
      groups = groupsClaim as string[];
    } else if (typeof groupsClaim === 'string') {
      groups = groupsClaim.split(',').filter(Boolean);
    }

    return {
      sub: claims.sub as string,
      email: claims.email as string,
      givenName: (claims.given_name as string) || '',
      familyName: (claims.family_name as string) || '',
      providerId: (claims['custom:provider_id'] as string) || (claims.sub as string),
      role: (claims['custom:role'] as string) || 'provider',
      groups,
    };
  } catch {
    return null;
  }
}

/** Check if user is authenticated */
export function isAuthenticated(): boolean {
  return getTokens() !== null;
}

/**
 * Sign in with email and password.
 *
 * In production, replace this with proper SRP auth via:
 *   - amazon-cognito-identity-js
 *   - @aws-amplify/auth
 *   - AWS SDK InitiateAuth
 *
 * This stub simulates the flow for UI development.
 */
export async function signIn(email: string, password: string): Promise<{
  success: boolean;
  mfaRequired?: boolean;
  newPasswordRequired?: boolean;
  session?: string;
  error?: string;
}> {
  if (!config.userPoolId || !config.clientId) {
    return { success: false, error: 'Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.' };
  }

  pendingEmail = email;

  try {
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: config.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      }),
    });

    const data = await response.json();

    if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      pendingChallengeName = 'NEW_PASSWORD_REQUIRED';
      return {
        success: false,
        newPasswordRequired: true,
        session: data.Session,
      };
    }

    if (data.ChallengeName === 'EMAIL_OTP' || data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      pendingChallengeName = data.ChallengeName;
      return {
        success: false,
        mfaRequired: true,
        session: data.Session,
      };
    }

    if (data.AuthenticationResult) {
      const tokens: AuthTokens = {
        idToken: data.AuthenticationResult.IdToken,
        accessToken: data.AuthenticationResult.AccessToken,
        refreshToken: data.AuthenticationResult.RefreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + data.AuthenticationResult.ExpiresIn,
      };
      storeTokens(tokens);
      return { success: true };
    }

    return { success: false, error: data.message || 'Authentication failed' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Complete NEW_PASSWORD_REQUIRED challenge (first login with temp password) */
export async function completeNewPasswordChallenge(
  newPassword: string,
  session: string,
): Promise<{ success: boolean; mfaRequired?: boolean; session?: string; error?: string }> {
  if (!config.clientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  try {
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
      },
      body: JSON.stringify({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: config.clientId,
        ChallengeResponses: {
          USERNAME: pendingEmail,
          NEW_PASSWORD: newPassword,
        },
        Session: session,
      }),
    });

    const data = await response.json();

    // After setting new password, Cognito may require MFA
    if (data.ChallengeName === 'EMAIL_OTP' || data.ChallengeName === 'MFA_SETUP' || data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      pendingChallengeName = data.ChallengeName;
      return {
        success: false,
        mfaRequired: true,
        session: data.Session,
      };
    }

    if (data.AuthenticationResult) {
      const tokens: AuthTokens = {
        idToken: data.AuthenticationResult.IdToken,
        accessToken: data.AuthenticationResult.AccessToken,
        refreshToken: data.AuthenticationResult.RefreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + data.AuthenticationResult.ExpiresIn,
      };
      storeTokens(tokens);
      return { success: true };
    }

    return { success: false, error: data.message || 'Failed to set new password' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Complete MFA challenge */
export async function completeMfaChallenge(
  code: string,
  session: string,
): Promise<{ success: boolean; error?: string }> {
  if (!config.clientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  let challengeName = 'EMAIL_OTP';
  let codeKey = 'EMAIL_OTP_CODE';
  if (pendingChallengeName === 'SOFTWARE_TOKEN_MFA') {
    challengeName = 'SOFTWARE_TOKEN_MFA';
    codeKey = 'SOFTWARE_TOKEN_MFA_CODE';
  } else if (pendingChallengeName === 'SMS_MFA') {
    challengeName = 'SMS_MFA';
    codeKey = 'SMS_MFA_CODE';
  }

  try {
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
      },
      body: JSON.stringify({
        ChallengeName: challengeName,
        ClientId: config.clientId,
        ChallengeResponses: {
          [codeKey]: code,
          USERNAME: pendingEmail,
        },
        Session: session,
      }),
    });

    const data = await response.json();

    if (data.AuthenticationResult) {
      const tokens: AuthTokens = {
        idToken: data.AuthenticationResult.IdToken,
        accessToken: data.AuthenticationResult.AccessToken,
        refreshToken: data.AuthenticationResult.RefreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + data.AuthenticationResult.ExpiresIn,
      };
      storeTokens(tokens);
      pendingEmail = '';
      pendingChallengeName = '';
      return { success: true };
    }

    return { success: false, error: data.message || 'MFA verification failed' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Sign up a new user (domain validated by pre-sign-up Lambda trigger) */
export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!config.clientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  try {
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp',
      },
      body: JSON.stringify({
        ClientId: config.clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'given_name', Value: firstName },
          { Name: 'family_name', Value: lastName },
        ],
      }),
    });

    const data = await response.json();

    if (data.UserSub) {
      return { success: true };
    }

    return { success: false, error: data.message || 'Sign up failed' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Confirm sign-up with verification code */
export async function confirmSignUp(
  email: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  if (!config.clientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  try {
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp',
      },
      body: JSON.stringify({
        ClientId: config.clientId,
        Username: email,
        ConfirmationCode: code,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true };
    }

    return { success: false, error: data.message || 'Verification failed' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Sign out */
export function signOut() {
  clearTokens();
}

/** Get Authorization header value */
export function getAuthHeader(): string | null {
  const tokens = getTokens();
  return tokens ? `Bearer ${tokens.idToken}` : null;
}

