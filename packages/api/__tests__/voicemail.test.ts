/**
 * Voicemail Deletion Tests
 *
 * Verifies that delete-voicemail.ts:
 * - Blocks deletion if no taskId on voicemail record
 * - Blocks deletion if linked task is not Done
 * - Returns 404 if voicemail not found
 * - On success: calls Zoom delete, S3 delete, DynamoDB delete, audit log
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

const mockGetItem = jest.fn();
const mockDeleteItem = jest.fn().mockResolvedValue({});
const mockWriteAuditLog = jest.fn().mockResolvedValue(undefined);

jest.mock('../shared/dynamo', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

const mockZoomDelete = jest.fn().mockResolvedValue(undefined);
jest.mock('../shared/zoom', () => ({
  zoomDelete: (...args: unknown[]) => mockZoomDelete(...args),
}));

const mockS3Send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

process.env.AUDIO_BUCKET = 'test-audio-bucket';

import { handler } from '../handlers/api/delete-voicemail';

function deleteEvent(voicemailId: string, queryParams?: Record<string, string>): any {
  return {
    body: null,
    headers: {},
    httpMethod: 'DELETE',
    pathParameters: { id: voicemailId },
    queryStringParameters: queryParams || null,
    requestContext: { authorizer: { claims: {} } },
  };
}

describe('DELETE /voicemails/{id}', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 if voicemail not found', async () => {
    mockGetItem.mockResolvedValueOnce(undefined);

    const result = await handler(deleteEvent('vm-nonexistent'), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
    expect(result!.body).toContain('Voicemail not found');
  });

  it('returns 403 if no taskId on voicemail', async () => {
    mockGetItem.mockResolvedValueOnce({
      voicemailId: 'vm-001',
      providerId: 'dr-test-001',
      s3Key: 'voicemails/dr-test-001/vm-001.mp3',
      // no taskId
    });

    const result = await handler(deleteEvent('vm-001'), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
    expect(result!.body).toContain('related task is completed');
  });

  it('returns 403 if linked task is not Done', async () => {
    // First call: getItem for voicemail
    mockGetItem.mockResolvedValueOnce({
      voicemailId: 'vm-001',
      providerId: 'dr-test-001',
      taskId: 'task-abc',
      s3Key: 'voicemails/dr-test-001/vm-001.mp3',
    });
    // Second call: getItem for task
    mockGetItem.mockResolvedValueOnce({
      taskId: 'task-abc',
      status: 'Open',
    });

    const result = await handler(deleteEvent('vm-001'), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
    expect(result!.body).toContain('related task is completed');
  });

  it('deletes from Zoom, S3, and DynamoDB on success', async () => {
    // getItem for voicemail
    mockGetItem.mockResolvedValueOnce({
      voicemailId: 'vm-001',
      providerId: 'dr-test-001',
      taskId: 'task-abc',
      s3Key: 'voicemails/dr-test-001/vm-001.mp3',
    });
    // getItem for task
    mockGetItem.mockResolvedValueOnce({
      taskId: 'task-abc',
      status: 'Done',
    });

    const result = await handler(deleteEvent('vm-001'), {} as any, () => {});
    expect(result!.statusCode).toBe(204);

    // Zoom delete called
    expect(mockZoomDelete).toHaveBeenCalledWith('/phone/voice_mails/vm-001');

    // S3 delete called
    expect(mockS3Send).toHaveBeenCalledTimes(1);

    // DynamoDB delete called
    expect(mockDeleteItem).toHaveBeenCalledWith(
      'PROVIDER#dr-test-001',
      'VOICEMAIL#vm-001',
    );
  });

  it('writes audit log on success', async () => {
    mockGetItem.mockResolvedValueOnce({
      voicemailId: 'vm-001',
      providerId: 'dr-test-001',
      taskId: 'task-abc',
      s3Key: 'voicemails/dr-test-001/vm-001.mp3',
    });
    mockGetItem.mockResolvedValueOnce({
      taskId: 'task-abc',
      status: 'Done',
    });

    await handler(deleteEvent('vm-001'), {} as any, () => {});

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    expect(auditArg.action).toBe('VOICEMAIL_DELETED');
    expect(auditArg.entityId).toBe('vm-001');
    expect(auditArg.details.taskId).toBe('task-abc');
    expect(auditArg.details.deletedBy).toBe('dr@vantagerefinery.com');
  });
});
