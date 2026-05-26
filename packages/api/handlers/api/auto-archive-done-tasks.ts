/**
 * Scheduled Lambda — triggered by EventBridge (daily).
 *
 * Archives tasks that have been in status `Done` longer than
 * ARCHIVE_DONE_AFTER_DAYS (default 30). This is the "graveyard fix":
 * completed to-dos never cleared on their own, so the Done set grew
 * unbounded. Archiving keeps the open/done surface — and the future
 * Google Tasks sync — bounded.
 *
 * Reuses the same audited write semantics as the PATCH /tasks/{id}
 * path (update-task.ts): rewrite `status` + `GSI1SK` + `updatedAt`,
 * then write an UPDATE_TASK audit log.
 */

import type { ScheduledHandler } from 'aws-lambda';
import {
  queryItemsPaginated,
  updateItem,
  buildUpdateExpression,
  writeAuditLog,
} from '../../shared/dynamo';

const ARCHIVE_DONE_AFTER_DAYS = Number(process.env.ARCHIVE_DONE_AFTER_DAYS ?? '30');

export const handler: ScheduledHandler = async () => {
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - ARCHIVE_DONE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = now.toISOString();

  let scanned = 0;
  let archived = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    // Practice-wide task access pattern (same GSI2 'TASK' as update-task.ts).
    const page = await queryItemsPaginated({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: '#status = :done',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pk': 'TASK', ':done': 'Done' },
      ExclusiveStartKey: lastEvaluatedKey,
    });
    lastEvaluatedKey = page.lastEvaluatedKey;

    for (const task of page.items) {
      scanned += 1;

      // `updatedAt` is rewritten on every status change, so a Done task's
      // updatedAt is when it became Done. Fall back to createdAt if absent.
      const doneSince = (task.updatedAt as string) || (task.createdAt as string);
      if (!doneSince || doneSince > cutoff) continue;

      const createdAt = task.createdAt as string;
      const updates: Record<string, unknown> = {
        status: 'Archived',
        updatedAt: nowIso,
        GSI1SK: `TASKSTATUS#Archived#${createdAt}`,
      };

      const expr = buildUpdateExpression(updates);
      if (!expr) continue;

      await updateItem({
        Key: { PK: task.PK as string, SK: task.SK as string },
        ...expr,
      });

      await writeAuditLog({
        providerId: (task.providerId as string) || 'unknown',
        action: 'UPDATE_TASK',
        entityType: 'Task',
        entityId: task.taskId as string,
        details: {
          changes: ['status'],
          updatedBy: 'scheduled-auto-archive',
          archivedAfterDays: ARCHIVE_DONE_AFTER_DAYS,
        },
      });

      archived += 1;
    }
  } while (lastEvaluatedKey);

  console.log(
    `auto-archive-done-tasks: scanned ${scanned} Done task(s), archived ${archived} ` +
      `(cutoff ${cutoff}, ${ARCHIVE_DONE_AFTER_DAYS}d)`,
  );
};
