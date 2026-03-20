/**
 * Transcription Pipeline Tests
 *
 * Tests for the AWS Transcribe Medical pipeline handlers:
 * 1. get-upload-url: presigned URL generation with format validation
 * 2. start-medical-transcription: path traversal guard, jobType validation, 202 on success
 * 3. get-transcription-result: jobName validation, IN_PROGRESS and COMPLETED flows
 * 4. Audit log written on transcription start
 */

// ── Mocks ──

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
  updateItem: jest.fn().mockResolvedValue({}),
  buildUpdateExpression: jest.fn((fields: Record<string, unknown>) => {
    const parts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      parts.push(`#${k} = :${k}`);
      names[`#${k}`] = k;
      values[`:${k}`] = v;
    }
    if (parts.length === 0) return null;
    return {
      UpdateExpression: `SET ${parts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };
  }),
}));

// Mock the transcribe shared helper (used by start-medical-transcription and get-transcription-result)
jest.mock('../shared/transcribe', () => ({
  startMedicalTranscriptionJob: jest.fn().mockResolvedValue(undefined),
  getMedicalTranscriptionResult: jest.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
  AUDIO_BUCKET_NAME: 'test-audio-bucket',
  TRANSCRIPTION_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:123456789:key/test-key',
}));

// Mock S3 presigner (used by get-upload-url)
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/test-presigned-url'),
}));

// Mock S3 client constructor (used by get-upload-url)
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({})),
    PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
    GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  };
});

// Set env vars before handler imports resolve
process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
process.env.TRANSCRIPTION_KMS_KEY_ARN = 'arn:aws:kms:us-east-1:123456789:key/test-key';

import { handler as getUploadUrlHandler } from '../handlers/transcription/get-upload-url';
import { handler as startTranscriptionHandler } from '../handlers/transcription/start-medical-transcription';
import { handler as getResultHandler } from '../handlers/transcription/get-transcription-result';
import { writeAuditLog } from '../shared/dynamo';
import { getMedicalTranscriptionResult } from '../shared/transcribe';

const mockWriteAuditLog = writeAuditLog as jest.Mock;
const mockGetResult = getMedicalTranscriptionResult as jest.Mock;

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

// ── 1. get-upload-url ──

describe('get-upload-url', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid format with 400', async () => {
    const result = await getUploadUrlHandler(
      apiEvent({ queryParams: { format: 'exe' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('Invalid format');
  });

  it('rejects missing format with 400', async () => {
    const result = await getUploadUrlHandler(
      apiEvent({ queryParams: {} }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
  });

  it('returns correct s3Key prefix for valid format', async () => {
    const result = await getUploadUrlHandler(
      apiEvent({ queryParams: { format: 'webm' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.s3Key).toMatch(/^audio\/dictation\/[a-f0-9-]+\.webm$/);
    expect(body.uploadUrl).toBeDefined();
  });

  it('accepts all valid formats: wav, mp4, webm, ogg', async () => {
    for (const format of ['wav', 'mp4', 'webm', 'ogg']) {
      const result = await getUploadUrlHandler(
        apiEvent({ queryParams: { format } }),
        {} as any,
        () => {},
      );
      expect(result!.statusCode).toBe(200);
      const body = JSON.parse(result!.body);
      expect(body.s3Key).toContain(`.${format}`);
    }
  });
});

// ── 2. start-medical-transcription ──

describe('start-medical-transcription', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects path traversal in s3Key with 400', async () => {
    const result = await startTranscriptionHandler(
      apiEvent({ body: { s3Key: '../secrets/creds.json', jobType: 'DICTATION' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('s3Key must start with');
  });

  it('rejects s3Key not starting with audio/', async () => {
    const result = await startTranscriptionHandler(
      apiEvent({ body: { s3Key: 'uploads/file.webm', jobType: 'DICTATION' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
  });

  it('rejects bad jobType with 400', async () => {
    const result = await startTranscriptionHandler(
      apiEvent({ body: { s3Key: 'audio/test.webm', jobType: 'INVALID' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('jobType must be DICTATION or VOICEMAIL');
  });

  it('returns 202 with jobName on success', async () => {
    const result = await startTranscriptionHandler(
      apiEvent({
        body: {
          s3Key: 'audio/dictation/test-uuid.webm',
          jobType: 'DICTATION',
          recordId: 'dict-123',
        },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(202);
    const body = JSON.parse(result!.body);
    expect(body.jobName).toBeDefined();
    expect(body.jobName).toMatch(/^dictation-[a-f0-9-]+$/);
  });

  it('jobName contains no PHI — only type prefix and UUID', async () => {
    const result = await startTranscriptionHandler(
      apiEvent({
        body: { s3Key: 'audio/dictation/test.webm', jobType: 'VOICEMAIL' },
      }),
      {} as any,
      () => {},
    );
    const body = JSON.parse(result!.body);
    expect(body.jobName).toMatch(/^voicemail-[a-f0-9-]+$/);
    // No patient info, provider info, or filenames in job name
    expect(body.jobName).not.toContain('test');
    expect(body.jobName).not.toContain('dr-');
  });
});

// ── 3. get-transcription-result ──

describe('get-transcription-result', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects missing jobName with 400', async () => {
    const result = await getResultHandler(
      apiEvent({ queryParams: {} }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(result!.body).toContain('jobName');
  });

  it('rejects malformed jobName with 400', async () => {
    const result = await getResultHandler(
      apiEvent({ queryParams: { jobName: 'INVALID_NAME!!!' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
  });

  it('returns IN_PROGRESS when job is still running', async () => {
    mockGetResult.mockResolvedValueOnce({ status: 'IN_PROGRESS' });

    const result = await getResultHandler(
      apiEvent({ queryParams: { jobName: 'dictation-a1b2c3d4-e5f6-7890-abcd-ef1234567890' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.transcript).toBeUndefined();
  });

  it('returns transcript string when COMPLETED', async () => {
    mockGetResult.mockResolvedValueOnce({
      status: 'COMPLETED',
      transcript: 'Patient presents with mild cough and sore throat.',
    });

    const result = await getResultHandler(
      apiEvent({ queryParams: { jobName: 'dictation-a1b2c3d4-e5f6-7890-abcd-ef1234567890' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('COMPLETED');
    expect(body.transcript).toBe('Patient presents with mild cough and sore throat.');
  });
});

// ── 4. Audit log on transcription start ──

describe('Audit log on transcription start', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes audit log with TRANSCRIPTION_STARTED on successful start', async () => {
    await startTranscriptionHandler(
      apiEvent({
        body: {
          s3Key: 'audio/dictation/test.webm',
          jobType: 'DICTATION',
          recordId: 'dict-abc',
        },
      }),
      {} as any,
      () => {},
    );

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    expect(auditArg.action).toBe('TRANSCRIPTION_STARTED');
    expect(auditArg.details.jobType).toBe('DICTATION');
    expect(auditArg.details.recordId).toBe('dict-abc');
    expect(auditArg.details.jobName).toBeDefined();
  });

  it('audit log does not contain any PHI', async () => {
    await startTranscriptionHandler(
      apiEvent({
        body: {
          s3Key: 'audio/dictation/test.webm',
          jobType: 'VOICEMAIL',
          recordId: 'vm-123',
        },
      }),
      {} as any,
      () => {},
    );

    const auditArg = mockWriteAuditLog.mock.calls[0][0];
    const serialized = JSON.stringify(auditArg);
    // No patient names, DOB, or medical content in audit log
    expect(serialized).not.toContain('patient');
    expect(serialized).not.toContain('dob');
    expect(serialized).not.toContain('medication');
  });
});
