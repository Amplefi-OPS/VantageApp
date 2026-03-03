/**
 * GET /appointments?date=YYYY-MM-DD&range_end=YYYY-MM-DD&phone=+1234567890
 *
 * Fetches appointments from Acuity Scheduling API,
 * filtered to the medical calendar (New Patient + Returning Patient types only).
 * Matches patient phone numbers against DynamoDB to attach patientId.
 *
 * If `phone` is provided, filters Acuity results to that phone number
 * and skips the date range (returns all upcoming for that patient).
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { queryItems } from '../shared/dynamo';
import { success, serverError } from '../shared/response';

const ACUITY_USER_ID = process.env.ACUITY_USER_ID!;
const ACUITY_API_KEY = process.env.ACUITY_API_KEY!;
const ACUITY_BASE = 'https://acuityscheduling.com/api/v1';

// Only show appointments from the medical calendar
const CALENDAR_ID = '13227530'; // Vantage Refinery Appointments

interface AcuityAppointment {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  datetime: string;
  date: string;
  time: string;
  endTime: string;
  duration: string;
  type: string;
  appointmentTypeID: number;
  calendar: string;
  calendarID: number;
  canceled: boolean;
  noShow: boolean;
  notes: string;
  timezone: string;
  forms: unknown[];
  formsText: string;
  location: string;
  dateCreated: string;
  datetimeCreated: string;
}

async function acuityGet<T>(path: string): Promise<T> {
  const auth = Buffer.from(`${ACUITY_USER_ID}:${ACUITY_API_KEY}`).toString('base64');
  const res = await fetch(`${ACUITY_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Acuity API error (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// Map Acuity type names to short display labels
function shortTypeName(acuityType: string): string {
  if (acuityType.toLowerCase().includes('new patient')) return 'New Patient';
  if (acuityType.toLowerCase().includes('returning') || acuityType.toLowerCase().includes('follow')) return 'Returning Patient';
  return acuityType;
}

// Compute ISO end time from start datetime + duration minutes
function computeEndTime(datetime: string, durationMin: number): string {
  const d = new Date(datetime);
  d.setMinutes(d.getMinutes() + durationMin);
  return d.toISOString();
}

// Normalize phone to digits only for matching
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const params = event.queryStringParameters || {};
    const rawPhone = params.phone;

    // Normalize phone to E.164 (+1XXXXXXXXXX) for Acuity API matching
    let phoneFilter: string | undefined;
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length === 10) {
        phoneFilter = `+1${digits}`;
      } else if (digits.length === 11 && digits.startsWith('1')) {
        phoneFilter = `+${digits}`;
      } else {
        phoneFilter = rawPhone; // pass through as-is
      }
    }

    let allAcuity: AcuityAppointment[];

    if (phoneFilter) {
      // Patient-specific: fetch all appointments for this phone (past 6 months + upcoming)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const sixMonthsAhead = new Date();
      sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);

      const query = new URLSearchParams({
        minDate: sixMonthsAgo.toISOString().slice(0, 10),
        maxDate: sixMonthsAhead.toISOString().slice(0, 10),
        calendarID: CALENDAR_ID,
        phone: phoneFilter,
        max: '100',
        direction: 'DESC',
      });
      const appts = await acuityGet<AcuityAppointment[]>(`/appointments?${query}`);

      // Also fetch canceled for this phone
      query.set('canceled', 'true');
      const canceled = await acuityGet<AcuityAppointment[]>(`/appointments?${query}`);

      const dedup = new Map<number, AcuityAppointment>();
      for (const a of appts) dedup.set(a.id, a);
      for (const a of canceled) dedup.set(a.id, a);
      allAcuity = Array.from(dedup.values()).sort(
        (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
      );
    } else {
      // Date-based: fetch appointments for the date range
      const date = params.date || new Date().toISOString().slice(0, 10);
      const rangeEnd = params.range_end || date;

      const query = new URLSearchParams({
        minDate: date,
        maxDate: rangeEnd,
        calendarID: CALENDAR_ID,
        max: '100',
        direction: 'ASC',
      });
      const appts = await acuityGet<AcuityAppointment[]>(`/appointments?${query}`);

      const canceledQuery = new URLSearchParams({
        minDate: date,
        maxDate: rangeEnd,
        calendarID: CALENDAR_ID,
        max: '100',
        direction: 'ASC',
        canceled: 'true',
      });
      const canceled = await acuityGet<AcuityAppointment[]>(`/appointments?${canceledQuery}`);

      const dedup = new Map<number, AcuityAppointment>();
      for (const a of appts) dedup.set(a.id, a);
      for (const a of canceled) dedup.set(a.id, a);
      allAcuity = Array.from(dedup.values()).sort(
        (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
      );
    }

    // Load patients from DynamoDB to match phone numbers → patientId
    const patientItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'PATIENT#',
      },
    });

    // Load completed appointments from DynamoDB
    const completedItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'APPT_COMPLETE#',
      },
    });
    const completedIds = new Set(completedItems.map((c) => c.appointmentId as string));

    // Build phone → patientId lookup (normalized)
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

    const mapped = allAcuity.map((a) => {
      const durationMin = parseInt(a.duration, 10) || 30;
      const isCompleted = completedIds.has(String(a.id));
      const status = a.canceled ? 'cancelled' : a.noShow ? 'no_show' : isCompleted ? 'completed' : 'scheduled';
      const normPhone = a.phone ? normalizePhone(a.phone) : '';
      const matchedPatient = normPhone ? phoneToPatient.get(normPhone) : undefined;

      return {
        id: String(a.id),
        patientName: `${a.firstName} ${a.lastName}`,
        patientPhone: a.phone || '',
        patientEmail: a.email || '',
        patientId: matchedPatient?.id || null,
        type: shortTypeName(a.type),
        startTime: a.datetime,
        endTime: computeEndTime(a.datetime, durationMin),
        duration: durationMin,
        status,
        notes: a.notes || '',
        calendar: a.calendar,
        location: a.location || '',
        acuityTypeId: a.appointmentTypeID,
        createdAt: a.datetimeCreated,
      };
    });

    return success({
      appointments: mapped,
      count: mapped.length,
    });
  } catch (err) {
    console.error('List Acuity appointments error:', err);
    return serverError('Failed to retrieve appointments');
  }
};
