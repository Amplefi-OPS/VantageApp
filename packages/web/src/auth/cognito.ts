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

// ── Pending auth state (module-level, survives React re-renders) ──
// Only store the CognitoUser object and the username.
// Session is always read live from (pendingCognitoUser as any).Session
// because the library sets it internally and a stale copy will be empty.

let pendingCognitoUser: CognitoUser | null = null;
let pendingUsername: string | null = null;
let pendingUserCreatedAt: number = 0;

const MFA_SESSION_TTL_MS = 3 * 60 * 1000; // 3 minutes

function setPendingAuth(user: CognitoUser | null, username?: string): void {
  pendingCognitoUser = user;
  pendingUsername = username ?? (user ? user.getUsername() : null);
  pendingUserCreatedAt = user ? Date.now() : 0;
}

export function getPendingUser(): CognitoUser | null {
  if (!pendingCognitoUser) return null;
  if (Date.now() - pendingUserCreatedAt > MFA_SESSION_TTL_MS) {
    setPendingAuth(null);
    return null;
  }
  return pendingCognitoUser;
}

export function clearPendingUser(): void {
  setPendingAuth(null);
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

// ── Token Helpers ──

function extractTokens(session: CognitoUserSession): AuthTokens {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: session.getAccessToken().getExpiration(),
  };
}

// ── Synchronous Token Access ──

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

// ── Sign In Result ──

export interface SignInResult {
  type: 'SUCCESS' | 'MFA_REQUIRED' | 'NEW_PASSWORD_REQUIRED' | 'ERROR';
  error?: string;
  challengeName?: string;
}

// ── Sign In (SRP) ──

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!POOL_CONFIG.UserPoolId || !POOL_CONFIG.ClientId) {
    return { type: 'ERROR', error: 'Cognito is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.' };
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
          // With MFA set to REQUIRED this should never happen.
          // Resolve with error — never reject or reload.
          console.warn('[auth] MFA bypass: tokens returned without MFA challenge.');
          resolve({ type: 'ERROR', error: 'Authentication error \u2014 please try again.' });
        },

        onFailure: (err) => {
          // The library doesn't handle EMAIL_OTP natively — it may land here
          // for unknown challenge types. Check CognitoUser internal state.
          const challenge = (cognitoUser as any).challengeName;
          if (challenge === 'EMAIL_OTP' || challenge === 'CUSTOM_CHALLENGE') {
            setPendingAuth(cognitoUser, email);
            console.log('[auth] onFailure EMAIL_OTP detected, session length:',
              (cognitoUser as any).Session?.length ?? 'MISSING');
            resolve({ type: 'MFA_REQUIRED', challengeName: 'EMAIL_OTP' });
            return;
          }
          resolve({ type: 'ERROR', error: sanitizeError(err, 'Sign-in failed. Please check your email and password.') });
        },

        newPasswordRequired: () => {
          setPendingAuth(cognitoUser, email);
          resolve({ type: 'NEW_PASSWORD_REQUIRED' });
        },

        mfaRequired: (challengeName) => {
          setPendingAuth(cognitoUser, email);
          resolve({ type: 'MFA_REQUIRED', challengeName: challengeName || 'SMS_MFA' });
        },

        totpRequired: () => {
          setPendingAuth(cognitoUser, email);
          resolve({ type: 'MFA_REQUIRED', challengeName: 'SOFTWARE_TOKEN_MFA' });
        },

        customChallenge: (challengeParameters) => {
          // EMAIL_OTP with ALLOW_CUSTOM_AUTH routes here.
          // The library stores the session on cognitoUser.Session (capital S)
          // BEFORE calling this callback — read it live, never copy.
          setPendingAuth(cognitoUser, email);
          console.log('[auth] customChallenge fired:', {
            challengeParameters,
            challengeName: (cognitoUser as any).challengeName,
            sessionLength: (cognitoUser as any).Session?.length ?? 'MISSING',
          });
          resolve({ type: 'MFA_REQUIRED', challengeName: 'EMAIL_OTP' });
        },
      });
    } catch (err) {
      resolve({ type: 'ERROR', error: 'Unable to connect to the server. Please check your connection and try again.' });
    }
  });
}

// ── Complete NEW_PASSWORD_REQUIRED Challenge ──

export async function completeNewPasswordChallenge(
  _email: string,
  newPassword: string,
  _session: string,
): Promise<SignInResult> {
  const cognitoUser = getPendingUser();
  if (!cognitoUser) {
    return { type: 'ERROR', error: 'Session expired \u2014 please sign in again.' };
  }

  return new Promise((resolve) => {
    try {
      cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: () => {
          console.warn('[auth] MFA bypass after password change.');
          resolve({ type: 'ERROR', error: 'Authentication error \u2014 please try again.' });
        },

        onFailure: (err: any) => {
          const challenge = (cognitoUser as any).challengeName;
          if (challenge === 'EMAIL_OTP' || challenge === 'CUSTOM_CHALLENGE') {
            resolve({ type: 'MFA_REQUIRED', challengeName: 'EMAIL_OTP' });
            return;
          }
          resolve({ type: 'ERROR', error: sanitizeError(err, 'Failed to set new password.') });
        },

        mfaRequired: (cn: any) => {
          resolve({ type: 'MFA_REQUIRED', challengeName: cn || 'SMS_MFA' });
        },

        totpRequired: () => {
          resolve({ type: 'MFA_REQUIRED', challengeName: 'SOFTWARE_TOKEN_MFA' });
        },

        customChallenge: () => {
          resolve({ type: 'MFA_REQUIRED', challengeName: 'EMAIL_OTP' });
        },

        mfaSetup: () => {
          resolve({ type: 'MFA_REQUIRED', challengeName: 'MFA_SETUP' });
        },
      });
    } catch {
      resolve({ type: 'ERROR', error: 'Unable to connect to the server. Please check your connection and try again.' });
    }
  });
}

// ── Complete MFA Challenge ──

export async function completeMfaChallenge(
  _email: string,
  code: string,
  _session: string,
  challengeName: string,
): Promise<{ success: boolean; error?: string }> {
  const cognitoUser = getPendingUser();
  if (!cognitoUser) {
    return { success: false, error: 'Session expired \u2014 please sign in again.' };
  }

  // EMAIL_OTP: use raw RespondToAuthChallenge with ChallengeName 'EMAIL_OTP'.
  // The library's sendCustomChallengeAnswer sends 'CUSTOM_CHALLENGE' which Cognito rejects.
  if (challengeName === 'EMAIL_OTP' || challengeName === 'CUSTOM_CHALLENGE') {
    // Read session directly from the live CognitoUser object — never from a stale copy.
    const session = (cognitoUser as any).Session as string;
    const username = (cognitoUser as any).username as string || pendingUsername || '';

    if (!session || session.length < 20) {
      console.error('[auth] Session missing or too short:', {
        sessionLength: session?.length ?? 0,
        username,
      });
      return { success: false, error: 'Session expired \u2014 please sign in again.' };
    }

    try {
      const endpoint = `https://cognito-idp.${POOL_CONFIG.region}.amazonaws.com/`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
        },
        body: JSON.stringify({
          ClientId: POOL_CONFIG.ClientId,
          ChallengeName: 'EMAIL_OTP',
          Session: session,
          ChallengeResponses: {
            EMAIL_OTP_CODE: code,
            USERNAME: username,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error('[auth] EMAIL_OTP challenge failed:', {
          status: response.status,
          code: err?.__type || err?.code,
          message: err?.message,
        });
        const errCode = err?.__type?.split('#').pop() || '';
        const errMsg = COGNITO_ERROR_MAP[errCode] || err?.message || 'Incorrect code \u2014 please try again.';
        return { success: false, error: errMsg };
      }

      const data = await response.json();

      if (data.AuthenticationResult) {
        // Cache tokens on the CognitoUser so the library's session state is consistent
        const userSession = new CognitoUserSession({
          IdToken: new CognitoIdToken({ IdToken: data.AuthenticationResult.IdToken }),
          AccessToken: new CognitoAccessToken({ AccessToken: data.AuthenticationResult.AccessToken }),
          RefreshToken: new CognitoRefreshToken({ RefreshToken: data.AuthenticationResult.RefreshToken }),
        });
        cognitoUser.setSignInUserSession(userSession);
        setPendingAuth(null);
        return { success: true };
      }

      return { success: false, error: 'Verification failed. Please try again.' };
    } catch {
      return { success: false, error: 'Unable to connect to the server. Please check your connection and try again.' };
    }
  }

  // SMS_MFA / SOFTWARE_TOKEN_MFA: use the library's sendMFACode
  const mfaType = challengeName === 'SOFTWARE_TOKEN_MFA' ? 'SOFTWARE_TOKEN_MFA' : 'SMS_MFA';

  return new Promise((resolve) => {
    cognitoUser.sendMFACode(
      code,
      {
        onSuccess: () => {
          setPendingAuth(null);
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
    cognitoUser.confirmRegistration(code, false, (err) => {
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
  clearPendingUser();

  const cognitoUser = getUserPool().getCurrentUser();
  if (!cognitoUser) return;

  try {
    await new Promise<void>((resolve) => {
      cognitoUser.getSession((err: Error | null) => {
        if (err) {
          resolve();
          return;
        }
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
