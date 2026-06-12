/**
 * GET /pulse
 *
 * Workload pulse gauge for the current Mon–Fri work week.
 * Aggregates appointment counts from Google Calendar. No PHI in response.
 *
 * Returns: { weekStart, weekEnd, total, done, remaining, newPatientCount, newPatientPercent }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { success, serverError } from '../../shared/response';
import { getGoogleAccessToken, getCalendarIds } from '../../shared/google';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

interface GoogleEvent {
  id: string;
  status: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
}

interface EventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Monday (inclusive) and Friday (inclusive) of the UTC week containing `now`.
function workWeekBounds(now: Date): { monday: string; friday: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offsetToMonday);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { monday: isoDate(monday), friday: isoDate(friday) };
}

function isNewPatientSummary(summary: string | undefined): boolean {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  return lower.includes('new patient') || lower.includes('new pt');
}

async function fetchEvents(calendarId: string, token: string, timeMin: string, timeMax: string): Promise<GoogleEvent[]> {
  const all: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Google Calendar API error (HTTP ${res.status})`);
    }
    const data = (await res.json()) as EventsListResponse;
    if (data.items) all.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

export const handler: APIGatewayProxyHandler = async () => {
  try {
    const now = new Date();
    const { monday, friday } = workWeekBounds(now);

    const token = await getGoogleAccessToken();
    const calendarIds = await getCalendarIds();

    const rawResults = await Promise.all(
      calendarIds.map((id) => fetchEvents(id, token, `${monday}T00:00:00Z`, `${friday}T23:59:59Z`)),
    );
    const seen = new Set<string>();
    const events: GoogleEvent[] = [];
    for (const batch of rawResults) {
      for (const e of batch) {
        if (!seen.has(e.id)) { seen.add(e.id); events.push(e); }
      }
    }

    const active = events.filter((e) => e.status !== 'cancelled');
    const total = active.length;

    let done = 0;
    let remaining = 0;
    let newPatientCount = 0;

    for (const e of active) {
      const startStr = e.start?.dateTime || e.start?.date || '';
      if (!startStr) continue;
      const startMs = new Date(startStr).getTime();
      if (startMs < now.getTime()) done += 1;
      else remaining += 1;
      if (isNewPatientSummary(e.summary)) newPatientCount += 1;
    }

    const newPatientPercent = total > 0 ? Math.round((newPatientCount / total) * 100) : 0;

    return success({
      weekStart: monday,
      weekEnd: friday,
      total,
      done,
      remaining,
      newPatientCount,
      newPatientPercent,
    });
  } catch (err) {
    console.error('Pulse error:', (err as Error).message);
    return serverError('Failed to compute pulse');
  }
};
