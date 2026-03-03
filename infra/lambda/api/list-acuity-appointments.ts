/**
 * GET /appointments?date=YYYY-MM-DD&range_end=YYYY-MM-DD
 *
 * Fetches appointments from Acuity Scheduling API,
 * filtered to the medical calendar (New Patient + Returning Patient types only).
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
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

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Validate caller is authenticated
    getCallerIdentity(event);

    const params = event.queryStringParameters || {};
    const date = params.date || new Date().toISOString().slice(0, 10);
    const rangeEnd = params.range_end || date;

    // Fetch from Acuity — filter to medical calendar, include canceled
    const query = new URLSearchParams({
      minDate: date,
      maxDate: rangeEnd,
      calendarID: CALENDAR_ID,
      max: '100',
      direction: 'ASC',
    });

    const appointments = await acuityGet<AcuityAppointment[]>(`/appointments?${query}`);

    // Also fetch canceled appointments
    const canceledQuery = new URLSearchParams({
      minDate: date,
      maxDate: rangeEnd,
      calendarID: CALENDAR_ID,
      max: '100',
      direction: 'ASC',
      canceled: 'true',
    });
    const canceledAppts = await acuityGet<AcuityAppointment[]>(`/appointments?${canceledQuery}`);

    // Merge: canceled query returns ONLY canceled, so combine both lists
    // Deduplicate by id
    const allMap = new Map<number, AcuityAppointment>();
    for (const a of appointments) allMap.set(a.id, a);
    for (const a of canceledAppts) allMap.set(a.id, a);
    const all = Array.from(allMap.values()).sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    const mapped = all.map((a) => {
      const durationMin = parseInt(a.duration, 10) || 30;
      const status = a.canceled ? 'cancelled' : a.noShow ? 'no_show' : 'scheduled';

      return {
        id: String(a.id),
        patientName: `${a.firstName} ${a.lastName}`,
        patientPhone: a.phone || '',
        patientEmail: a.email || '',
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
