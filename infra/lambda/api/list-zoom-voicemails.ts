/**
 * GET /zoom/voicemails?from=...&to=...
 *
 * Fetches voicemails from Zoom Phone API and maps them to the
 * Voicemail shape the frontend expects. Checks DynamoDB for
 * existing patient attachments.
 *
 * Query params:
 *   from  (optional) - ISO date, e.g. 2026-03-01
 *   to    (optional) - ISO date, e.g. 2026-03-02
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { zoomGet } from '../shared/zoom';
import { success, serverError } from '../shared/response';

interface ZoomVoicemail {
  id: string;
  caller_number: string;
  caller_name: string;
  callee_number: string;
  callee_name: string;
  date_time: string;
  duration: number;          // seconds
  download_url: string;
  status: 'read' | 'unread';
  call_id: string;
  call_log_id: string;
}

interface ZoomVoicemailResponse {
  voice_mails: ZoomVoicemail[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const params = event.queryStringParameters || {};

    // Build Zoom API query params
    const zoomParams: Record<string, string> = {
      page_size: '100',
    };
    if (params.from) zoomParams.from = params.from;
    if (params.to) zoomParams.to = params.to;

    // ZOOM_USER_EMAIL env var determines whose voicemails to fetch
    const zoomUser = process.env.ZOOM_USER_EMAIL || 'me';

    const zoomData = await zoomGet<ZoomVoicemailResponse>(
      `/phone/users/${encodeURIComponent(zoomUser)}/voice_mails`,
      zoomParams,
    );

    // Look up existing voicemail-patient attachments in DynamoDB
    const attachments = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${caller.providerId}`,
        ':sk': 'VOICEMAIL#',
      },
    });

    const attachMap = new Map<string, { type: string; patientId?: string }>();
    for (const item of attachments) {
      attachMap.set(item.voicemailId as string, {
        type: item.attachmentType as string,
        patientId: item.patientId as string | undefined,
      });
    }

    // Map Zoom voicemails to frontend shape
    const voicemails = (zoomData.voice_mails || []).map((vm) => {
      const attachment = attachMap.get(vm.id);

      return {
        id: vm.id,
        callerNumber: vm.caller_number || 'Unknown',
        callerName: vm.caller_name || undefined,
        receivedAt: vm.date_time,
        category: 'Everything Else' as const,
        durationSeconds: vm.duration,
        audioUrl: vm.download_url,
        attachedTo: attachment
          ? { type: attachment.type, patientId: attachment.patientId }
          : { type: 'none' },
        status: attachment ? 'Attached' : 'Unattached',
      };
    });

    return success(voicemails);
  } catch (err) {
    console.error('List Zoom voicemails error:', (err as Error).message);
    return serverError('Failed to retrieve voicemails from Zoom');
  }
};
