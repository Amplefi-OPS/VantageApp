/**
 * GET /zoom/voicemails?from=...&to=...
 *
 * Fetches voicemails from Zoom Phone API — both user-level and
 * auto receptionist voicemail boxes — and maps them to the
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
  duration: number;
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

interface ZoomAutoReceptionist {
  id: string;
  name: string;
  extension_number: string;
}

interface ZoomAutoReceptionistListResponse {
  auto_receptionists: ZoomAutoReceptionist[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const params = event.queryStringParameters || {};

    const zoomParams: Record<string, string> = {
      page_size: '100',
    };
    if (params.from) zoomParams.from = params.from;
    if (params.to) zoomParams.to = params.to;

    const allVoicemails: ZoomVoicemail[] = [];

    // 1. Fetch user-level voicemails
    const zoomUser = process.env.ZOOM_USER_EMAIL || 'me';
    try {
      const userData = await zoomGet<ZoomVoicemailResponse>(
        `/phone/users/${encodeURIComponent(zoomUser)}/voice_mails`,
        zoomParams,
      );
      if (userData.voice_mails) {
        allVoicemails.push(...userData.voice_mails);
      }
    } catch (err) {
      console.warn('User voicemails fetch failed:', (err as Error).message);
    }

    // 2. Fetch voicemails from all auto receptionists (IVR boxes)
    try {
      const arList = await zoomGet<ZoomAutoReceptionistListResponse>(
        '/phone/auto_receptionists',
        { page_size: '50' },
      );
      const receptionists = arList.auto_receptionists || [];

      for (const ar of receptionists) {
        try {
          const arVoicemails = await zoomGet<ZoomVoicemailResponse>(
            `/phone/auto_receptionists/${ar.id}/voice_mails`,
            zoomParams,
          );
          if (arVoicemails.voice_mails) {
            allVoicemails.push(...arVoicemails.voice_mails);
          }
        } catch (err) {
          console.warn(`Auto receptionist ${ar.name} (${ar.id}) voicemails failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn('Auto receptionists list failed:', (err as Error).message);
    }

    // Deduplicate by voicemail ID
    const seen = new Set<string>();
    const uniqueVoicemails = allVoicemails.filter((vm) => {
      if (seen.has(vm.id)) return false;
      seen.add(vm.id);
      return true;
    });

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

    // Map to frontend shape
    const voicemails = uniqueVoicemails.map((vm) => {
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

    // Sort newest first
    voicemails.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    return success(voicemails);
  } catch (err) {
    console.error('List Zoom voicemails error:', (err as Error).message);
    return serverError('Failed to retrieve voicemails from Zoom');
  }
};
