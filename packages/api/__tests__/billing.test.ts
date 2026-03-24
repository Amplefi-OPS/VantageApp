/**
 * Billing Handler Tests
 *
 * 1. lookup: returns 404 for unknown email
 * 2. lookup: normalizes phone to 10 digits before search
 * 3. charge: rejects amount < 50 cents
 * 4. charge: rejects amount > 999999
 * 5. charge: writes audit log on success
 * 6. no-show: returns 400 if no payment method on file
 * 7. no-show: charges exactly 3000 cents
 * 8. no-show: writes audit log
 */

// ── Mocks ──

jest.mock('../shared/auth', () => ({
  getCallerIdentity: jest.fn(() => ({
    sub: 'test-sub',
    email: 'dr@vantagerefinery.com',
    providerId: 'dr-test-001',
    role: 'provider',
    groups: [],
  })),
}));

const mockWriteAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../shared/dynamo', () => ({
  putItem: jest.fn().mockResolvedValue({}),
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
  queryItems: jest.fn().mockResolvedValue([]),
}));

const mockStripeGet = jest.fn();
const mockStripePost = jest.fn();
jest.mock('../shared/stripe', () => ({
  getStripeKey: jest.fn().mockResolvedValue('sk_test_fake'),
  stripeGet: (...args: unknown[]) => mockStripeGet(...args),
  stripePost: (...args: unknown[]) => mockStripePost(...args),
}));

import { handler as lookupHandler } from '../handlers/billing/billing-lookup';
import { handler as chargeHandler } from '../handlers/billing/billing-charge-patient';
import { handler as noshowHandler } from '../handlers/billing/billing-noshow';

function apiEvent(options: {
  body?: Record<string, unknown>;
  queryParams?: Record<string, string>;
} = {}): any {
  return {
    body: options.body ? JSON.stringify(options.body) : null,
    headers: {},
    queryStringParameters: options.queryParams || null,
    pathParameters: null,
    requestContext: { authorizer: { claims: {} } },
  };
}

// ── 1–2: billing-lookup ──

describe('billing-lookup', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 for unknown email', async () => {
    // Stripe email search returns empty
    mockStripeGet.mockResolvedValue({ ok: true, data: { data: [] }, status: 200 });

    const result = await lookupHandler(
      apiEvent({ queryParams: { q: 'nobody@example.com' } }),
      {} as any, () => {},
    );
    expect(result!.statusCode).toBe(404);
    expect(result!.body).toContain('No patient found');
  });

  it('normalizes phone to 10 digits before search', async () => {
    // All Stripe searches return empty to test the normalization path
    mockStripeGet.mockResolvedValue({ ok: true, data: { data: [] }, status: 200 });

    await lookupHandler(
      apiEvent({ queryParams: { q: '(727) 555-1234' } }),
      {} as any, () => {},
    );

    // stripeGet should have been called with the normalized 10-digit phone
    const calls = mockStripeGet.mock.calls.map((c: unknown[]) => c[0] as string);
    const searchCall = calls.find((c: string) => c.includes('customers/search'));
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain('7275551234');
  });
});

// ── 3–5: billing-charge ──

describe('billing-charge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects amount < 50 cents', async () => {
    const result = await chargeHandler(
      apiEvent({ body: { customerId: 'cus_1', paymentMethodId: 'pm_1', amount: 25 } }),
      {} as any, () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('50');
  });

  it('rejects amount > 999999', async () => {
    const result = await chargeHandler(
      apiEvent({ body: { customerId: 'cus_1', paymentMethodId: 'pm_1', amount: 1000000 } }),
      {} as any, () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('999999');
  });

  it('writes audit log on success', async () => {
    mockStripePost.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'pi_test123', status: 'succeeded', amount: 5000 },
    });

    const result = await chargeHandler(
      apiEvent({ body: { customerId: 'cus_1', paymentMethodId: 'pm_1', amount: 5000 } }),
      {} as any, () => {},
    );
    expect(result!.statusCode).toBe(200);

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const audit = mockWriteAuditLog.mock.calls[0][0];
    expect(audit.action).toBe('PATIENT_CHARGED');
    expect(audit.details.amountCents).toBe(5000);
    expect(audit.details.paymentIntentId).toBe('pi_test123');
    expect(audit.details.chargedBy).toBe('dr@vantagerefinery.com');
  });
});

// ── 6–8: billing-noshow ──

describe('billing-noshow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 if no payment method on file', async () => {
    // Customer exists but no default PM and no cards listed
    mockStripeGet
      .mockResolvedValueOnce({
        ok: true, status: 200,
        data: { id: 'cus_1', invoice_settings: { default_payment_method: null } },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        data: { data: [] },
      });

    const result = await noshowHandler(
      apiEvent({ body: { customerId: 'cus_1' } }),
      {} as any, () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('No card on file');
  });

  it('charges exactly 3000 cents', async () => {
    mockStripeGet.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { id: 'cus_1', invoice_settings: { default_payment_method: 'pm_default' } },
    });
    mockStripePost.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { id: 'pi_noshow', status: 'succeeded', amount: 3000 },
    });

    const result = await noshowHandler(
      apiEvent({ body: { customerId: 'cus_1' } }),
      {} as any, () => {},
    );
    expect(result!.statusCode).toBe(200);

    // Verify stripePost was called with amount=3000
    const postCall = mockStripePost.mock.calls[0];
    expect(postCall[1].amount).toBe('3000');
  });

  it('writes audit log on success', async () => {
    mockStripeGet.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { id: 'cus_1', invoice_settings: { default_payment_method: 'pm_default' } },
    });
    mockStripePost.mockResolvedValueOnce({
      ok: true, status: 200,
      data: { id: 'pi_noshow', status: 'succeeded', amount: 3000 },
    });

    await noshowHandler(
      apiEvent({ body: { customerId: 'cus_1' } }),
      {} as any, () => {},
    );

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const audit = mockWriteAuditLog.mock.calls[0][0];
    expect(audit.action).toBe('NO_SHOW_CHARGED');
    expect(audit.details.amountCents).toBe(3000);
    expect(audit.details.paymentIntentId).toBe('pi_noshow');
  });
});
