/**
 * Cognito Post-Authentication Lambda Trigger
 *
 * Fires after every successful login. Sends a Slack notification
 * so the team has real-time visibility into who's accessing the system.
 */

import { sendSlackAlert } from '../shared/slack';

interface PostAuthEvent {
  triggerSource: string;
  request: {
    userAttributes: {
      email?: string;
      given_name?: string;
      family_name?: string;
      sub?: string;
      [key: string]: string | undefined;
    };
  };
  response: Record<string, unknown>;
}

export async function handler(event: PostAuthEvent): Promise<PostAuthEvent> {
  const email = event.request.userAttributes.email || 'unknown';
  const name = [
    event.request.userAttributes.given_name,
    event.request.userAttributes.family_name,
  ].filter(Boolean).join(' ') || email;

  await sendSlackAlert('User Signed In', 'info', [
    { label: 'User', value: name },
    { label: 'Email', value: email },
    { label: 'Trigger', value: event.triggerSource },
  ]);

  return event;
}
