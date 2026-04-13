/**
 * Cognito Authentication Utilities
 *
 * Sign-in uses raw fetch to Cognito's USER_PASSWORD_AUTH flow.
 * This bypasses amazon-cognito-identity-js for sign-in + MFA because
 * the library does not support EMAIL_OTP challenges natively.
 *
 * The library is still used for signUp, confirmSignUp, changePassword,
 * and signOut where it works correctly.
 */

import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

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

// ── Configuration ──

const POOL_CONFIG = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
};

const COGNITO_ENDPOINT = `https://cognito-idp.${POOL_CONFIG.region}.amazonaws.com/`;

let _userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool {
  if (!_userPool) {
    _userPool = new CognitoUserPool({
      UserPoolId: POOL_CONFIG.UserPoolId,
      ClientId: POOL_CONFIG.ClientId,
      Storage: sessionStorage,
    });
  }
  return _userPool;
}

// Clean up legacy token key
sessionStorage.removeItem('vantage-auth-tokens');

// ── Pending MFA session (module-level, survives React re-renders) ──

let _pendingSession: string | null = null;
let _pendingUsername: string | null = null;
let _pendingSessionCreatedAt = 0;

const SESSION_TTL_MS = 3 * 60 * 1000; // 3 minutes

function setPendingSession(session: string, username: string): void {
  _pendingSession = session;
  _pendingUsername = username;
  _pendingSessionCreatedAt = Date.now();
}

function getPendingSession(): { session: string | null; username: string | null } {
  if (!_pendingSession || Date.now() - _pendingSessionCreatedAt > SESSION_TTL_MS) {
    return { session: null, username: null };
  }
  return { session: _pendingSession, username: _pendingUsername };
}

export function clearPendingSession(): void {
  _pendingSession = null;
  _pendingUsername = null;
  _pendingSessionCreatedAt = 0;
}

// Backward-compatible exports used by AuthProvider
export const getPendingUser = () => _pendingSession ? true : null;
export const clearPendingUser = clearPendingSession;

// ── Raw Cognito API helper ──

async function cognitoFetch(target: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`[auth] ${target} failed:`, {
      status: response.status,
      code: data?.__type,
      message: data?.message,
    });
    const code = data?.__type?.split('#').pop() || '';
    const mapped = COGNITO_ERROR_MAP[code];
    throw new Error(mapped || data?.message || `Request failed (${response.status})`);
  }

  return data;
}

// ── JWT Decode ──

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
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
  InvalidParameterException: 'Invalid input. Please check your entries and try again.',
  TooManyRequestsException: 'Too many requests. Please wait a moment and try again.',
  UsernameExistsException: 'An account with this email already exists. Please sign in instead.',
  AliasExistsException: 'An account with this email already exists.',
  UserLambdaValidationException: 'Account creation is restricted to @vantagerefinery.com and @amplefi.com emails.',
  PasswordResetRequiredException: 'Password reset required. Please contact your administrator.',
  EnableSoftwareTokenMFAException: 'MFA setup failed. Please contact your administrator.',
  CodeDeliveryFailureException: 'Unable to send verification code. Please try again later.',
};

function sanitizeError(err: any, fallback: string): string {
  const code = err?.code || err?.name || err?.__type?.split('#').pop() || '';
  if (COGNITO_ERROR_MAP[code]) return COGNITO_ERROR_MAP[code];
  return fallback;
}

// ── Token Storage ──
// Store tokens in sessionStorage using a simple key prefix.
// Also store in the library's key format so getCurrentUser/signOut still work.

const TOKEN_PREFIX = 'vantage_auth';

function storeTokens(tokens: { IdToken: string; AccessToken: string; RefreshToken: string }, username: string): void {
  sessionStorage.setItem(`${TOKEN_PREFIX}.idToken`, tokens.IdToken);
  sessionStorage.setItem(`${TOKEN_PREFIX}.accessToken`, tokens.AccessToken);
  sessionStorage.setItem(`${TOKEN_PREFIX}.refreshToken`, tokens.RefreshToken);

  // Also store in library format so CognitoUserPool.getCurrentUser() works for signOut/changePassword
  const clientId = POOL_CONFIG.ClientId;
  const prefix = `CognitoIdentityServiceProvider.${clientId}.${username}`;
  sessionStorage.setItem(`${prefix}.idToken`, tokens.IdToken);
  sessionStorage.setItem(`${prefix}.accessToken`, tokens.AccessToken);
  sessionStorage.setItem(`${prefix}.refreshToken`, tokens.RefreshToken);
  sessionStorage.setItem(`CognitoIdentityServiceProvider.${clientId}.LastAuthUser`, username);
}

function clearStoredTokens(): void {
  sessionStorage.removeItem(`${TOKEN_PREFIX}.idToken`);
  sessionStorage.removeItem(`${TOKEN_PREFIX}.accessToken`);
  sessionStorage.removeItem(`${TOKEN_PREFIX}.refreshToken`);
}

// ── Synchronous Token Access ──

export function getTokens(): AuthTokens | null {
  // Try our own keys first, then fall back to library keys
  let idToken = sessionStorage.getItem(`${TOKEN_PREFIX}.idToken`);
  let accessToken = sessionStorage.getItem(`${TOKEN_PREFIX}.accessToken`);
  let refreshToken = sessionStorage.getItem(`${TOKEN_PREFIX}.refreshToken`);

  if (!idToken || !accessToken) {
    // Fallback: library key format
    const clientId = POOL_CONFIG.ClientId;
    if (!clientId) return null;
    const lastUser = sessionStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.LastAuthUser`);
    if (!lastUser) return null;
    const prefix = `CognitoIdentityServiceProvider.${clientId}.${lastUser}`;
    idToken = sessionStorage.getItem(`${prefix}.idToken`);
    accessToken = sessionStorage.getItem(`${prefix}.accessToken`);
    refreshToken = sessionStorage.getItem(`${prefix}.refreshToken`);
  }

  if (!idToken || !accessToken) return null;

  try {
    const payload = decodeJwtPayload(accessToken);
    const exp = payload.exp as number;
    if (Date.now() / 1000 > exp - 300) return null;
    return { idToken, accessToken, refreshToken: refreshToken || '', expiresAt: exp };
  } catch {
    return null;
  }
}

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

export function isAuthenticated(): boolean {
  return getTokens() !== null;
}

export function getAuthHeader(): string | null {
  const tokens = getTokens();
  return tokens ? `Bearer ${tokens.idToken}` : null;
}

// ── Async Token Access (refresh via library if possible, else return stored) ──

export async function getTokensAsync(): Promise<AuthTokens | null> {
  // Try library-based refresh first
  const cognitoUser = getUserPool().getCurrentUser();
  if (cognitoUser) {
    try {
      const session = await new Promise<CognitoUserSession | null>((resolve) => {
        cognitoUser.getSession((err: Error | null, s: CognitoUserSession | null) => {
          if (err || !s || !s.isValid()) resolve(null);
          else resolve(s);
        });
      });
      if (session) {
        return {
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
          expiresAt: session.getAccessToken().getExpiration(),
        };
      }
    } catch {
      // Fall through to stored tokens
    }
  }
  return getTokens();
}

// ── Sign In Result ──

export interface SignInResult {
  type: 'SUCCESS' | 'MFA_REQUIRED' | 'NEW_PASSWORD_REQUIRED' | 'ERROR';
  error?: string;
  challengeName?: string;
}

// ── Sign In (USER_PASSWORD_AUTH + EMAIL_OTP) ──

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!POOL_CONFIG.ClientId) {
    return { type: 'ERROR', error: 'Cognito is not configured.' };
  }

  try {
    const data = await cognitoFetch('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: POOL_CONFIG.ClientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    // MFA challenge returned
    if (data.ChallengeName === 'EMAIL_OTP') {
      const username = data.ChallengeParameters?.USERNAME ?? email;
      setPendingSession(data.Session, username);
      console.log('[auth] EMAIL_OTP challenge received, session length:', data.Session?.length);
      return { type: 'MFA_REQUIRED', challengeName: 'EMAIL_OTP' };
    }

    if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      const username = data.ChallengeParameters?.USERNAME ?? email;
      setPendingSession(data.Session, username);
      return { type: 'NEW_PASSWORD_REQUIRED' };
    }

    if (data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      const username = data.ChallengeParameters?.USERNAME ?? email;
      setPendingSession(data.Session, username);
      return { type: 'MFA_REQUIRED', challengeName: data.ChallengeName };
    }

    // Direct success (no MFA) — shouldn't happen with MFA=REQUIRED
    if (data.AuthenticationResult) {
      storeTokens(data.AuthenticationResult, email);
      return { type: 'SUCCESS' };
    }

    // Unknown challenge
    if (data.ChallengeName) {
      const username = data.ChallengeParameters?.USERNAME ?? email;
      setPendingSession(data.Session, username);
      return { type: 'MFA_REQUIRED', challengeName: data.ChallengeName };
    }

    return { type: 'ERROR', error: 'Unexpected authentication response.' };
  } catch (err: any) {
    return { type: 'ERROR', error: err.message || 'Sign-in failed.' };
  }
}

// ── Complete NEW_PASSWORD_REQUIRED Challenge ──

export async function completeNewPasswordChallenge(
  _email: string,
  newPassword: string,
  _session: string,
): Promise<SignInResult> {
  const { session, username } = getPendingSession();
  if (!session || !username) {
    return { type: 'ERROR', error: 'Session expired \u2014 please sign in again.' };
  }

  try {
    const data = await cognitoFetch('RespondToAuthChallenge', {
      ClientId: POOL_CONFIG.ClientId,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
      },
    });

    if (data.ChallengeName === 'EMAIL_OTP') {
      setPendingSession(data.Session, data.ChallengeParameters?.USERNAME ?? username);
      return { type: 'MFA_REQUIRED', challengeName: 'EMAIL_OTP' };
    }

    if (data.AuthenticationResult) {
      storeTokens(data.AuthenticationResult, username);
      clearPendingSession();
      return { type: 'SUCCESS' };
    }

    if (data.ChallengeName) {
      setPendingSession(data.Session, data.ChallengeParameters?.USERNAME ?? username);
      return { type: 'MFA_REQUIRED', challengeName: data.ChallengeName };
    }

    return { type: 'ERROR', error: 'Unexpected response.' };
  } catch (err: any) {
    return { type: 'ERROR', error: err.message || 'Failed to set new password.' };
  }
}

// ── Complete MFA Challenge (EMAIL_OTP) ──

export async function completeMfaChallenge(
  _email: string,
  code: string,
  _session: string,
  challengeName: string,
): Promise<{ success: boolean; error?: string }> {
  const { session, username } = getPendingSession();
  if (!session || !username) {
    return { success: false, error: 'Session expired \u2014 please sign in again.' };
  }

  try {
    const data = await cognitoFetch('RespondToAuthChallenge', {
      ClientId: POOL_CONFIG.ClientId,
      ChallengeName: challengeName === 'EMAIL_OTP' ? 'EMAIL_OTP' : challengeName,
      Session: session,
      ChallengeResponses: {
        ...(challengeName === 'EMAIL_OTP' ? { EMAIL_OTP_CODE: code } : { SMS_MFA_CODE: code }),
        USERNAME: username,
      },
    });

    if (data.AuthenticationResult) {
      storeTokens(data.AuthenticationResult, username);
      clearPendingSession();
      return { success: true };
    }

    return { success: false, error: 'Verification failed. Please try again.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Incorrect code \u2014 please try again.' };
  }
}

// ── Sign Up (uses library) ──

export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!POOL_CONFIG.UserPoolId || !POOL_CONFIG.ClientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  const pool = getUserPool();
  const attributes = [
    new CognitoUserAttribute({ Name: 'email', Value: email }),
    new CognitoUserAttribute({ Name: 'given_name', Value: firstName }),
    new CognitoUserAttribute({ Name: 'family_name', Value: lastName }),
  ];

  return new Promise((resolve) => {
    pool.signUp(email, password, attributes, [], (err, result) => {
      if (err) {
        resolve({ success: false, error: sanitizeError(err, 'Registration failed. Please check your details and try again.') });
        return;
      }
      if (result?.userSub) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: 'Registration failed. Please try again.' });
      }
    });
  });
}

// ── Confirm Sign Up (uses library) ──

export async function confirmSignUp(
  email: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  if (!POOL_CONFIG.UserPoolId || !POOL_CONFIG.ClientId) {
    return { success: false, error: 'Cognito is not configured.' };
  }

  const pool = getUserPool();
  const cognitoUser = new CognitoUser({
    Username: email,
    Pool: pool,
    Storage: sessionStorage,
  });

  return new Promise((resolve) => {
    cognitoUser.confirmRegistration(code, false, (err) => {
      if (err) {
        resolve({ success: false, error: sanitizeError(err, 'Email verification failed. Please check the code and try again.') });
        return;
      }
      resolve({ success: true });
    });
  });
}

// ── Change Password (uses library) ──

export async function changePassword(
  previousPassword: string,
  proposedPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) {
    return { success: false, error: 'Session expired. Please sign in again.' };
  }

  return new Promise((resolve) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        resolve({ success: false, error: 'Session expired. Please sign in again.' });
        return;
      }
      cognitoUser.changePassword(previousPassword, proposedPassword, (changeErr) => {
        if (changeErr) {
          resolve({ success: false, error: sanitizeError(changeErr, 'Failed to change password.') });
          return;
        }
        resolve({ success: true });
      });
    });
  });
}

// ── Custom Password Reset (replaces Cognito ForgotPassword which conflicts with EMAIL_OTP MFA) ──
// These call our own API which uses SES + DynamoDB + AdminSetUserPassword.

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined || '').replace(/\/$/, '');

async function resetApiCall(path: string, body: Record<string, string>): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { success: true };
    const data = await res.json().catch(() => ({}));
    return { success: false, error: (data as any).error || `Request failed (${res.status})` };
  } catch {
    return { success: false, error: 'Unable to reach the server. Please check your connection.' };
  }
}

export async function forgotPassword(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  return resetApiCall('/auth/forgot-password', { email });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  return resetApiCall('/auth/confirm-forgot-password', { email, code, newPassword });
}

// ── Sign Out ──

export async function signOut(): Promise<void> {
  clearPendingSession();
  clearStoredTokens();

  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) return;

  try {
    await new Promise<void>((resolve) => {
      cognitoUser.getSession((err: Error | null) => {
        if (err) { resolve(); return; }
        cognitoUser.globalSignOut({
          onSuccess: () => resolve(),
          onFailure: () => resolve(),
        });
      });
    });
  } catch {
    // Don't block logout
  }

  cognitoUser.signOut();
}
