/**
 * Cognito Authentication Utilities
 *
 * Uses amazon-cognito-identity-js for SRP (Secure Remote Password) authentication.
 * Password is never sent over the wire — only an SRP proof is exchanged.
 * Tokens are stored in sessionStorage via the library's built-in storage.
 */

import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoIdToken,
  CognitoAccessToken,
  CognitoRefreshToken,
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

// Clean up legacy token key from the pre-SRP implementation
sessionStorage.removeItem('vantage-auth-tokens');

// Pending CognitoUser for multi-step auth flows (new password → MFA)
let pendingUser: CognitoUser | null = null;

// ── JWT Decode ──

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
}

// ── Raw Cognito API (for EMAIL_OTP — not supported by the library) ──

async function cognitoFetch(target: string, body: Record<string, unknown>): Promise<any> {
  const endpoint = `https://cognito-idp.${POOL_CONFIG.region}.amazonaws.com/`;
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
  // amazon-cognito-identity-js errors use .code; raw API responses use .__type
  const code = err?.code || err?.name || err?.__type?.split('#').pop() || '';
  if (COGNITO_ERROR_MAP[code]) return COGNITO_ERROR_MAP[code];
  return fallback;
}

// ── Token Helpers ──

function extractTokens(session: CognitoUserSession): AuthTokens {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: session.getAccessToken().getExpiration(),
  };
}

/** Build a CognitoUserSession from a raw AuthenticationResult and cache it on the user */
function cacheSession(cognitoUser: CognitoUser, authResult: any): void {
  const session = new CognitoUserSession({
    IdToken: new CognitoIdToken({ IdToken: authResult.IdToken }),
    AccessToken: new CognitoAccessToken({ AccessToken: authResult.AccessToken }),
    RefreshToken: new CognitoRefreshToken({ RefreshToken: authResult.RefreshToken }),
  });
  cognitoUser.setSignInUserSession(session); // also writes to sessionStorage
}

// ── Synchronous Token Access ──
// Reads directly from sessionStorage using the library's key format,
// since pool.getCurrentUser().getSignInUserSession() requires an async getSession() first.

export function getTokens(): AuthTokens | null {
  const clientId = POOL_CONFIG.ClientId;
  if (!clientId) return null;

  const lastUser = sessionStorage.getItem(
    `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`,
  );
  if (!lastUser) return null;

  const prefix = `CognitoIdentityServiceProvider.${clientId}.${lastUser}`;
  const idToken = sessionStorage.getItem(`${prefix}.idToken`);
  const accessToken = sessionStorage.getItem(`${prefix}.accessToken`);
  const refreshToken = sessionStorage.getItem(`${prefix}.refreshToken`);

  if (!idToken || !accessToken) return null;

  try {
    const payload = decodeJwtPayload(accessToken);
    const exp = payload.exp as number;
    // 5-minute buffer before expiry
    if (Date.now() / 1000 > exp - 300) return null;
    return { idToken, accessToken, refreshToken: refreshToken || '', expiresAt: exp };
  } catch {
    return null;
  }
}

/** Get current user from the ID token in sessionStorage */
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

/** Check if user is authenticated (synchronous) */
export function isAuthenticated(): boolean {
  return getTokens() !== null;
}

/** Auth header for API calls */
export function getAuthHeader(): string | null {
  const tokens = getTokens();
  return tokens ? `Bearer ${tokens.idToken}` : null;
}

// ── Async Token Access (auto-refreshes expired tokens) ──

export async function getTokensAsync(): Promise<AuthTokens | null> {
  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) return null;

  return new Promise((resolve) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(extractTokens(session));
    });
  });
}

// ── Sign In (SRP) ──

export async function signIn(email: string, password: string): Promise<{
  success: boolean;
  mfaRequired?: boolean;
  newPasswordRequired?: boolean;
  session?: string;
  challengeName?: string;
  error?: string;
}> {
  if (!POOL_CONFIG.UserPoolId || !POOL_CONFIG.ClientId) {
    return { success: false, error: 'Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.' };
  }

  const pool = getUserPool();
  const cognitoUser = new CognitoUser({
    Username: email,
    Pool: pool,
    Storage: sessionStorage,
  });
  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  });

  return new Promise((resolve) => {
    try {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: () => {
          // HIPAA: MFA is mandatory — reject direct auth without MFA challenge.
          console.error('MFA bypass detected: Cognito returned tokens without MFA challenge.');
          cognitoUser.signOut();
          resolve({ success: false, error: 'MFA is required but was not enforced. Please contact your administrator.' });
        },

        onFailure: (err) => {
          // The library doesn't handle EMAIL_OTP natively — it lands here.
          // Detect it from the CognitoUser's internal state (set before the default case).
          const challenge = (cognitoUser as any).challengeName;
          if (challenge === 'EMAIL_OTP') {
            pendingUser = cognitoUser;
            resolve({
              success: false,
              mfaRequired: true,
              session: (cognitoUser as any).Session as string,
              challengeName: 'EMAIL_OTP',
            });
            return;
          }
          resolve({ success: false, error: sanitizeError(err, 'Sign-in failed. Please check your email and password.') });
        },

        newPasswordRequired: () => {
          pendingUser = cognitoUser;
          resolve({
            success: false,
            newPasswordRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: 'NEW_PASSWORD_REQUIRED',
          });
        },

        mfaRequired: (challengeName) => {
          pendingUser = cognitoUser;
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: challengeName || 'SMS_MFA',
          });
        },

        totpRequired: () => {
          pendingUser = cognitoUser;
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: 'SOFTWARE_TOKEN_MFA',
          });
        },

        customChallenge: () => {
          // Some Cognito configurations route EMAIL_OTP through CUSTOM_CHALLENGE
          pendingUser = cognitoUser;
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: (cognitoUser as any).challengeName || 'CUSTOM_CHALLENGE',
          });
        },
      });
    } catch {
      resolve({ success: false, error: 'Unable to connect to the server. Please check your connection and try again.' });
    }
  });
}

// ── Complete NEW_PASSWORD_REQUIRED Challenge ──

export async function completeNewPasswordChallenge(
  _email: string,
  newPassword: string,
  _session: string,
): Promise<{ success: boolean; mfaRequired?: boolean; session?: string; challengeName?: string; error?: string }> {
  if (!pendingUser) {
    return { success: false, error: 'No pending authentication session.' };
  }

  const cognitoUser = pendingUser;

  return new Promise((resolve) => {
    try {
      cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: () => {
          // HIPAA: MFA is mandatory after password change too.
          console.error('MFA bypass detected: Cognito returned tokens without MFA challenge after password change.');
          cognitoUser.signOut();
          pendingUser = null;
          resolve({ success: false, error: 'MFA is required but was not enforced. Please contact your administrator.' });
        },

        onFailure: (err) => {
          // Check for EMAIL_OTP (not handled natively by the library)
          const challenge = (cognitoUser as any).challengeName;
          if (challenge === 'EMAIL_OTP') {
            resolve({
              success: false,
              mfaRequired: true,
              session: (cognitoUser as any).Session as string,
              challengeName: 'EMAIL_OTP',
            });
            return;
          }
          resolve({ success: false, error: sanitizeError(err, 'Failed to set new password. Please ensure it meets the requirements.') });
        },

        mfaRequired: (challengeName) => {
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: challengeName || 'SMS_MFA',
          });
        },

        totpRequired: () => {
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: 'SOFTWARE_TOKEN_MFA',
          });
        },

        customChallenge: () => {
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: (cognitoUser as any).challengeName || 'CUSTOM_CHALLENGE',
          });
        },

        mfaSetup: () => {
          resolve({
            success: false,
            mfaRequired: true,
            session: (cognitoUser as any).Session as string,
            challengeName: 'MFA_SETUP',
          });
        },
      });
    } catch {
      resolve({ success: false, error: 'Unable to connect to the server. Please check your connection and try again.' });
    }
  });
}

// ── Complete MFA Challenge ──

export async function completeMfaChallenge(
  email: string,
  code: string,
  session: string,
  challengeName: string,
): Promise<{ success: boolean; error?: string }> {
  // EMAIL_OTP: the library doesn't support this challenge type, so use the raw API.
  // The SRP password exchange is already complete at this point — only the OTP code is sent.
  if (challengeName === 'EMAIL_OTP') {
    try {
      const data = await cognitoFetch('RespondToAuthChallenge', {
        ChallengeName: 'EMAIL_OTP',
        ClientId: POOL_CONFIG.ClientId,
        ChallengeResponses: {
          EMAIL_OTP_CODE: code,
          USERNAME: email,
        },
        Session: session,
      });

      if (data.AuthenticationResult) {
        if (pendingUser) {
          cacheSession(pendingUser, data.AuthenticationResult);
          pendingUser = null;
        }
        return { success: true };
      }

      return { success: false, error: sanitizeError(data, 'Invalid or expired verification code. Please try again.') };
    } catch {
      return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
    }
  }

  // SMS_MFA / SOFTWARE_TOKEN_MFA: use the library's sendMFACode
  if (!pendingUser) {
    return { success: false, error: 'No pending MFA session.' };
  }

  const cognitoUser = pendingUser;
  const mfaType = challengeName === 'SOFTWARE_TOKEN_MFA' ? 'SOFTWARE_TOKEN_MFA' : 'SMS_MFA';

  return new Promise((resolve) => {
    cognitoUser.sendMFACode(
      code,
      {
        onSuccess: () => {
          pendingUser = null;
          resolve({ success: true });
        },
        onFailure: (err) => {
          resolve({ success: false, error: sanitizeError(err, 'Invalid or expired verification code. Please try again.') });
        },
      },
      mfaType,
    );
  });
}

// ── Sign Up ──

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

// ── Confirm Sign Up ──

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
    cognitoUser.confirmRegistration(code, false, (err, result) => {
      if (err) {
        resolve({ success: false, error: sanitizeError(err, 'Email verification failed. Please check the code and try again.') });
        return;
      }
      resolve({ success: true });
    });
  });
}

// ── Change Password ──

export async function changePassword(
  previousPassword: string,
  proposedPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) {
    return { success: false, error: 'Session expired. Please sign in again.' };
  }

  return new Promise((resolve) => {
    // getSession loads + refreshes the session before we attempt the change
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) {
        resolve({ success: false, error: 'Session expired. Please sign in again.' });
        return;
      }
      cognitoUser.changePassword(previousPassword, proposedPassword, (changeErr) => {
        if (changeErr) {
          resolve({ success: false, error: sanitizeError(changeErr, 'Failed to change password. Please check your current password and try again.') });
          return;
        }
        resolve({ success: true });
      });
    });
  });
}

// ── Sign Out (with server-side revocation) ──

export async function signOut(): Promise<void> {
  pendingUser = null;

  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) return;

  // Try global sign-out to invalidate all tokens server-side (best effort)
  try {
    await new Promise<void>((resolve) => {
      cognitoUser.getSession((err: Error | null) => {
        if (err) {
          resolve();
          return;
        }
        cognitoUser.globalSignOut({
          onSuccess: () => resolve(),
          onFailure: () => resolve(), // best effort
        });
      });
    });
  } catch {
    // Don't block logout
  }

  // Always clear local tokens
  cognitoUser.signOut();
}
