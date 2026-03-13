/**
 * Cognito Authentication Utilities
 *
 * Direct Cognito API calls via fetch (no Amplify dependency).
 * Uses USER_PASSWORD_AUTH — switch to USER_SRP_AUTH with
 * amazon-cognito-identity-js for production SRP support.
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
  expiresAt: number; // Unix seconds
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

// ── Token Storage ──

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

// ── JWT Decode ──

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
}

// ── Cognito API Helper ──

async function cognitoFetch(target: string, body: Record<string, unknown>): Promise<any> {
  const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

// ── Error Message Sanitization ──

const COGNITO_ERROR_MAP: Record<string, string> = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UserNotConfirmedException: 'Please verify your email before signing in.',
  CodeMismatchException: 'Invalid verification code. Please check and try again.',
  ExpiredCodeException: 'Verification code has expired. Please request a new one.',
  LimitExceededException: 'Too many attempts. Please wait a few minutes before trying again.',
  InvalidPasswordException: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.',
  UsernameExistsException: 'An account with this email already exists. Please sign in instead.',
  InvalidParameterException: 'Invalid input. Please check your entries and try again.',
  TooManyRequestsException: 'Too many requests. Please wait a moment and try again.',
  UserLambdaValidationException: 'Account creation is restricted to @vantagerefinery.com and @amplefi.com emails.',
  PasswordResetRequiredException: 'Password reset required. Please contact your administrator.',
  AliasExistsException: 'An account with this email already exists.',
  EnableSoftwareTokenMFAException: 'MFA setup failed. Please contact your administrator.',
  CodeDeliveryFailureException: 'Unable to send verification code. Please try again later.',
};

function sanitizeError(data: any, fallback: string): string {
  const code = data?.__type?.split('#').pop() || '';
  if (COGNITO_ERROR_MAP[code]) return COGNITO_ERROR_MAP[code];
  // For unmapped errors, provide the fallback — never expose raw Cognito messages
  return fallback;
}

// ── Token Refresh ──

let refreshInProgress: Promise<AuthTokens | null> | null = null;

async function refreshTokens(refreshToken: string): Promise<AuthTokens | null> {
  try {
    const data = await cognitoFetch('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    if (data.AuthenticationResult) {
      const tokens: AuthTokens = {
        idToken: data.AuthenticationResult.IdToken,
        accessToken: data.AuthenticationResult.AccessToken,
        // Refresh token is NOT returned on refresh — keep the existing one
        refreshToken: refreshToken,
        expiresAt: Math.floor(Date.now() / 1000) + data.AuthenticationResult.ExpiresIn,
      };
      storeTokens(tokens);
      return tokens;
    }
    return null;
  } catch {
    return null;
  }
}

/** Get current auth tokens, auto-refreshing if expired */
export async function getTokensAsync(): Promise<AuthTokens | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Check if expired (with 5-min buffer). expiresAt is Unix seconds.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds < tokens.expiresAt - 300) {
    return tokens; // Still valid
  }

  // Token expired or about to expire — try refresh
  if (tokens.refreshToken) {
    // Deduplicate concurrent refresh calls
    if (!refreshInProgress) {
      refreshInProgress = refreshTokens(tokens.refreshToken).finally(() => {
        refreshInProgress = null;
      });
    }
    const refreshed = await refreshInProgress;
    if (refreshed) return refreshed;
  }

  // Refresh failed — session is dead
  clearTokens();
  return null;
}

/** Synchronous token check (for immediate use, no refresh) */
export function getTokens(): AuthTokens | null {
  const tokens = loadTokens();
  if (!tokens) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds > tokens.expiresAt - 300) {
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

// ── Sign In ──

export async function signIn(email: string, password: string): Promise<{
  success: boolean;
  mfaRequired?: boolean;
  newPasswordRequired?: boolean;
  session?: string;
  challengeName?: string;
  error?: string;
}> {
  if (!config.userPoolId || !config.clientId) {
    return { success: false, error: 'Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.' };
  }

  try {
    const data = await cognitoFetch('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return {
        success: false,
        newPasswordRequired: true,
        session: data.Session,
        challengeName: data.ChallengeName,
      };
    }

    if (data.ChallengeName === 'EMAIL_OTP' || data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      return {
        success: false,
        mfaRequired: true,
        session: data.Session,
        challengeName: data.ChallengeName,
      };
    }

    if (data.AuthenticationResult) {
      // HIPAA: MFA is mandatory — reject direct authentication without MFA challenge.
      // Only completeMfaChallenge() is allowed to store tokens and complete login.
      console.error('MFA bypass detected: Cognito returned tokens without MFA challenge.');
      return { success: false, error: 'MFA is required but was not enforced. Please contact your administrator.' };
    }

    return { success: false, error: sanitizeError(data, 'Sign-in failed. Please check your email and password.') };
  } catch {
    return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
  }
}

// ── Complete NEW_PASSWORD_REQUIRED Challenge ──

export async function completeNewPasswordChallenge(
  email: string,
  newPassword: string,
  session: string,
): Promise<{ success: boolean; mfaRequired?: boolean; session?: string; challengeName?: string; error?: string }> {
  if (!config.clientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  try {
    const data = await cognitoFetch('RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: config.clientId,
      ChallengeResponses: {
        USERNAME: email,
        NEW_PASSWORD: newPassword,
      },
      Session: session,
    });

    if (data.ChallengeName === 'EMAIL_OTP' || data.ChallengeName === 'MFA_SETUP' || data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      return {
        success: false,
        mfaRequired: true,
        session: data.Session,
        challengeName: data.ChallengeName,
      };
    }

    if (data.AuthenticationResult) {
      // HIPAA: MFA is mandatory — after password change, MFA should still be required.
      // Only completeMfaChallenge() is allowed to store tokens and complete login.
      console.error('MFA bypass detected: Cognito returned tokens without MFA challenge after password change.');
      return { success: false, error: 'MFA is required but was not enforced. Please contact your administrator.' };
    }

    return { success: false, error: sanitizeError(data, 'Failed to set new password. Please ensure it meets the requirements.') };
  } catch {
    return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
  }
}

// ── Complete MFA Challenge ──

export async function completeMfaChallenge(
  email: string,
  code: string,
  session: string,
  challengeName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!config.clientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  let mfaChallengeName = 'EMAIL_OTP';
  let codeKey = 'EMAIL_OTP_CODE';
  if (challengeName === 'SOFTWARE_TOKEN_MFA') {
    mfaChallengeName = 'SOFTWARE_TOKEN_MFA';
    codeKey = 'SOFTWARE_TOKEN_MFA_CODE';
  } else if (challengeName === 'SMS_MFA') {
    mfaChallengeName = 'SMS_MFA';
    codeKey = 'SMS_MFA_CODE';
  }

  try {
    const data = await cognitoFetch('RespondToAuthChallenge', {
      ChallengeName: mfaChallengeName,
      ClientId: config.clientId,
      ChallengeResponses: {
        [codeKey]: code,
        USERNAME: email,
      },
      Session: session,
    });

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

    return { success: false, error: sanitizeError(data, 'Invalid or expired verification code. Please try again.') };
  } catch {
    return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
  }
}

// ── Sign Up ──

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
    const data = await cognitoFetch('SignUp', {
      ClientId: config.clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'given_name', Value: firstName },
        { Name: 'family_name', Value: lastName },
      ],
    });

    if (data.UserSub) {
      return { success: true };
    }

    return { success: false, error: sanitizeError(data, 'Registration failed. Please check your details and try again.') };
  } catch {
    return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
  }
}

// ── Confirm Sign Up ──

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

    return { success: false, error: sanitizeError(data, 'Email verification failed. Please check the code and try again.') };
  } catch {
    return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
  }
}

// ── Change Password ──

export async function changePassword(
  previousPassword: string,
  proposedPassword: string,
): Promise<{ success: boolean; error?: string }> {
  // Use getTokens() (with expiry check) not loadTokens()
  const tokens = getTokens();
  if (!tokens) {
    return { success: false, error: 'Session expired. Please sign in again.' };
  }

  try {
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ChangePassword',
      },
      body: JSON.stringify({
        AccessToken: tokens.accessToken,
        PreviousPassword: previousPassword,
        ProposedPassword: proposedPassword,
      }),
    });

    if (response.ok) {
      return { success: true };
    }

    const data = await response.json();
    return { success: false, error: sanitizeError(data, 'Failed to change password. Please check your current password and try again.') };
  } catch {
    return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
  }
}

// ── Sign Out (with server-side revocation) ──

export async function signOut(): Promise<void> {
  const tokens = loadTokens();

  // Revoke refresh token server-side if available
  if (tokens?.refreshToken && config.clientId) {
    try {
      await cognitoFetch('RevokeToken', {
        Token: tokens.refreshToken,
        ClientId: config.clientId,
      });
    } catch {
      // Best-effort revocation — don't block logout
    }
  }

  // Also call GlobalSignOut to invalidate all tokens for this user
  if (tokens?.accessToken) {
    try {
      await cognitoFetch('GlobalSignOut', {
        AccessToken: tokens.accessToken,
      });
    } catch {
      // Best-effort — don't block logout
    }
  }

  clearTokens();
}

// ── Auth Header ──

export function getAuthHeader(): string | null {
  const tokens = getTokens();
  return tokens ? `Bearer ${tokens.idToken}` : null;
}
