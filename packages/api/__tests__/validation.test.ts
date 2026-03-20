/**
 * HIPAA Technical Safeguard: Input Validation (Rx Prescription Fields)
 *
 * Verifies server-side validation of prescription data in send-fax.ts.
 * Frontend-only validation is never sufficient for controlled substance
 * prescriptions — the server must enforce all field requirements.
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

function faxEvent(body: Record<string, unknown>): any {
  return {
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    requestContext: { authorizer: { claims: {} } },
  };
}

const BASE_BODY = {
  pharmacy_name: 'CVS Pharmacy',
  pharmacy_fax: '+15551234567',
  patient_id: 'pt-abc123',
};

const VALID_RX = {
  medication: 'Lisinopril',
  dosage: '10mg',
  directions: 'Take once daily',
  quantity: 30,
  refills: 3,
  prescriberName: 'Dr. Smith',
};

async function callHandler(rxOverrides: Record<string, unknown> | undefined) {
  const body = rxOverrides === undefined
    ? { ...BASE_BODY }
    : { ...BASE_BODY, rx_details: { ...VALID_RX, ...rxOverrides } };
  const result = await handler(faxEvent(body), {} as any, () => {});
  return result!;
}

describe('HIPAA — Input Validation (Rx Prescription Fields)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects missing medication with 400', async () => {
    const result = await callHandler({ medication: undefined });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('medication');
  });

  it('rejects missing dosage with 400', async () => {
    const result = await callHandler({ dosage: undefined });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('dosage');
  });

  it('rejects missing directions with 400', async () => {
    const result = await callHandler({ directions: undefined });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('directions');
  });

  it('rejects quantity as string "abc" with 400', async () => {
    const result = await callHandler({ quantity: 'abc' });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('quantity');
  });

  it('rejects quantity as 0 with 400', async () => {
    const result = await callHandler({ quantity: 0 });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('quantity');
  });

  it('rejects refills as 13 (above max 12) with 400', async () => {
    const result = await callHandler({ refills: 13 });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('refills');
  });

  it('rejects refills as -1 with 400', async () => {
    const result = await callHandler({ refills: -1 });
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('refills');
  });

  it('accepts all valid Rx fields (201 created)', async () => {
    const result = await callHandler({});
    expect(result.statusCode).toBe(201);
  });

  it('accepts request with no rx_details at all (201 created)', async () => {
    const result = await callHandler(undefined);
    expect(result.statusCode).toBe(201);
  });
});
