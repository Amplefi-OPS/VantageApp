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

// lambda/transcription/complete-transcription.ts
var complete_transcription_exports = {};
__export(complete_transcription_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(complete_transcription_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_crypto = require("crypto");

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
async function getItem(pk, sk) {
  const params = {
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk }
  };
  const result = await ddb.send(new import_lib_dynamodb.GetCommand(params));
  return result.Item;
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

// lambda/transcription/complete-transcription.ts
var s3 = new import_client_s3.S3Client({});
var TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET;
var handler = async (input) => {
  const { dictationId, providerId, outputKey, status, error } = input;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const dictation = await getItem(`PROVIDER#${providerId}`, `DICT#${dictationId}`);
  if (status === "FAILED") {
    console.error(`Transcription failed for ${dictationId}: ${error}`);
    const failUpdates = buildUpdateExpression({
      status: "TranscriptionFailed",
      failureReason: error,
      updatedAt: now,
      GSI1SK: `DICTSTATUS#TranscriptionFailed#${now}`
    });
    if (failUpdates) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `DICT#${dictationId}` },
        ...failUpdates
      });
    }
    if (dictation?.taskId) {
      const taskUpdates = buildUpdateExpression({
        status: "TranscriptionFailed",
        notes: `Transcription failed: ${error}`,
        updatedAt: now,
        GSI1SK: `TASKSTATUS#TranscriptionFailed#${now}`
      });
      if (taskUpdates) {
        await updateItem({
          Key: { PK: `PROVIDER#${providerId}`, SK: `TASK#${dictation.taskId}` },
          ...taskUpdates
        });
      }
    }
    await writeAuditLog({
      providerId,
      action: "TRANSCRIPTION_FAILED",
      entityType: "Dictation",
      entityId: dictationId,
      details: { error }
    });
    return { dictationId, status: "TranscriptionFailed", error };
  }
  console.log(`Reading transcript from s3://${TRANSCRIPT_BUCKET}/${outputKey}`);
  let transcriptText = "";
  let confidence = 0;
  try {
    const obj = await s3.send(new import_client_s3.GetObjectCommand({
      Bucket: TRANSCRIPT_BUCKET,
      Key: outputKey
    }));
    const raw = await obj.Body?.transformToString("utf-8");
    if (raw) {
      const transcriptData = JSON.parse(raw);
      const results = transcriptData.results;
      if (results?.transcripts?.length > 0) {
        transcriptText = results.transcripts[0].transcript;
      }
      if (results?.items?.length > 0) {
        const confidences = results.items.filter(
          (item) => item.alternatives?.[0]?.confidence
        ).map(
          (item) => parseFloat(item.alternatives[0].confidence)
        );
        if (confidences.length > 0) {
          confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
          confidence = Math.round(confidence * 100) / 100;
        }
      }
    }
  } catch (err) {
    console.error("Failed to read transcript:", err);
    transcriptText = "[Error reading transcript]";
  }
  const dictUpdates = buildUpdateExpression({
    status: "DraftReady",
    transcriptText: transcriptText.slice(0, 4e3),
    // Store preview in DynamoDB (full in S3)
    confidence,
    updatedAt: now,
    GSI1SK: `DICTSTATUS#DraftReady#${now}`
  });
  if (dictUpdates) {
    await updateItem({
      Key: { PK: `PROVIDER#${providerId}`, SK: `DICT#${dictationId}` },
      ...dictUpdates
    });
  }
  const taskId = dictation?.taskId;
  if (taskId) {
    const taskUpdates = buildUpdateExpression({
      status: "DraftReady",
      notes: `Transcript ready (confidence: ${(confidence * 100).toFixed(1)}%)`,
      updatedAt: now,
      GSI1SK: `TASKSTATUS#DraftReady#${now}`
    });
    if (taskUpdates) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `TASK#${taskId}` },
        ...taskUpdates
      });
    }
  } else {
    const newTaskId = `task-${(0, import_crypto.randomUUID)().slice(0, 12)}`;
    await putItem({
      PK: `PROVIDER#${providerId}`,
      SK: `TASK#${newTaskId}`,
      taskId: newTaskId,
      providerId,
      patientId: dictation?.patientId || null,
      type: "Dictation",
      title: `Review dictation: ${dictation?.noteType || "note"}`,
      status: "DraftReady",
      priority: "Med",
      dueDate: null,
      assignedTo: null,
      notes: `Transcript ready (confidence: ${(confidence * 100).toFixed(1)}%)`,
      dictationId,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `PROVIDER#${providerId}`,
      GSI1SK: `TASKSTATUS#DraftReady#${now}`,
      GSI2PK: "TASK",
      GSI2SK: `${now}#${newTaskId}`,
      entityType: "Task"
    });
    const linkUpdate = buildUpdateExpression({ taskId: newTaskId });
    if (linkUpdate) {
      await updateItem({
        Key: { PK: `PROVIDER#${providerId}`, SK: `DICT#${dictationId}` },
        ...linkUpdate
      });
    }
  }
  await writeAuditLog({
    providerId,
    action: "TRANSCRIPTION_COMPLETED",
    entityType: "Dictation",
    entityId: dictationId,
    details: {
      confidence,
      transcriptLength: transcriptText.length,
      taskId: taskId || "auto-created"
    }
  });
  return {
    dictationId,
    status: "DraftReady",
    confidence,
    transcriptLength: transcriptText.length
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
