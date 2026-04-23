/**
 * POST /voicemails/{id}/attach  (EMR)
 *
 * Attach an unmatched voicemail to a patient. Atomic move: delete from
 * PK=VOICEMAIL#UNMATCHED partition and put under PK=PATIENT#{pid}, with
 * audit fields stamped (matched_by, matched_at, match_source).
 *
 * Body:
 *   { patient_id: "pt_...", match_source: "auto" | "manual" }
 *
 * Responses:
 *   200 → { voicemail: { ... } }  (the attached item, as written)
 *   400 → invalid body / unknown match_source
 *   404 → voicemail not found in unmatched queue, or patient not found
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  success, badRequest, notFound, serverError, setRequestOrigin, parseBody,
} from '../../shared/response';

const TABLE_NAME = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    setRequestOrigin(event.headers?.origin || event.headers?.Origin);

    const vmId = event.pathParameters?.id;
    if (!vmId) return badRequest('voicemail id required');

    const body = parseBody(event) as { patient_id?: string; match_source?: string } | null;
    if (!body) return badRequest('Invalid JSON body');
    const { patient_id: patientId, match_source } = body;
    if (!patientId || !patientId.startsWith('pt_')) {
      return badRequest('patient_id required (must start with "pt_")');
    }
    if (match_source !== 'auto' && match_source !== 'manual') {
      return badRequest('match_source must be "auto" or "manual"');
    }

    // Look up the unmatched voicemail. SK is VM#{received_at}#{vm_id}, but we
    // only have vm_id — filter the partition (1-2 items/day typical, trivial scan).
    const found = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'voicemail_id = :vmid',
      ExpressionAttributeValues: { ':pk': 'VOICEMAIL#UNMATCHED', ':vmid': vmId },
    }));
    const vm = found.Items?.[0];
    if (!vm) return notFound('Voicemail not found in unmatched queue');

    // Verify the patient exists.
    const patient = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PATIENT#${patientId}`, SK: 'PROFILE' },
    }));
    if (!patient.Item) return notFound('Patient not found');

    // Extract matched_by from Cognito claims in prod; fallback "dev" when no authorizer is attached.
    const claims = (event.requestContext as { authorizer?: { claims?: Record<string, string> } })
      ?.authorizer?.claims;
    const matchedBy = claims?.sub ?? claims?.email ?? 'dev';
    const matchedAt = new Date().toISOString();

    const attachedItem = {
      PK: `PATIENT#${patientId}`,
      SK: `VOICEMAIL#${vm.received_at}#${vm.voicemail_id}`,
      entity_type: 'voicemail_attached',
      voicemail_id: vm.voicemail_id,
      patient_id: patientId,
      caller_id: vm.caller_id,
      caller_id_raw: vm.caller_id_raw,
      caller_name_cnam: vm.caller_name_cnam,
      received_at: vm.received_at,
      duration_seconds: vm.duration_seconds,
      transcript: vm.transcript,
      source: vm.source,
      matched_by: matchedBy,
      matched_at: matchedAt,
      match_source: match_source,
    };

    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE_NAME, Key: { PK: vm.PK, SK: vm.SK } } },
        { Put: { TableName: TABLE_NAME, Item: attachedItem } },
      ],
    }));

    const { PK, SK, entity_type, ...voicemail } = attachedItem;
    return success({ voicemail });
  } catch (err) {
    console.error('EMR attach voicemail error:', (err as Error).message);
    return serverError('Failed to attach voicemail');
  }
};
