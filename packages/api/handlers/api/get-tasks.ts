/**
 * GET /tasks?provider_id=...&status=...&due_before=...&type=...
 *
 * Returns tasks for a provider, filterable by status and due date.
 *
 * Query params:
 *   provider_id (required) - The provider whose tasks to fetch
 *   status      (optional) - Filter by status: Open, Done, AwaitingTranscription, DraftReady, TranscriptionFailed
 *   due_before  (optional) - ISO date, return tasks due on or before this date
 *   type        (optional) - Filter by type: Schedule, Refill, CallBack, SendDocs, General, Dictation
 *   limit       (optional) - Max items to return (default 50)
 *
 * Response:
 * {
 *   "tasks": [
 *     {
 *       "task_id": "task-abc123",
 *       "provider_id": "dr-smith-001",
 *       "patient_id": "pt-token-abc",
 *       "type": "Dictation",
 *       "title": "Progress note dictation",
 *       "status": "DraftReady",
 *       "priority": "Med",
 *       "due_date": "2024-01-15",
 *       "dictation_id": "dict-abc123",
 *       "assigned_to": "Dr. Smith",
 *       "notes": "",
 *       "created_at": "2024-01-15T10:30:00Z",
 *       "updated_at": "2024-01-15T10:35:00Z"
 *     }
 *   ],
 *   "count": 1,
 *   "next_token": null
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { queryItemsPaginated } from '../../shared/dynamo';
import { getCallerIdentity, isAdmin } from '../../shared/auth';
import { success, badRequest, serverError } from '../../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const params = event.queryStringParameters || {};

    const status = params.status;
    const type = params.type;
    const dueBefore = params.due_before;
    const limit = Math.min(Math.max(parseInt(params.limit || '25', 10), 1), 100);
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (params.nextToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(params.nextToken, 'base64').toString('utf-8'));
      } catch {
        return badRequest('Invalid nextToken');
      }
    }

    let result: { items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> };
    if (isAdmin(caller)) {
      // Admins: clinic-wide task list via GSI2
      result = await queryItemsPaginated({
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'TASK',
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      });
    } else {
      // Non-admins: only their own tasks
      result = await queryItemsPaginated({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PROVIDER#${caller.providerId}`,
          ':sk': 'TASK#',
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      });
    }

    // Apply status filter client-side
    let filteredItems = result.items;
    if (status) {
      filteredItems = result.items.filter((i) => i.status === status);
    }

    // Apply client-side filters for type and due_before
    let tasks = filteredItems.map((item) => ({
      task_id: item.taskId,
      provider_id: item.providerId,
      patient_id: item.patientId,
      type: item.type,
      title: item.title,
      status: item.status,
      priority: item.priority,
      due_date: item.dueDate,
      dictation_id: item.dictationId,
      voicemail_id: item.voicemailId,
      assigned_to: item.assignedTo,
      notes: item.notes,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    }));

    if (type) {
      tasks = tasks.filter((t) => t.type === type);
    }

    if (dueBefore) {
      tasks = tasks.filter((t) => t.due_date && t.due_date <= dueBefore);
    }

    const nextToken = result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
      : null;

    return success({
      tasks,
      count: tasks.length,
      nextToken,
    });
  } catch (err) {
    console.error('Get tasks error:', (err as Error).message);
    return serverError('Failed to retrieve tasks');
  }
};
