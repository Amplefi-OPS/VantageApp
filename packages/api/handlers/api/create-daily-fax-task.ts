/**
 * Scheduled Lambda — triggered by EventBridge (weekdays 8 AM local).
 *
 * Creates a single "Check Fax Inbox" task of type General / status Open
 * for the provider. Replaces per-fax auto-task creation.
 */

import type { ScheduledHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { putItem, writeAuditLog } from '../../shared/dynamo';

const PROVIDER_ID = process.env.PROVIDER_ID;
if (!PROVIDER_ID) {
  throw new Error('PROVIDER_ID environment variable is required');
}

export const handler: ScheduledHandler = async () => {
  const taskId = `task-${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const status = 'Open';

  const item = {
    PK: `PROVIDER#${PROVIDER_ID}`,
    SK: `TASK#${taskId}`,
    taskId,
    providerId: PROVIDER_ID,
    patientId: null,
    type: 'General',
    title: 'Check Fax Inbox',
    status,
    priority: 'Med',
    dueDate: now.slice(0, 10),
    assignedTo: null,
    notes: '',
    dictationId: null,
    voicemailId: null,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `PROVIDER#${PROVIDER_ID}`,
    GSI1SK: `TASKSTATUS#${status}#${now}`,
    GSI2PK: 'TASK',
    GSI2SK: `${now}#${taskId}`,
    entityType: 'Task',
  };

  await putItem(item);

  await writeAuditLog({
    providerId: PROVIDER_ID,
    action: 'CREATE_TASK',
    entityType: 'Task',
    entityId: taskId,
    details: { type: 'General', title: 'Check Fax Inbox', createdBy: 'scheduled-rule' },
  });

  console.log(`Created daily fax task: ${taskId}`);
};
