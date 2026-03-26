/**
 * POST /voicemails/attach
 *
 * Manually attach a voicemail to a patient and create a todo task.
 * Used when auto-matching by phone number didn't find a match.
 *
 * Request body:
 * {
 *   "voicemailId": "abc123",
 *   "patientId": "pt-xyz",
 *   "callerNumber": "(727) 365-6747",
 *   "callerName": "Jane Doe",
 *   "category": "Scheduling"
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../../shared/auth';
import { putItem, getItem, writeAuditLog } from '../../shared/dynamo';
import { created, badRequest, serverError, parseBody } from '../../shared/response';

const CATEGORY_TO_TODO_TYPE: Record<string, string> = {
  'Scheduling': 'Schedule',
  'Refills': 'Refill',
  'Billing': 'General',
  'New Patient': 'CallBack',
  'Everything Else': 'CallBack',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const voicemailId = body.voicemailId as string | undefined;
    const patientId = body.patientId as string | undefined;
    if (!voicemailId || !patientId) {
      return badRequest('Missing required fields: voicemailId, patientId');
    }

    const category = (body.category as string) || 'Everything Else';
    const callerNumber = (body.callerNumber as string) || 'Unknown';
    const callerName = (body.callerName as string) || null;
    const now = new Date().toISOString();

    // Verify patient exists (patients use PK=PATIENT#id, SK=PROFILE)
    const patient = await getItem(`PATIENT#${patientId}`, 'PROFILE');
    if (!patient) {
      return badRequest('Patient not found');
    }

    // Check if already attached
    const existing = await getItem(`PROVIDER#${providerId}`, `VOICEMAIL#${voicemailId}`);
    if (existing && existing.attachmentType === 'patient') {
      return badRequest('Voicemail is already attached to a patient');
    }

    // Write/update voicemail attachment record
    await putItem({
      PK: `PROVIDER#${providerId}`,
      SK: `VOICEMAIL#${voicemailId}`,
      voicemailId,
      providerId,
      patientId,
      attachmentType: 'patient',
      callerNumber,
      callerName,
      category,
      status: 'Attached',
      receivedAt: existing?.receivedAt || now,
      durationSeconds: existing?.durationSeconds || 0,
      audioUrl: existing?.audioUrl || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${providerId}`,
      GSI1SK: `VOICEMAIL#${existing?.receivedAt || now}`,
      entityType: 'VoicemailAttachment',
    });

    // Create todo task
    const taskId = `task-${randomUUID().slice(0, 12)}`;
    const todoType = CATEGORY_TO_TODO_TYPE[category] || 'CallBack';
    const callerLabel = callerName || callerNumber;
    const title = `Voicemail — ${callerLabel} — ${category}`;

    await putItem({
      PK: `PROVIDER#${providerId}`,
      SK: `TASK#${taskId}`,
      taskId,
      providerId,
      patientId,
      voicemailId,
      type: todoType,
      title,
      status: 'Open',
      priority: 'Med',
      dueDate: null,
      assignedTo: null,
      notes: `Manually attached voicemail. Duration: ${existing?.durationSeconds || 0}s.`,
      dictationId: null,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${providerId}`,
      GSI1SK: `TASKSTATUS#Open#${now}`,
      GSI2PK: 'TASK',
      GSI2SK: `${now}#${taskId}`,
      entityType: 'Task',
    });

    await writeAuditLog({
      providerId,
      action: 'ATTACH_VOICEMAIL',
      entityType: 'VoicemailAttachment',
      entityId: voicemailId,
      details: { taskId, category, todoType },
    });

    return created({
      id: voicemailId,
      patientId,
      taskId,
      category,
      status: 'Attached',
    });
  } catch (err) {
    console.error('Attach voicemail error:', (err as Error).message);
    return serverError('Failed to attach voicemail');
  }
};
