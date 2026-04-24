/**
 * POST /emails/attach
 *
 * Either attach an inbound email to an existing todo, or create a new todo
 * seeded from the email. Notifies the todo's assignee by email (SES).
 *
 * Body:
 * {
 *   "emailId": "...",
 *   "action": "attach" | "create",
 *   "todoId"?: "task-abc",                        // required when action=attach
 *   "newTodo"?: {                                 // required when action=create
 *     "title": "...",
 *     "type"?: "Schedule" | "Refill" | ...,
 *     "patientId"?: "pt-...",
 *     "assignedTo": "Lori",
 *     "priority"?: "Low" | "Med" | "High",
 *     "dueDate"?: "2026-04-30",
 *     "notes"?: "..."
 *   }
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../../shared/auth';
import { getItem, putItem, updateItem, queryItems, buildUpdateExpression, writeAuditLog } from '../../shared/dynamo';
import { success, badRequest, notFound, serverError, parseBody } from '../../shared/response';
import { sendNotification, resolveStaffEmail, appUrl } from '../../shared/email-notifier';

const VALID_TYPES = new Set(['Schedule', 'Refill', 'CallBack', 'SendDocs', 'General', 'Dictation']);

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const emailId = body.emailId as string | undefined;
    const action = body.action as string | undefined;
    if (!emailId || (action !== 'attach' && action !== 'create')) {
      return badRequest('emailId and action ("attach" | "create") are required');
    }

    const emailRow = await getItem('PRACTICE#vantage', `EMAIL#${emailId}`);
    if (!emailRow) return notFound('Email not found');

    const now = new Date().toISOString();
    let todoId: string;
    let todoTitle: string;
    let assignedTo: string | null;
    let patientId: string | null = null;

    if (action === 'attach') {
      const existingTodoId = body.todoId as string | undefined;
      if (!existingTodoId) return badRequest('todoId is required for action=attach');

      // Look up the todo by scanning the provider's tasks. Tasks live under
      // PROVIDER#<id>/TASK#<id>; we take the task GSI2 lookup shortcut.
      const todo = await findTaskById(existingTodoId);
      if (!todo) return notFound('Todo not found');

      todoId = todo.taskId;
      todoTitle = todo.title;
      assignedTo = todo.assignedTo || null;
      patientId = todo.patientId || null;

      // Append a note referencing the email
      const mergedNotes = [todo.notes, `[email] ${emailRow.subject} — from ${emailRow.from}`]
        .filter(Boolean)
        .join('\n');
      const upd = buildUpdateExpression({
        notes: mergedNotes,
        emailId,
        updatedAt: now,
      });
      if (upd) {
        await updateItem({
          Key: { PK: todo.PK, SK: todo.SK },
          ...upd,
        });
      }
    } else {
      // action === 'create'
      const nt = (body.newTodo || {}) as Record<string, unknown>;
      const title = (nt.title as string) || '';
      assignedTo = (nt.assignedTo as string) || null;
      if (!title || !assignedTo) {
        return badRequest('newTodo.title and newTodo.assignedTo are required');
      }
      const type = (nt.type as string) || 'General';
      if (!VALID_TYPES.has(type)) {
        return badRequest(`Invalid type. Valid values: ${[...VALID_TYPES].join(', ')}`);
      }
      const priority = (nt.priority as string) || 'Med';
      const dueDate = (nt.dueDate as string) || null;
      const notes = (nt.notes as string) || `From email: ${emailRow.subject} — ${emailRow.from}`;
      patientId = (nt.patientId as string) || null;

      todoId = `task-${randomUUID().slice(0, 12)}`;
      todoTitle = title;

      await putItem({
        PK: `PROVIDER#${caller.providerId}`,
        SK: `TASK#${todoId}`,
        taskId: todoId,
        providerId: caller.providerId,
        patientId,
        emailId,
        type,
        title,
        status: 'Open',
        priority,
        dueDate,
        assignedTo,
        notes,
        dictationId: null,
        voicemailId: null,
        createdAt: now,
        updatedAt: now,
        GSI1PK: `PROVIDER#${caller.providerId}`,
        GSI1SK: `TASKSTATUS#Open#${now}`,
        GSI2PK: 'TASK',
        GSI2SK: `${now}#${todoId}`,
        entityType: 'Task',
      });
    }

    // Flip email to Attached + record linkage
    const emailUpd = buildUpdateExpression({
      status: 'Attached',
      attachedTodoId: todoId,
      assignedTo,
      updatedAt: now,
    });
    if (emailUpd) {
      await updateItem({
        Key: { PK: 'PRACTICE#vantage', SK: `EMAIL#${emailId}` },
        ...emailUpd,
      });
    }

    await writeAuditLog({
      providerId: caller.providerId,
      action: 'ATTACH_EMAIL',
      entityType: 'Email',
      entityId: emailId,
      details: { todoId, action, assignedTo, createdBy: caller.email },
    });

    // Notify assignee (best-effort)
    const assigneeEmail = await resolveStaffEmail(assignedTo);
    if (assigneeEmail) {
      const verb = action === 'create' ? 'assigned' : 'attached email to';
      await sendNotification({
        to: assigneeEmail,
        subject: `Vantage — ${action === 'create' ? 'New to-do' : 'Email on your to-do'}: ${todoTitle}`,
        text: [
          `${caller.email} ${verb} a to-do in Vantage:`,
          '',
          `Title: ${todoTitle}`,
          `From email: ${emailRow.from} — ${emailRow.subject}`,
          '',
          `Open it: ${appUrl('/todos')}`,
          '',
          '— Vantage Refinery',
        ].join('\n'),
      });
    }

    return success({
      emailId,
      todoId,
      status: 'Attached',
      assignedTo,
      patientId,
      notified: !!assigneeEmail,
    });
  } catch (err) {
    console.error('Attach email error:', (err as Error).message);
    return serverError('Failed to attach email');
  }
};

/**
 * Find a task by its id by scanning the TASK GSI2 partition. Tasks are not
 * huge in volume; a single Query with a filter is fine at practice scale.
 */
async function findTaskById(taskId: string): Promise<(Record<string, any>) | null> {
  const items = await queryItems({
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk',
    FilterExpression: 'taskId = :tid',
    ExpressionAttributeValues: { ':pk': 'TASK', ':tid': taskId },
    Limit: 500,
  });
  return items[0] || null;
}
