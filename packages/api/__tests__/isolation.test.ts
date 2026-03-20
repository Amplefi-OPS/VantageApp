/**
 * HIPAA Technical Safeguard: Provider Isolation
 *
 * Verifies that the daily fax task Lambda:
 * - Refuses to start without a PROVIDER_ID env var (fail-safe)
 * - Creates tasks scoped to the correct provider partition key
 * - Uses correct task attributes (type, title, status)
 */

jest.mock('../shared/dynamo', () => ({
  putItem: jest.fn().mockResolvedValue({}),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

describe('HIPAA — Provider Isolation (create-daily-fax-task)', () => {
  const originalProviderId = process.env.PROVIDER_ID;

  afterEach(() => {
    if (originalProviderId !== undefined) {
      process.env.PROVIDER_ID = originalProviderId;
    } else {
      delete process.env.PROVIDER_ID;
    }
  });

  it('throws at module load if PROVIDER_ID env var is missing', () => {
    delete process.env.PROVIDER_ID;
    jest.resetModules();

    expect(() => {
      require('../handlers/api/create-daily-fax-task');
    }).toThrow('PROVIDER_ID environment variable is required');
  });

  it('creates task with PK = PROVIDER#{providerId}', async () => {
    process.env.PROVIDER_ID = 'dr-isolation-001';
    jest.resetModules();

    const dynamo = require('../shared/dynamo') as { putItem: jest.Mock };
    const { handler } = require('../handlers/api/create-daily-fax-task');

    await handler({}, {}, () => {});

    expect(dynamo.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'PROVIDER#dr-isolation-001',
      }),
    );
  });

  it('task type is General, title is Check Fax Inbox, status is Open', async () => {
    process.env.PROVIDER_ID = 'dr-isolation-001';
    jest.resetModules();

    const dynamo = require('../shared/dynamo') as { putItem: jest.Mock };
    const { handler } = require('../handlers/api/create-daily-fax-task');

    await handler({}, {}, () => {});

    expect(dynamo.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'General',
        title: 'Check Fax Inbox',
        status: 'Open',
      }),
    );
  });
});
