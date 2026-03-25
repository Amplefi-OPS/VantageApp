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
import { queryItems } from '../../shared/dynamo';
import { getCallerIdentity } from '../../shared/auth';
import { success, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event); // authenticate + set CORS origin

    // Practice-wide counts via GSI2 for all authenticated users
    const [patients, tasks, voicemails] = await Promise.all([
      queryItems({
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': 'PATIENT' },
        ProjectionExpression: 'PK',
      }),
      queryItems({
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': 'TASK' },
      }),
      queryItems({
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': 'VOICEMAIL' },
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
