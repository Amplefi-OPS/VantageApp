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
    return {
      sub: claims.sub as string,
      email: claims.email as string,
      givenName: (claims.given_name as string) || '',
      familyName: (claims.family_name as string) || '',
      providerId: (claims['custom:provider_id'] as string) || (claims.sub as string),
      role: (claims['custom:role'] as string) || 'provider',
      groups: ((claims['cognito:groups'] as string) || '').split(',').filter(Boolean),
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
  session?: string;
  error?: string;
}> {
  if (!config.userPoolId || !config.clientId) {
    return { success: false, error: 'Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.' };
  }

  // Production: Use Cognito InitiateAuth API
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

    if (data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
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

/** Complete MFA challenge */
export async function completeMfaChallenge(
  code: string,
  session: string,
): Promise<{ success: boolean; error?: string }> {
  if (!config.userPoolId || !config.clientId) {
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
        ChallengeName: 'SMS_MFA',
        ClientId: config.clientId,
        ChallengeResponses: {
          SMS_MFA_CODE: code,
          USERNAME: getCurrentUser()?.email || '',
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
      return { success: true };
    }

    return { success: false, error: data.message || 'MFA verification failed' };
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

