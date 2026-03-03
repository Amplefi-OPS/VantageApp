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
import { getCallerIdentity, canAccessProvider } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { success, badRequest, forbidden, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const params = event.queryStringParameters || {};

    const providerId = params.provider_id || caller.providerId;

    if (!canAccessProvider(caller, providerId)) {
      return forbidden('Cannot access tasks for another provider');
    }

    const status = params.status;
    const type = params.type;
    const dueBefore = params.due_before;
    const limit = Math.min(parseInt(params.limit || '50', 10), 200);

    // Query using GSI1 if filtering by status, otherwise use main table
    let items;

    if (status) {
      // GSI1PK = PROVIDER#{id}, GSI1SK begins_with TASKSTATUS#{status}
      items = await queryItems({
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PROVIDER#${providerId}`,
          ':sk': `TASKSTATUS#${status}#`,
        },
        Limit: limit,
      });
    } else {
      // All tasks for provider: PK = PROVIDER#{id}, SK begins_with TASK#
      items = await queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PROVIDER#${providerId}`,
          ':sk': 'TASK#',
        },
        Limit: limit,
      });
    }

    // Apply client-side filters for type and due_before
    let tasks = items.map((item) => ({
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

    return success({
      tasks,
      count: tasks.length,
      next_token: null, // Pagination token (implement with LastEvaluatedKey if needed)
    });
  } catch (err) {
    console.error('Get tasks error:', err);
    return serverError('Failed to retrieve tasks');
  }
};
