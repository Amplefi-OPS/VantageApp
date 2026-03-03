/**
 * POST /faxes
 *
 * Sends a fax via Zoom Phone API (if available) and stores
 * the fax record in DynamoDB for tracking.
 *
 * Request body:
 * {
 *   "pharmacy_name": "CVS Pharmacy",
 *   "pharmacy_fax": "+15551234567",
 *   "pharmacy_phone": "+15559876543",
 *   "patient_id": "pt-abc123",
 *   "rx_details": { "medication": "...", "dosage": "...", ... },
 *   "attachment_url": "https://..."
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../shared/auth';
import { putItem, writeAuditLog } from '../shared/dynamo';
import { zoomPost } from '../shared/zoom';
import { created, badRequest, serverError } from '../shared/response';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const body = JSON.parse(event.body || '{}');

    const pharmacyName = body.pharmacy_name;
    const pharmacyFax = body.pharmacy_fax;
    if (!pharmacyName || !pharmacyFax) {
      return badRequest('Missing required fields: pharmacy_name, pharmacy_fax');
    }

    const faxId = `fax-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    let status = 'Queued';
    let zoomFaxId: string | undefined;

    // Try to send via Zoom API
    const zoomUser = process.env.ZOOM_USER_EMAIL || 'me';
    try {
      const zoomResult = await zoomPost<{ id?: string; fax_id?: string; status?: string }>(
        `/phone/users/${encodeURIComponent(zoomUser)}/fax`,
        {
          callee_number: pharmacyFax,
          file_url: body.attachment_url || undefined,
        },
      );
      zoomFaxId = zoomResult.id || zoomResult.fax_id;
      status = 'Queued';
      console.log(`Fax sent via Zoom API: ${zoomFaxId}`);
    } catch (err) {
      console.warn('Zoom send fax failed (storing locally):', (err as Error).message);
      // Store locally even if Zoom send fails
      status = 'Queued';
    }

    const rxDetails = body.rx_details || null;

    const item = {
      PK: `PROVIDER#${providerId}`,
      SK: `FAX#${faxId}`,
      faxId,
      providerId,
      patientId: body.patient_id || null,
      pharmacyName,
      pharmacyFax,
      pharmacyPhone: body.pharmacy_phone || null,
      status,
      rxDetails: rxDetails ? JSON.stringify(rxDetails) : null,
      attachmentUrl: body.attachment_url || null,
      zoomFaxId: zoomFaxId || null,
      direction: 'outbound',
      createdAt: now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${providerId}`,
      GSI1SK: `FAX#${now}`,
      entityType: 'Fax',
    };

    await putItem(item);

    await writeAuditLog({
      providerId,
      action: 'SEND_FAX',
      entityType: 'Fax',
      entityId: faxId,
      details: { pharmacyName, pharmacyFax, createdBy: caller.email },
    });

    return created({
      id: faxId,
      patient_id: body.patient_id || null,
      pharmacy_name: pharmacyName,
      pharmacy_fax: pharmacyFax,
      pharmacy_phone: body.pharmacy_phone || null,
      status,
      rx_details: rxDetails,
      attachment_url: body.attachment_url || null,
      direction: 'outbound',
      created_at: now,
    });
  } catch (err) {
    console.error('Send fax error:', err);
    return serverError('Failed to send fax');
  }
};
