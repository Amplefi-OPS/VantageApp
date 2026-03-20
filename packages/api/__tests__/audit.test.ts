/**
 * HIPAA Technical Safeguard: PHI Minimization in Audit Logs
 *
 * Verifies that send-fax audit logging follows HIPAA requirements:
 * - Full fax numbers are NEVER written to audit logs
 * - Only the last 4 digits (pharmacyFaxLast4) are logged
 * - Medication names, dosages, and directions are NEVER in audit details
 * - Audit action is 'FAX_SENT'
 * - PatientId reference (not name or DOB) is included
 */

jest.mock('../shared/auth', () => ({
  getCallerIdentity: jest.fn(() => ({
    sub: 'test-sub-uuid',
    email: 'dr@vantagerefinery.com',
    providerId: 'dr-test-001',
    role: 'provider',
    groups: [],
  })),
}));

jest.mock('../shared/dynamo', () => ({
  putItem: jest.fn().mockResolvedValue({}),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../shared/zoom', () => ({
  zoomPost: jest.fn().mockResolvedValue({ id: 'zoom-fax-123' }),
}));

jest.mock('../shared/secrets', () => ({
  getSecrets: jest.fn().mockResolvedValue({
    ZOOM_USER_EMAIL: 'jane@vantagerefinery.com',
  }),
}));

import { handler } from '../handlers/api/send-fax';
import { writeAuditLog } from '../shared/dynamo';

const mockWriteAuditLog = writeAuditLog as jest.Mock;

function faxEvent(body: Record<string, unknown>): any {
  return {
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    requestContext: { authorizer: { claims: {} } },
  };
}

const FULL_FAX_NUMBER = '+15551234567';
const VALID_RX = {
  medication: 'Lisinopril 10mg tablets',
  dosage: '10mg',
  directions: 'Take one tablet by mouth once daily',
  quantity: 30,
  refills: 3,
  prescriberName: 'Dr. Smith',
};

describe('HIPAA — PHI Minimization in Audit Logs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('audit log contains pharmacyFaxLast4 with only the last 4 digits', async () => {
    const event = faxEvent({
      pharmacy_name: 'CVS Pharmacy',
      pharmacy_fax: FULL_FAX_NUMBER,
      patient_id: 'pt-abc123',
      rx_details: VALID_RX,
    });

    await handler(event, {} as any, () => {});

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    expect(auditArg.details.pharmacyFaxLast4).toBe('4567');
    expect(auditArg.details.pharmacyFaxLast4).toHaveLength(4);
  });

  it('audit log never contains the full fax number', async () => {
    const event = faxEvent({
      pharmacy_name: 'CVS Pharmacy',
      pharmacy_fax: FULL_FAX_NUMBER,
      patient_id: 'pt-abc123',
      rx_details: VALID_RX,
    });

    await handler(event, {} as any, () => {});

    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    const serialized = JSON.stringify(auditArg);
    expect(serialized).not.toContain(FULL_FAX_NUMBER);
    expect(serialized).not.toContain('15551234567');
    expect(serialized).not.toContain('5551234567');
    expect(serialized).not.toContain('551234567');
  });

  it('audit log details never contain medication name, dosage, or directions', async () => {
    const event = faxEvent({
      pharmacy_name: 'CVS Pharmacy',
      pharmacy_fax: FULL_FAX_NUMBER,
      patient_id: 'pt-abc123',
      rx_details: VALID_RX,
    });

    await handler(event, {} as any, () => {});

    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    const detailsStr = JSON.stringify(auditArg.details);
    expect(detailsStr).not.toContain('Lisinopril');
    expect(detailsStr).not.toContain('10mg');
    expect(detailsStr).not.toContain('once daily');
    expect(detailsStr).not.toContain('tablet');
  });

  it('audit log action is FAX_SENT on successful fax send', async () => {
    const event = faxEvent({
      pharmacy_name: 'CVS Pharmacy',
      pharmacy_fax: FULL_FAX_NUMBER,
      patient_id: 'pt-abc123',
    });

    await handler(event, {} as any, () => {});

    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    expect(auditArg.action).toBe('FAX_SENT');
  });

  it('audit log contains patientId reference (not patient name or DOB)', async () => {
    const event = faxEvent({
      pharmacy_name: 'CVS Pharmacy',
      pharmacy_fax: FULL_FAX_NUMBER,
      patient_id: 'pt-abc123',
    });

    await handler(event, {} as any, () => {});

    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    expect(auditArg.details.patientId).toBe('pt-abc123');
    // Verify no PHI fields leaked into audit details
    const detailKeys = Object.keys(auditArg.details);
    expect(detailKeys).not.toContain('patientName');
    expect(detailKeys).not.toContain('dob');
    expect(detailKeys).not.toContain('dateOfBirth');
    expect(detailKeys).not.toContain('pharmacyName');
  });
});
