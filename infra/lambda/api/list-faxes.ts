/**
 * GET /faxes
 *
 * Fetches fax logs from Zoom Phone API and merges with locally-stored
 * fax records from DynamoDB. Returns combined list sorted newest first.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { zoomGet } from '../shared/zoom';
import { success, serverError } from '../shared/response';
import { getSecrets } from '../shared/secrets';

// ── Zoom fax log types ──

interface ZoomFaxLog {
  id: string;
  fax_id?: string;
  direction: 'inbound' | 'outbound';
  caller_number: string;
  caller_name: string;
  callee_number: string;
  callee_name: string;
  date_time: string;
  duration?: number;
  status: string;
  pages?: number;
  file_id?: string;
  file_url?: string;
}

interface ZoomFaxLogResponse {
  fax_logs: ZoomFaxLog[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

// ── Handler ──

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const params = event.queryStringParameters || {};

    const zoomParams: Record<string, string> = {
      page_size: '100',
    };
    if (params.from) zoomParams.from = params.from;
    if (params.to) zoomParams.to = params.to;

    const allFaxLogs: ZoomFaxLog[] = [];

    // 1. Try account-level fax logs
    try {
      const accountFax = await zoomGet<ZoomFaxLogResponse>(
        '/phone/fax/logs',
        zoomParams,
      );
      if (accountFax.fax_logs?.length) {
        console.log(`Account-level fax logs found: ${accountFax.fax_logs.length}`);
        allFaxLogs.push(...accountFax.fax_logs);
      }
    } catch (err) {
      console.warn('Account-level fax logs failed:', (err as Error).message);
    }

    // 2. Fallback: try extension-level fax logs
    const secrets = await getSecrets();
    const extensionId = secrets.ZOOM_FAX_EXTENSION_ID;
    if (extensionId && allFaxLogs.length === 0) {
      try {
        const extFax = await zoomGet<ZoomFaxLogResponse>(
          `/phone/extension/${extensionId}/fax/logs`,
          zoomParams,
        );
        if (extFax.fax_logs?.length) {
          console.log(`Extension fax logs found: ${extFax.fax_logs.length}`);
          allFaxLogs.push(...extFax.fax_logs);
        }
      } catch (err) {
        console.warn('Extension fax logs failed:', (err as Error).message);
      }
    }

    // Deduplicate by fax ID
    const seen = new Set<string>();
    const uniqueFaxLogs = allFaxLogs.filter((f) => {
      const key = f.id || f.fax_id || '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 3. Query locally-stored fax records from DynamoDB
    const localFaxes = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'FAX#',
      },
    });

    // Map Zoom fax logs → frontend shape
    const zoomFaxes = uniqueFaxLogs.map((f) => {
      const isInbound = f.direction === 'inbound';
      const remoteName = isInbound ? f.caller_name : f.callee_name;
      const remoteNumber = isInbound ? f.caller_number : f.callee_number;

      // Map Zoom status to frontend status
      let status: string = 'Sent';
      const lowerStatus = (f.status || '').toLowerCase();
      if (lowerStatus.includes('fail') || lowerStatus.includes('error')) {
        status = 'Failed';
      } else if (lowerStatus.includes('queue') || lowerStatus.includes('pending') || lowerStatus.includes('progress')) {
        status = 'Queued';
      }

      return {
        id: f.id || f.fax_id || '',
        pharmacyName: remoteName || 'Unknown',
        pharmacyFax: remoteNumber || 'Unknown',
        status,
        createdAt: f.date_time,
        direction: f.direction,
        pages: f.pages || undefined,
        rxDetails: undefined,
        attachmentUrl: f.file_url || undefined,
        source: 'zoom',
      };
    });

    // Map local DynamoDB fax records → frontend shape
    const dbFaxes = localFaxes.map((f) => ({
      id: f.faxId as string,
      patientId: (f.patientId as string) || undefined,
      pharmacyName: f.pharmacyName as string,
      pharmacyFax: f.pharmacyFax as string,
      pharmacyPhone: (f.pharmacyPhone as string) || undefined,
      status: f.status as string,
      createdAt: f.createdAt as string,
      direction: 'outbound' as const,
      rxDetails: f.rxDetails ? (() => { try { return JSON.parse(f.rxDetails as string); } catch { return undefined; } })() : undefined,
      attachmentUrl: (f.attachmentUrl as string) || undefined,
      source: 'local',
    }));

    // Merge and sort newest first
    const allFaxes = [...zoomFaxes, ...dbFaxes];
    allFaxes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return success(allFaxes);
  } catch (err) {
    console.error('List faxes error:', (err as Error).message);
    return serverError('Failed to retrieve faxes');
  }
};
