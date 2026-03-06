/**
 * GET /appointments?date=YYYY-MM-DD&range_end=YYYY-MM-DD&phone=+1234567890
 *
 * Fetches appointments from Google Calendar API.
 * Parses event summary/description for patient info (name, phone, email, type).
 * Matches patient phone numbers against DynamoDB to attach patientId.
 * Auto-creates patient records for unmatched appointments.
 *
 * Expected Google Calendar event format:
 *   Summary: "FirstName LastName - New Patient" or "FirstName LastName"
 *   Description: "Phone: (727) 365-6747\nEmail: jane@example.com\nAny other notes"
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getCallerIdentity } from '../shared/auth';
import { putItem, queryItems, writeAuditLog } from '../shared/dynamo';
import { success, serverError } from '../shared/response';
import { getGoogleAccessToken, getCalendarId } from '../shared/google';

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

interface GoogleEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  created?: string;
  attendees?: Array<{ email?: string; displayName?: string }>;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

interface EventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

// ── Parsing helpers ──

function shortTypeName(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('new patient') || lower.includes('new pt')) return 'New Patient';
  if (lower.includes('returning') || lower.includes('follow')) return 'Returning Patient';
  return raw;
}

function parseEventSummary(summary: string): { firstName: string; lastName: string; type: string } {
  if (!summary) return { firstName: '', lastName: '', type: '' };

  // "Appointment Type (Patient Name)" — e.g. "New Patient Consultation (Jane Doe)"
  const parenMatch = summary.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (parenMatch) {
    const type = shortTypeName(parenMatch[1].trim());
    const nameParts = parenMatch[2].trim().split(/\s+/);
    return {
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      type,
    };
  }

  // "FirstName LastName - Appointment Type"
  const dashMatch = summary.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const parts = dashMatch[1].trim().split(/\s+/);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      type: shortTypeName(dashMatch[2].trim()),
    };
  }

  // Just a name
  const parts = summary.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    type: '',
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function parseDescription(desc: string): { phone: string; email: string; notes: string } {
  if (!desc) return { phone: '', email: '', notes: '' };

  // Strip HTML tags first
  const clean = stripHtml(desc);

  const phoneMatch = clean.match(/(?:phone|tel|cell|mobile)\s*[:=]\s*([\d\s()+-]+)/i);
  const emailMatch = clean.match(/(?:email)\s*[:=]\s*([^\s,]+@[^\s,]+)/i);
  // Fallback: bare phone or email anywhere in the description
  const barePhone = !phoneMatch ? clean.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/) : null;
  const bareEmail = !emailMatch ? clean.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/) : null;

  return {
    phone: phoneMatch?.[1]?.trim() || barePhone?.[1]?.trim() || '',
    email: emailMatch?.[1]?.trim() || bareEmail?.[1]?.trim() || '',
    notes: '',
  };
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// ── Google Calendar API ──

async function fetchEvents(calendarId: string, token: string, params: URLSearchParams): Promise<GoogleEvent[]> {
  const all: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const p = new URLSearchParams(params);
    if (pageToken) p.set('pageToken', pageToken);

    const res = await fetch(
      `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${p}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar API error (${res.status}): ${text}`);
    }
    const data = (await res.json()) as EventsListResponse;
    if (data.items) all.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

// ── Handler ──

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const params = event.queryStringParameters || {};
    const rawPhone = params.phone;

    const token = await getGoogleAccessToken();
    const calendarId = await getCalendarId();

    let phoneFilter: string | undefined;
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, '');
      phoneFilter = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    }

    let events: GoogleEvent[];

    if (phoneFilter) {
      // Patient-specific: fetch wide range, filter by phone match in description
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const sixMonthsAhead = new Date();
      sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);

      const qp = new URLSearchParams({
        timeMin: sixMonthsAgo.toISOString(),
        timeMax: sixMonthsAhead.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        showDeleted: 'true',
      });
      const allEvents = await fetchEvents(calendarId, token, qp);

      events = allEvents.filter((e) => {
        const { phone } = parseDescription(e.description || '');
        return phone ? normalizePhone(phone) === phoneFilter : false;
      });
      // Sort descending for patient history view
      events.sort((a, b) => {
        const aT = a.start?.dateTime || a.start?.date || '';
        const bT = b.start?.dateTime || b.start?.date || '';
        return new Date(bT).getTime() - new Date(aT).getTime();
      });
    } else {
      // Date-based: fetch events for the date range
      const date = params.date || new Date().toISOString().slice(0, 10);
      const rangeEnd = params.range_end || date;

      const qp = new URLSearchParams({
        timeMin: `${date}T00:00:00Z`,
        timeMax: `${rangeEnd}T23:59:59Z`,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        showDeleted: 'true',
      });
      events = await fetchEvents(calendarId, token, qp);
    }

    // Load patients from DynamoDB
    const patientItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'PATIENT#',
      },
    });

    // Load completed appointments
    const completedItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'APPT_COMPLETE#',
      },
    });
    const completedIds = new Set(completedItems.map((c) => c.appointmentId as string));

    // Load no-show records
    const noshowItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'APPT_NOSHOW#',
      },
    });
    const noshowIds = new Set(noshowItems.map((n) => n.appointmentId as string));

    // Phone → patient lookup
    const phoneToPatient = new Map<string, { id: string; name: string }>();
    for (const p of patientItems) {
      if (p.phone) {
        const norm = normalizePhone(p.phone as string);
        phoneToPatient.set(norm, {
          id: p.patientId as string,
          name: `${p.firstName} ${p.lastName}`,
        });
      }
    }

    // ── Auto-create patient records for new appointments ──
    const now = new Date().toISOString();
    for (const e of events) {
      if (e.status === 'cancelled') continue;
      const { firstName, lastName } = parseEventSummary(e.summary || '');
      const { phone, email } = parseDescription(e.description || '');
      const normPhone = phone ? normalizePhone(phone) : '';
      if (!normPhone || phoneToPatient.has(normPhone)) continue;
      if (!firstName?.trim() || !lastName?.trim()) continue;

      const patientId = `pt-${randomUUID().slice(0, 12)}`;
      try {
        await putItem({
          PK: `PATIENT#${patientId}`,
          SK: 'PROFILE',
          patientId,
          providerId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone || '',
          email: email || '',
          dob: null,
          gender: null,
          createdAt: now,
          updatedAt: now,
          GSI1PK: `PROVIDER#${providerId}`,
          GSI1SK: `PATIENT#${now}`,
          GSI2PK: 'PATIENT',
          GSI2SK: `${now}#${patientId}`,
          entityType: 'Patient',
          source: 'google-auto',
        });
        phoneToPatient.set(normPhone, { id: patientId, name: `${firstName} ${lastName}` });
        await writeAuditLog({
          providerId,
          action: 'AUTO_CREATE_PATIENT',
          entityType: 'Patient',
          entityId: patientId,
          details: { source: 'google-calendar', eventId: e.id },
        });
        console.log(`Auto-created patient ${patientId} from Google Calendar event ${e.id}: ${firstName} ${lastName}`);
      } catch (err) {
        console.warn(`Failed to auto-create patient for event ${e.id}:`, (err as Error).message);
      }
    }

    // ── Map events to appointment response ──
    const mapped = events.map((e) => {
      const { firstName, lastName, type } = parseEventSummary(e.summary || '');
      const { phone, email, notes } = parseDescription(e.description || '');
      const startTime = e.start?.dateTime || e.start?.date || '';
      const endTime = e.end?.dateTime || e.end?.date || '';
      const durationMs = startTime && endTime
        ? new Date(endTime).getTime() - new Date(startTime).getTime()
        : 0;
      const durationMin = Math.round(durationMs / 60000) || 30;

      const isCancelled = e.status === 'cancelled';
      const isNoShow = noshowIds.has(e.id);
      const isCompleted = completedIds.has(e.id);
      const status = isCancelled
        ? 'cancelled'
        : isNoShow
          ? 'no_show'
          : isCompleted
            ? 'completed'
            : 'scheduled';

      const normPhone = phone ? normalizePhone(phone) : '';
      const matchedPatient = normPhone ? phoneToPatient.get(normPhone) : undefined;

      // Fallback to attendee data if summary parsing was sparse
      const attendee = e.attendees?.[0];
      const patientName = [firstName, lastName].filter(Boolean).join(' ')
        || attendee?.displayName
        || 'Unknown';

      return {
        id: e.id,
        patientName,
        patientPhone: phone || '',
        patientEmail: email || attendee?.email || '',
        patientId: matchedPatient?.id || null,
        type,
        startTime,
        endTime,
        duration: durationMin,
        status,
        notes: notes || '',
        calendar: 'Google Calendar',
        location: '',
        createdAt: e.created || '',
      };
    });

    return success({
      appointments: mapped,
      count: mapped.length,
    });
  } catch (err) {
    console.error('List appointments error:', (err as Error).message);
    return serverError('Failed to retrieve appointments');
  }
};
