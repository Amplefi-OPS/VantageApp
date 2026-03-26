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
import { getCallerIdentity } from '../../shared/auth';
import { putItem, writeAuditLog } from '../../shared/dynamo';
import { zoomPost } from '../../shared/zoom';
import { created, badRequest, serverError, parseBody } from '../../shared/response';
import { getSecrets } from '../../shared/secrets';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const body = parseBody(event);
    if (!body) return badRequest('Invalid JSON in request body');

    const pharmacyName = body.pharmacy_name as string | undefined;
    const pharmacyFax = body.pharmacy_fax as string | undefined;
    if (!pharmacyName || !pharmacyFax) {
      return badRequest('Missing required fields: pharmacy_name, pharmacy_fax');
    }

    // ── RX validation (prescription fields) ──
    const rx = body.rx_details as Record<string, unknown> | undefined;
    if (rx) {
      // Coerce quantity/refills from string to number (frontend sends strings from inputs)
      if (typeof rx.quantity === 'string') rx.quantity = parseInt(rx.quantity, 10);
      if (typeof rx.refills === 'string') rx.refills = parseInt(rx.refills, 10);

      const rxErrors: string[] = [];
      if (!rx.medication || typeof rx.medication !== 'string') {
        rxErrors.push('rx_details.medication is required');
      }
      if (!rx.dosage || typeof rx.dosage !== 'string') {
        rxErrors.push('rx_details.dosage is required');
      }
      if (!rx.directions || typeof rx.directions !== 'string') {
        rxErrors.push('rx_details.directions is required');
      }
      if (isNaN(rx.quantity as number) || (rx.quantity as number) < 1) {
        rxErrors.push('rx_details.quantity must be a positive number');
      }
      if (isNaN(rx.refills as number) || (rx.refills as number) < 0 || (rx.refills as number) > 12) {
        rxErrors.push('rx_details.refills must be between 0 and 12');
      }
      if (!rx.prescriberName || typeof rx.prescriberName !== 'string') {
        rxErrors.push('rx_details.prescriberName is required');
      }
      if (rxErrors.length > 0) {
        return badRequest(`Prescription validation failed: ${rxErrors.join('; ')}`);
      }
    }

    // Validate attachment URL — only allow app-controlled S3 presigned URLs
    const attachmentUrl = body.attachment_url as string | undefined;
    if (attachmentUrl) {
      const ALLOWED_ATTACHMENT_HOSTS = [
        '.s3.amazonaws.com',
        '.s3.us-east-1.amazonaws.com',
      ];
      try {
        const parsed = new URL(attachmentUrl);
        const isAllowed = parsed.protocol === 'https:' &&
          ALLOWED_ATTACHMENT_HOSTS.some((h) => parsed.hostname.endsWith(h));
        if (!isAllowed) {
          return badRequest('attachment_url must be a presigned S3 URL from the app');
        }
      } catch {
        return badRequest('attachment_url is not a valid URL');
      }
    }

    const faxId = `fax-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    let status = 'Queued';
    let zoomFaxId: string | undefined;

    // Try to send via Zoom API
    const secrets = await getSecrets();
    const zoomUser = secrets.ZOOM_USER_EMAIL || 'me';
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
      console.warn('Zoom send fax failed:', (err as Error).message);
      status = 'Failed';
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

    const maskedFax = pharmacyFax.slice(-4);
    await writeAuditLog({
      providerId,
      action: 'FAX_SENT',
      entityType: 'Fax',
      entityId: faxId,
      details: {
        pharmacyFaxLast4: maskedFax,
        patientId: body.patient_id || null,
        createdBy: caller.email,
      },
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
    console.error('Send fax error:', (err as Error).message);
    return serverError('Failed to send fax');
  }
};
