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

// lambda/transcription/s3-trigger.ts
var s3_trigger_exports = {};
__export(s3_trigger_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(s3_trigger_exports);
var import_client_sfn = require("@aws-sdk/client-sfn");
var sfn = new import_client_sfn.SFNClient({});
var STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;
var handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const size = record.s3.object.size;
    console.log(`New audio uploaded: s3://${bucket}/${key} (${size} bytes)`);
    const parts = key.split("/");
    if (parts.length < 4 || parts[0] !== "dictations") {
      console.log("Skipping non-dictation object:", key);
      continue;
    }
    const providerId = parts[1];
    const date = parts[2];
    const filename = parts[3];
    const dictationId = filename.split(".")[0];
    const input = {
      bucket,
      key,
      providerId,
      date,
      dictationId,
      size,
      eventTime: record.eventTime
    };
    const executionName = `${dictationId}-${Date.now()}`;
    await sfn.send(new import_client_sfn.StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify(input)
    }));
    console.log(`Started transcription pipeline: ${executionName}`);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
