/**
 * Scheduled Lambda — polls the john.dalesandro@vantagerefinery.com inbox
 * for messages labeled "Vantage/Content" (mail to content@vantagerefinery.com,
 * filtered by a Gmail rule) and writes them to Dynamo as EMAIL# rows.
 *
 * Runs every 5 minutes via EventBridge. Idempotent: adds a
 * "Vantage/Processed" label to each ingested message so subsequent runs
 * skip it. A conditional Dynamo write would also work, but Gmail labels
 * are cheaper at the expected volume (dozens/day).
 */

import type { ScheduledHandler } from 'aws-lambda';
import { getSecrets } from '../../shared/secrets';
import { putItem, getItem, writeAuditLog } from '../../shared/dynamo';
import {
  listLabeledMessages,
  getMessage,
  addLabel,
  headerValue,
  parseFromHeader,
} from '../../shared/gmail';

export const handler: ScheduledHandler = async () => {
  const secrets = await getSecrets();
  if (!secrets.GMAIL_LABEL_ID || !secrets.GMAIL_PROCESSED_LABEL_ID) {
    console.warn('[poll-content-inbox] Gmail label IDs not configured — skipping');
    return;
  }

  const summaries = await listLabeledMessages(
    secrets.GMAIL_LABEL_ID,
    secrets.GMAIL_PROCESSED_LABEL_ID,
    50,
  );
  if (summaries.length === 0) {
    console.log('[poll-content-inbox] no new messages');
    return;
  }

  let ingested = 0;
  for (const summary of summaries) {
    try {
      // Skip if we've already written this email (paranoia — the Processed label
      // should prevent this, but labels can get removed by a human).
      const existing = await getItem('PRACTICE#vantage', `EMAIL#${summary.id}`);
      if (existing) {
        await addLabel(summary.id, secrets.GMAIL_PROCESSED_LABEL_ID);
        continue;
      }

      const msg = await getMessage(summary.id);
      const fromHeader = headerValue(msg, 'From');
      const subject = headerValue(msg, 'Subject') || '(no subject)';
      const dateHeader = headerValue(msg, 'Date');
      const { name: fromName, email: fromEmail } = parseFromHeader(fromHeader);

      const receivedAt = dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date(Number(msg.internalDate)).toISOString();
      const createdAt = new Date().toISOString();

      await putItem({
        PK: 'PRACTICE#vantage',
        SK: `EMAIL#${summary.id}`,
        emailId: summary.id,
        from: fromEmail,
        fromName: fromName || null,
        subject,
        snippet: (msg.snippet || '').slice(0, 300),
        receivedAt,
        gmailThreadId: msg.threadId,
        status: 'Unmatched',
        attachedTodoId: null,
        assignedTo: null,
        createdAt,
        updatedAt: createdAt,
        GSI2PK: 'EMAIL',
        GSI2SK: `${receivedAt}#${summary.id}`,
        entityType: 'Email',
      });

      await addLabel(summary.id, secrets.GMAIL_PROCESSED_LABEL_ID);
      ingested += 1;
    } catch (err) {
      console.error(`[poll-content-inbox] failed on message ${summary.id}:`, (err as Error).message);
    }
  }

  if (ingested > 0) {
    await writeAuditLog({
      providerId: 'system',
      action: 'INGEST_EMAILS',
      entityType: 'Email',
      entityId: 'batch',
      details: { count: ingested },
    });
  }
  console.log(`[poll-content-inbox] ingested ${ingested}/${summaries.length} messages`);
};
