/**
 * GET /dashboard/counts
 *
 * Returns aggregate counts for the dashboard tiles:
 *   - unattachedVoicemails
 *   - openTodos
 *   - overdueTodos
 *   - totalPatients
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { success, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;

    // Run all three queries in parallel for faster response
    const [patients, tasks, voicemails] = await Promise.all([
      queryItems({
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PROVIDER#${providerId}`,
          ':sk': 'PATIENT#',
        },
        ProjectionExpression: 'PK',
      }),
      queryItems({
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PROVIDER#${providerId}`,
          ':sk': 'TASKSTATUS#',
        },
      }),
      queryItems({
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PROVIDER#${providerId}`,
          ':sk': 'VOICEMAIL#',
        },
      }),
    ]);

    const now = new Date().toISOString();
    let openTodos = 0;
    let overdueTodos = 0;
    for (const task of tasks) {
      if (task.status === 'Open') {
        openTodos++;
        if (task.dueDate && task.dueDate < now) {
          overdueTodos++;
        }
      }
    }

    let unattachedVoicemails = 0;
    for (const vm of voicemails) {
      if (vm.status === 'Unattached') {
        unattachedVoicemails++;
      }
    }

    return success({
      unattachedVoicemails,
      totalVoicemails: voicemails.length,
      openTodos,
      overdueTodos,
      totalPatients: patients.length,
    });
  } catch (err) {
    console.error('Dashboard counts error:', (err as Error).message);
    return serverError('Failed to get dashboard counts');
  }
};
