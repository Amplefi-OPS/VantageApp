import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type PutCommandInput,
  type GetCommandInput,
  type QueryCommandInput,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;

export async function putItem(item: Record<string, unknown>) {
  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: item,
  };
  return ddb.send(new PutCommand(params));
}

export async function getItem(pk: string, sk: string) {
  const params: GetCommandInput = {
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
  };
  const result = await ddb.send(new GetCommand(params));
  return result.Item;
}

export async function queryItems(params: Omit<QueryCommandInput, 'TableName'>) {
  const result = await ddb.send(
    new QueryCommand({ TableName: TABLE_NAME, ...params }),
  );
  return result.Items || [];
}

export async function updateItem(params: Omit<UpdateCommandInput, 'TableName'>) {
  const result = await ddb.send(
    new UpdateCommand({ TableName: TABLE_NAME, ...params }),
  );
  return result.Attributes;
}

/** Build an UpdateExpression from a partial object. Skips undefined values. */
export function buildUpdateExpression(fields: Record<string, unknown>) {
  const expressionParts: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined) return;
    const nameKey = `#${key}`;
    const valueKey = `:${key}`;
    expressionParts.push(`${nameKey} = ${valueKey}`);
    names[nameKey] = key;
    values[valueKey] = value;
  });

  if (expressionParts.length === 0) return null;

  return {
    UpdateExpression: `SET ${expressionParts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/** Write an audit log entry */
export async function writeAuditLog(entry: {
  providerId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}) {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();

  await putItem({
    PK: `AUDIT#${dateKey}`,
    SK: `${timestamp}#${entry.entityType}#${entry.entityId}`,
    providerId: entry.providerId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details || {},
    createdAt: timestamp,
    // Auto-expire audit logs after 7 years
    ttl: Math.floor(now.getTime() / 1000) + 7 * 365 * 24 * 60 * 60,
  });
}
