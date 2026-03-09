import type { APIGatewayProxyEvent } from 'aws-lambda';
import { setRequestOrigin } from './response';

export interface CallerIdentity {
  sub: string;          // Cognito user sub (UUID)
  email: string;
  providerId: string;   // custom:provider_id
  role: string;         // custom:role (provider | admin)
  groups: string[];     // Cognito groups
}

/**
 * Extract caller identity from Cognito-authorized API Gateway event.
 * The authorizer populates claims in event.requestContext.authorizer.claims.
 */
export function getCallerIdentity(event: APIGatewayProxyEvent): CallerIdentity {
  // Set CORS origin for response helpers (reads Origin header from the request)
  setRequestOrigin(event.headers?.origin || event.headers?.Origin);

  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    throw new Error('No authorizer claims found');
  }

  return {
    sub: claims.sub,
    email: claims.email,
    providerId: claims['custom:provider_id'] || claims.sub,
    role: claims['custom:role'] || 'provider',
    groups: (claims['cognito:groups'] || '').split(',').filter(Boolean),
  };
}

/**
 * Check if caller can access a given provider's data.
 * All authenticated staff can access all data (shared clinic).
 */
export function canAccessProvider(_caller: CallerIdentity, _targetProviderId: string): boolean {
  return true;
}
