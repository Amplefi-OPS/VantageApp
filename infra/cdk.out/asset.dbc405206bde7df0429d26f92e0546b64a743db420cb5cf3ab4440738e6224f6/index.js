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

// lambda/billing/stripe-processor.ts
var stripe_processor_exports = {};
__export(stripe_processor_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(stripe_processor_exports);
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

// lambda/billing/stripe-processor.ts
var sm = new import_client_secrets_manager.SecretsManagerClient({});
var STRIPE_SECRET_ARN = process.env.STRIPE_SECRET_ARN;
var stripeApiKey = null;
async function getStripeKey() {
  if (stripeApiKey) return stripeApiKey;
  const secret = await sm.send(
    new import_client_secrets_manager.GetSecretValueCommand({ SecretId: STRIPE_SECRET_ARN })
  );
  stripeApiKey = secret.SecretString || "";
  return stripeApiKey;
}
var StripeChargeProvider = class {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  async createCharge(request) {
    console.log("Stripe createCharge:", {
      amount: request.amount_cents,
      currency: request.currency,
      reference: request.billing_reference
      // NOTE: No PHI fields logged or sent
    });
    const stubId = `ch_stub_${Date.now()}`;
    console.log(`[STUB] Stripe charge created: ${stubId} for ${request.amount_cents} ${request.currency}`);
    return { success: true, external_id: stubId };
  }
  async refundCharge(request) {
    console.log("Stripe refundCharge:", {
      reference: request.billing_reference,
      amount: request.amount_cents
    });
    const stubId = `re_stub_${Date.now()}`;
    console.log(`[STUB] Stripe refund created: ${stubId}`);
    return { success: true, external_id: stubId };
  }
  async recordEvent(request) {
    console.log("Stripe recordEvent: no-op (use QuickBooks for bookkeeping)");
    return { success: true, external_id: `stripe_noop_${Date.now()}` };
  }
};
var handler = async (event) => {
  const detail = event.detail;
  const detailType = event["detail-type"];
  console.log(`Processing billing event: ${detailType} for ${detail.billing_event_id}`);
  const apiKey = await getStripeKey();
  const provider = new StripeChargeProvider(apiKey);
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
    stripeStatus: result.success ? "completed" : "failed",
    stripeExternalId: result.external_id || null,
    stripeError: result.error || null,
    stripeProcessedAt: now,
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
    action: `STRIPE_${detailType.toUpperCase()}_${result.success ? "SUCCESS" : "FAILURE"}`,
    entityType: "BillingEvent",
    entityId: detail.billing_event_id,
    details: {
      externalId: result.external_id,
      error: result.error
    }
  });
  console.log(`Stripe processing complete: ${result.success ? "SUCCESS" : "FAILURE"}`);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
