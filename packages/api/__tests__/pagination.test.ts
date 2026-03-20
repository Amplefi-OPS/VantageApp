/**
 * HIPAA Technical Safeguard: Pagination Bounds
 *
 * Verifies that list endpoints enforce safe pagination limits.
 * Unbounded queries can cause denial-of-service or expose excessive
 * records. Limits are clamped to [1, 100] and invalid cursors are rejected.
 */

jest.mock('../shared/auth', () => ({
  getCallerIdentity: jest.fn(() => ({
    sub: 'test-sub-uuid',
    email: 'dr@vantagerefinery.com',
    providerId: 'dr-test-001',
    role: 'provider',
    groups: [],
  })),
  isAdmin: jest.fn(() => false),
}));

jest.mock('../shared/dynamo', () => ({
  queryItemsPaginated: jest.fn().mockResolvedValue({
    items: [],
    lastEvaluatedKey: undefined,
  }),
}));

import { handler } from '../handlers/api/list-patients';
import { queryItemsPaginated } from '../shared/dynamo';

const mockQuery = queryItemsPaginated as jest.Mock;

function listEvent(queryParams: Record<string, string> | null): any {
  return {
    body: null,
    headers: {},
    queryStringParameters: queryParams,
    pathParameters: null,
    requestContext: { authorizer: { claims: {} } },
  };
}

describe('HIPAA — Pagination Bounds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ items: [], lastEvaluatedKey: undefined });
  });

  it('clamps limit below 1 to 1', async () => {
    await handler(listEvent({ limit: '0' }), {} as any, () => {});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ Limit: 1 }),
    );
  });

  it('clamps limit above 100 to 100', async () => {
    await handler(listEvent({ limit: '999' }), {} as any, () => {});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ Limit: 100 }),
    );
  });

  it('returns 400 for invalid (non-base64) nextToken', async () => {
    const result = await handler(
      listEvent({ nextToken: '!!!not-valid-json!!!' }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('Invalid nextToken');
  });

  it('decodes a valid base64 nextToken without error', async () => {
    const cursor = { PK: 'PATIENT#pt-999', SK: 'PROFILE' };
    const token = Buffer.from(JSON.stringify(cursor)).toString('base64');

    await handler(listEvent({ nextToken: token }), {} as any, () => {});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        ExclusiveStartKey: cursor,
      }),
    );
  });
});
