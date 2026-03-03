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

    // Query patients for this provider (only need count, project minimal fields)
    const patients = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'PATIENT#',
      },
      ProjectionExpression: 'PK',
    });

    // Query tasks for this provider (GSI1SK uses TASKSTATUS# prefix)
    const tasks = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'TASKSTATUS#',
      },
    });

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

    // Query voicemails for this provider
    const voicemails = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'VOICEMAIL#',
      },
    });

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
