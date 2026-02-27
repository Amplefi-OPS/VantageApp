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

// lambda/transcription/start-transcription.ts
var start_transcription_exports = {};
__export(start_transcription_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(start_transcription_exports);
var import_client_transcribe = require("@aws-sdk/client-transcribe");

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

// lambda/transcription/start-transcription.ts
var transcribe = new import_client_transcribe.TranscribeClient({});
var TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET;
var KMS_KEY_ARN = process.env.KMS_KEY_ARN;
var EXT_TO_FORMAT = {
  m4a: "mp4",
  mp3: "mp3",
  mp4: "mp4",
  wav: "wav",
  flac: "flac"
};
var handler = async (input) => {
  const { bucket, key, providerId, dictationId, date } = input;
  const ext = key.split(".").pop()?.toLowerCase() || "m4a";
  const mediaFormat = EXT_TO_FORMAT[ext] || "mp4";
  const jobName = `vantage-${dictationId}-${Date.now()}`;
  const outputKey = `transcripts/${providerId}/${date}/${dictationId}.json`;
  console.log(`Starting Transcribe Medical job: ${jobName}`);
  await transcribe.send(new import_client_transcribe.StartMedicalTranscriptionJobCommand({
    MedicalTranscriptionJobName: jobName,
    LanguageCode: "en-US",
    MediaFormat: mediaFormat,
    Media: {
      MediaFileUri: `s3://${bucket}/${key}`
    },
    OutputBucketName: TRANSCRIPT_BUCKET,
    OutputKey: outputKey,
    OutputEncryptionKMSKeyId: KMS_KEY_ARN,
    Specialty: "PRIMARYCARE",
    Type: "DICTATION",
    Settings: {
      ShowSpeakerLabels: false,
      ChannelIdentification: false
    }
  }));
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updates = buildUpdateExpression({
    status: "Transcribing",
    jobName,
    transcriptKey: outputKey,
    updatedAt: now,
    GSI1SK: `DICTSTATUS#Transcribing#${now}`
  });
  if (updates) {
    await updateItem({
      Key: {
        PK: `PROVIDER#${providerId}`,
        SK: `DICT#${dictationId}`
      },
      ...updates
    });
  }
  await writeAuditLog({
    providerId,
    action: "START_TRANSCRIPTION",
    entityType: "Dictation",
    entityId: dictationId,
    details: { jobName, mediaFormat }
  });
  return {
    jobName,
    dictationId,
    providerId,
    date,
    outputKey,
    status: "IN_PROGRESS"
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
