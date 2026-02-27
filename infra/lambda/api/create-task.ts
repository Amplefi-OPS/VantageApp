/**
 * POST /tasks
 *
 * Creates a new task for a provider.
 *
 * Request body:
 * {
 *   "provider_id": "dr-smith-001",
 *   "patient_id": "pt-token-abc",
 *   "type": "Refill",
 *   "title": "Process metformin refill for patient",
 *   "priority": "Med",
 *   "due_date": "2024-01-20",
 *   "assigned_to": "Dr. Smith",
 *   "notes": "Patient called requesting 90-day supply",
 *   "dictation_id": null,
 *   "voicemail_id": null
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity, canAccessProvider } from '../shared/auth';
import { putItem, writeAuditLog } from '../shared/dynamo';
import { created, badRequest, forbidden, serverError } from '../shared/response';

const VALID_TYPES = new Set([
  'Schedule', 'Refill', 'CallBack', 'SendDocs', 'General', 'Dictation',
]);

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = JSON.parse(event.body || '{}');

    const { provider_id, type, title } = body;
    if (!provider_id || !type || !title) {
      return badRequest('Missing required fields: provider_id, type, title');
    }

    if (!canAccessProvider(caller, provider_id)) {
      return forbidden('Cannot create tasks for another provider');
    }

    if (!VALID_TYPES.has(type)) {
      return badRequest(`Invalid type. Valid values: ${[...VALID_TYPES].join(', ')}`);
    }

    const taskId = `task-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const status = body.status || 'Open';

    const item = {
      PK: `PROVIDER#${provider_id}`,
      SK: `TASK#${taskId}`,
      taskId,
      providerId: provider_id,
      patientId: body.patient_id || null,
      type,
      title,
      status,
      priority: body.priority || 'Med',
      dueDate: body.due_date || null,
      assignedTo: body.assigned_to || null,
      notes: body.notes || '',
      dictationId: body.dictation_id || null,
      voicemailId: body.voicemail_id || null,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${provider_id}`,
      GSI1SK: `TASKSTATUS#${status}#${now}`,
      GSI2PK: 'TASK',
      GSI2SK: `${now}#${taskId}`,
      entityType: 'Task',
    };

    await putItem(item);

    await writeAuditLog({
      providerId: provider_id,
      action: 'CREATE_TASK',
      entityType: 'Task',
      entityId: taskId,
      details: { type, title, createdBy: caller.email },
    });

    return created({
      task_id: taskId,
      provider_id,
      patient_id: body.patient_id || null,
      type,
      title,
      status,
      priority: body.priority || 'Med',
      due_date: body.due_date || null,
      assigned_to: body.assigned_to || null,
      notes: body.notes || '',
      dictation_id: body.dictation_id || null,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    console.error('Create task error:', err);
    return serverError('Failed to create task');
  }
};
