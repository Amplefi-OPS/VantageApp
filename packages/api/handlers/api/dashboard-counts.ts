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
import { getCallerIdentity, isAdmin } from '../../shared/auth';
import { success, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const admin = isAdmin(caller);

    // Admins: clinic-wide counts via GSI2. Non-admins: scoped to their provider.
    const [patients, tasks, voicemails] = admin
      ? await Promise.all([
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
        ])
      : await Promise.all([
          queryItems({
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
            ExpressionAttributeValues: { ':pk': `PROVIDER#${caller.providerId}`, ':sk': 'PATIENT#' },
            ProjectionExpression: 'PK',
          }),
          queryItems({
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': `PROVIDER#${caller.providerId}`, ':sk': 'TASK#' },
          }),
          queryItems({
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
            ExpressionAttributeValues: { ':pk': `PROVIDER#${caller.providerId}`, ':sk': 'VOICEMAIL#' },
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
