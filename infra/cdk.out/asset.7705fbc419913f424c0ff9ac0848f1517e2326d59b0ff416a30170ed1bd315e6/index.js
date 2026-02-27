"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lambda/billing/quickbooks-processor.ts
var quickbooks_processor_exports = {};
__export(quickbooks_processor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(quickbooks_processor_exports);
var import_client_secrets_manager = require("@aws-sdk/client-secrets-manager");

// lambda/shared/dynamo.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var client = new import_client_dynamodb.DynamoDBClient({});
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});
var TABLE_NAME = process.env.TABLE_NAME;
async function putItem(item) {
  const params = {
    TableName: TABLE_NAME,
    Item: item
  };
  return ddb.send(new import_lib_dynamodb.PutCommand(params));
}
async function updateItem(params) {
  const result = await ddb.send(
    new import_lib_dynamodb.UpdateCommand({ TableName: TABLE_NAME, ...params })
  );
  return result.Attributes;
}
function buildUpdateExpression(fields) {
  const expressionParts = [];
  const names = {};
  const values = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (value === void 0) return;
    const nameKey = `#${key}`;
    const valueKey = `:${key}`;
    expressionParts.push(`${nameKey} = ${valueKey}`);
    names[nameKey] = key;
    values[valueKey] = value;
  });
  if (expressionParts.length === 0) return null;
  return {
    UpdateExpression: `SET ${expressionParts.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  };
}
async function writeAuditLog(entry) {
  const now = /* @__PURE__ */ new Date();
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
    ttl: Math.floor(now.getTime() / 1e3) + 7 * 365 * 24 * 60 * 60
  });
}

// lambda/billing/quickbooks-processor.ts
var sm = new import_client_secrets_manager.SecretsManagerClient({});
var QB_CREDENTIALS_ARN = process.env.QB_CREDENTIALS_ARN;
var cachedCredentials = null;
async function getQBCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const secret = await sm.send(
    new import_client_secrets_manager.GetSecretValueCommand({ SecretId: QB_CREDENTIALS_ARN })
  );
  cachedCredentials = JSON.parse(secret.SecretString || "{}");
  return cachedCredentials;
}
var QuickBooksProvider = class {
  constructor(credentials) {
    this.credentials = credentials;
  }
  async createCharge(request) {
    console.log("QuickBooks createCharge:", {
      amount: request.amount_cents,
      reference: request.billing_reference
    });
    const stubId = `qb_inv_${Date.now()}`;
    console.log(`[STUB] QuickBooks invoice created: ${stubId}`);
    return { success: true, external_id: stubId };
  }
  async refundCharge(request) {
    console.log("QuickBooks refundCharge:", {
      reference: request.billing_reference,
      amount: request.amount_cents
    });
    const stubId = `qb_ref_${Date.now()}`;
    console.log(`[STUB] QuickBooks refund created: ${stubId}`);
    return { success: true, external_id: stubId };
  }
  async recordEvent(request) {
    console.log("QuickBooks recordEvent:", {
      reference: request.billing_reference,
      amount: request.amount_cents,
      description: request.description
    });
    const stubId = `qb_je_${Date.now()}`;
    console.log(`[STUB] QuickBooks journal entry created: ${stubId}`);
    return { success: true, external_id: stubId };
  }
};
var handler = async (event) => {
  const detail = event.detail;
  const detailType = event["detail-type"];
  console.log(`Processing QuickBooks event: ${detailType} for ${detail.billing_event_id}`);
  const credentials = await getQBCredentials();
  const provider = new QuickBooksProvider(credentials);
  let result;
  switch (detailType) {
    case "ChargeRequested":
      result = await provider.createCharge(detail);
      break;
    case "RefundRequested":
      result = await provider.refundCharge(detail);
      break;
    case "RecordEvent":
      result = await provider.recordEvent(detail);
      break;
    default:
      console.error(`Unknown detail type: ${detailType}`);
      return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updates = buildUpdateExpression({
    quickbooksStatus: result.success ? "completed" : "failed",
    quickbooksExternalId: result.external_id || null,
    quickbooksError: result.error || null,
    quickbooksProcessedAt: now,
    updatedAt: now
  });
  if (updates) {
    await updateItem({
      Key: {
        PK: `BILLING#${detail.billing_event_id}`,
        SK: "EVENT"
      },
      ...updates
    });
  }
  await writeAuditLog({
    providerId: detail.provider_id,
    action: `QUICKBOOKS_${detailType.toUpperCase()}_${result.success ? "SUCCESS" : "FAILURE"}`,
    entityType: "BillingEvent",
    entityId: detail.billing_event_id,
    details: {
      externalId: result.external_id,
      error: result.error
    }
  });
  console.log(`QuickBooks processing complete: ${result.success ? "SUCCESS" : "FAILURE"}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
