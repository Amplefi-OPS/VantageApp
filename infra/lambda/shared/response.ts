import type { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';

const PROD_ORIGINS = [
  'https://main.dvufomlgdfium.amplifyapp.com',
  'https://providerdev.vantagerefinery.com',
];
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

const STAGE = process.env.STAGE || 'dev';
const ALLOWED_ORIGINS = [...PROD_ORIGINS, ...(STAGE === 'dev' ? DEV_ORIGINS : [])];

function corsOrigin(requestOrigin?: string): string {
  const origin = requestOrigin || _currentOrigin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return PROD_ORIGINS[0];
}

function headersForOrigin(origin?: string) {
  return {
    'Access-Control-Allow-Origin': corsOrigin(origin),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

/**
 * Extract the request origin from an API Gateway event.
 * Call this once at the top of each handler and pass the result to response helpers.
 */
export function getOrigin(event: APIGatewayProxyEvent): string | undefined {
  return event.headers?.origin || event.headers?.Origin;
}

/** Set the request origin for the current invocation. Call once at the top of each handler. */
let _currentOrigin: string | undefined;
export function setRequestOrigin(origin?: string) {
  _currentOrigin = origin;
}

export function success(body: unknown, statusCode = 200, origin?: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: headersForOrigin(origin),
    body: JSON.stringify(body),
  };
}

export function created(body: unknown, origin?: string): APIGatewayProxyResult {
  return success(body, 201, origin);
}

export function badRequest(message: string, origin?: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: headersForOrigin(origin),
    body: JSON.stringify({ error: message }),
  };
}

export function unauthorized(message = 'Unauthorized', origin?: string): APIGatewayProxyResult {
  return {
    statusCode: 401,
    headers: headersForOrigin(origin),
    body: JSON.stringify({ error: message }),
  };
}

export function forbidden(message = 'Forbidden', origin?: string): APIGatewayProxyResult {
  return {
    statusCode: 403,
    headers: headersForOrigin(origin),
    body: JSON.stringify({ error: message }),
  };
}

export function notFound(message = 'Not found', origin?: string): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: headersForOrigin(origin),
    body: JSON.stringify({ error: message }),
  };
}

export function serverError(message = 'Internal server error', origin?: string): APIGatewayProxyResult {
  return {
    statusCode: 500,
    headers: headersForOrigin(origin),
    body: JSON.stringify({ error: message }),
  };
}

/**
 * Safely parse a JSON request body. Returns the parsed object or null on failure.
 * Use with: const body = parseBody(event); if (!body) return badRequest('Invalid JSON');
 */
export function parseBody(event: { body?: string | null }): Record<string, unknown> | null {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

/**
 * Safely parse a JSON string. Returns undefined on failure instead of throwing.
 */
export function safeJsonParse<T = unknown>(str: string): T | undefined {
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}
