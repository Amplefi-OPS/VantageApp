/**
 * PATCH /tasks/{task_id}
 *
 * Updates a task's status, notes, assignee, priority, or due date.
 * Writes an audit log entry for each update.
 *
 * Request body:
 * {
 *   "provider_id": "dr-smith-001",
 *   "status": "Done",
 *   "notes": "Reviewed and signed",
 *   "assigned_to": "Dr. Smith",
 *   "priority": "High",
 *   "due_date": "2024-01-20"
 * }
 *
 * Response: updated task object
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { queryItems, updateItem, buildUpdateExpression, writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, notFound, serverError, parseBody } from '../../shared/response';

const VALID_STATUSES = new Set([
  'Open', 'Done', 'AwaitingTranscription', 'DraftReady', 'TranscriptionFailed',
]);
const VALID_PRIORITIES = new Set(['Low', 'Med', 'High']);

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const taskId = event.pathParameters?.task_id;
    if (!taskId) return badRequest('Missing path parameter: task_id');

    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    // Find task by taskId via GSI2 (practice-wide, not tied to any provider PK)
    const matches = await queryItems({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: 'taskId = :tid',
      ExpressionAttributeValues: { ':pk': 'TASK', ':tid': taskId },
    });
    const existing = matches[0];
    if (!existing) return notFound('Task not found');

    // Validate fields
    if (body.status && !VALID_STATUSES.has(body.status as string)) {
      return badRequest(`Invalid status. Valid values: ${[...VALID_STATUSES].join(', ')}`);
    }
    if (body.priority && !VALID_PRIORITIES.has(body.priority as string)) {
      return badRequest(`Invalid priority. Valid values: ${[...VALID_PRIORITIES].join(', ')}`);
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      updatedAt: now,
    };

    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.assigned_to !== undefined) updates.assignedTo = body.assigned_to;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.due_date !== undefined) updates.dueDate = body.due_date;

    // Update GSI1SK if status changed
    if (body.status) {
      updates.GSI1SK = `TASKSTATUS#${body.status}#${existing.createdAt}`;
    }

    const expr = buildUpdateExpression(updates);
    if (!expr) return badRequest('No fields to update');

    const updated = await updateItem({
      Key: { PK: existing.PK as string, SK: existing.SK as string },
      ...expr,
      ReturnValues: 'ALL_NEW',
    });

    await writeAuditLog({
      providerId: (existing.providerId as string) || caller.providerId,
      action: 'UPDATE_TASK',
      entityType: 'Task',
      entityId: taskId,
      details: {
        changes: Object.keys(updates).filter((k) => k !== 'updatedAt' && k !== 'GSI1SK'),
        updatedBy: caller.email,
      },
    });

    return success({
      task_id: updated?.taskId,
      provider_id: updated?.providerId,
      patient_id: updated?.patientId,
      type: updated?.type,
      title: updated?.title,
      status: updated?.status,
      priority: updated?.priority,
      due_date: updated?.dueDate,
      dictation_id: updated?.dictationId,
      assigned_to: updated?.assignedTo,
      notes: updated?.notes,
      created_at: updated?.createdAt,
      updated_at: updated?.updatedAt,
    });
  } catch (err) {
    console.error('Update task error:', (err as Error).message);
    return serverError('Failed to update task');
  }
};
