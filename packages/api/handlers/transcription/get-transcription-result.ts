/**
 * GET /transcription/result?jobName=xxx&recordId=yyy
 *
 * Polls AWS Transcribe Medical for job status and returns the result.
 * If COMPLETED and recordId is provided, updates the voicemail DynamoDB record.
 *
 * Returns 200: { status: string, transcript?: string }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { updateItem, buildUpdateExpression } from '../../shared/dynamo';
import { success, badRequest, serverError } from '../../shared/response';
import { getMedicalTranscriptionResult } from '../../shared/transcribe';

const JOB_NAME_PATTERN = /^[a-z]+-[a-f0-9-]{36}$/;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    const jobName = event.queryStringParameters?.jobName;
    if (!jobName || !JOB_NAME_PATTERN.test(jobName)) {
      return badRequest('jobName is required and must match pattern: lowercase-type-uuid');
    }

    const result = await getMedicalTranscriptionResult(jobName);

    // If completed and recordId provided, update the voicemail record
    const recordId = event.queryStringParameters?.recordId;
    if (result.status === 'COMPLETED' && recordId) {
      const now = new Date().toISOString();
      const expr = buildUpdateExpression({
        transcript: result.transcript || null,
        transcriptionStatus: 'COMPLETED',
        updatedAt: now,
      });
      if (expr) {
        try {
          await updateItem({
            Key: { PK: `VOICEMAIL#${recordId}`, SK: `VOICEMAIL#${recordId}` },
            ...expr,
          });
        } catch (err) {
          console.warn('Failed to update voicemail record (non-fatal):', (err as Error).message);
        }
      }
    }

    return success({
      status: result.status,
      transcript: result.transcript,
    });
  } catch (err) {
    console.error('Get transcription result error:', (err as Error).message);
    return serverError('Failed to get transcription result');
  }
};
