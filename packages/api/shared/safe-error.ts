/**
 * Safe error helpers for third-party API interactions.
 *
 * NEVER include raw response bodies from external services (Zoom, Google,
 * Stripe, Slack, etc.) in thrown errors or log output — they may contain
 * tokens, PHI, or other sensitive data that ends up in CloudWatch.
 */

/**
 * Build a sanitized error message for a failed third-party API call.
 * Includes only: provider name, operation, HTTP status code.
 */
export function thirdPartyError(
  provider: string,
  operation: string,
  statusCode: number,
): Error {
  return new Error(`${provider} ${operation} failed (HTTP ${statusCode})`);
}

/**
 * Sanitize an error message before logging or forwarding to Slack.
 * Strips anything after a status-code parenthetical to avoid leaking
 * response bodies that were interpolated into the message.
 */
export function sanitizeErrorMessage(message: string, maxLength = 120): string {
  // Truncate to maxLength and remove any raw JSON/HTML fragments
  return message.slice(0, maxLength).replace(/[{}<>]/g, '');
}
