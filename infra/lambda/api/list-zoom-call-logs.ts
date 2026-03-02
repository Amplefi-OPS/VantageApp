/**
 * GET /zoom/call-logs?from=...&to=...&type=...
 *
 * Fetches call history from Zoom Phone API.
 *
 * Query params:
 *   from  (optional) - ISO date, e.g. 2026-03-01
 *   to    (optional) - ISO date, e.g. 2026-03-02
 *   type  (optional) - Filter: missed, answered, voicemail
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { zoomGet } from '../shared/zoom';
import { success, serverError } from '../shared/response';

interface ZoomCallLog {
  id: string;
  caller_number: string;
  caller_name: string;
  callee_number: string;
  callee_name: string;
  direction: 'inbound' | 'outbound';
  duration: number;          // seconds
  result: string;            // e.g. "Call Connected", "Voicemail", "No Answer", "Missed"
  date_time: string;
  answer_start_time: string;
  call_end_time: string;
  call_id: string;
  call_type: string;
  has_recording: boolean;
  has_voicemail: boolean;
}

interface ZoomCallLogResponse {
  call_logs: ZoomCallLog[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

function mapResult(result: string): 'answered' | 'missed' | 'voicemail' {
  const lower = result.toLowerCase();
  if (lower.includes('voicemail')) return 'voicemail';
  if (lower.includes('missed') || lower.includes('no answer')) return 'missed';
  return 'answered';
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event); // verify auth
    const params = event.queryStringParameters || {};

    const zoomParams: Record<string, string> = {
      page_size: '100',
    };
    if (params.from) zoomParams.from = params.from;
    if (params.to) zoomParams.to = params.to;
    if (params.type) zoomParams.type = params.type;

    const zoomData = await zoomGet<ZoomCallLogResponse>(
      '/phone/call_logs',
      zoomParams,
    );

    const callLogs = (zoomData.call_logs || []).map((log) => ({
      id: log.id,
      callerNumber: log.caller_number || 'Unknown',
      callerName: log.caller_name || undefined,
      calleeNumber: log.callee_number || 'Unknown',
      calleeName: log.callee_name || undefined,
      direction: log.direction,
      duration: log.duration,
      result: mapResult(log.result),
      startTime: log.date_time,
      endTime: log.call_end_time,
      hasRecording: log.has_recording,
      hasVoicemail: log.has_voicemail,
    }));

    // Client-side filter by result type if requested
    const filtered = params.type
      ? callLogs.filter((l) => l.result === params.type)
      : callLogs;

    return success({
      callLogs: filtered,
      count: filtered.length,
    });
  } catch (err) {
    console.error('List Zoom call logs error:', (err as Error).message);
    return serverError('Failed to retrieve call logs from Zoom');
  }
};
