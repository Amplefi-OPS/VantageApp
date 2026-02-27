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

// lambda/transcription/check-transcription.ts
var check_transcription_exports = {};
__export(check_transcription_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(check_transcription_exports);
var import_client_transcribe = require("@aws-sdk/client-transcribe");
var transcribe = new import_client_transcribe.TranscribeClient({});
var handler = async (input) => {
  const { jobName } = input;
  console.log(`Checking transcription job status: ${jobName}`);
  const response = await transcribe.send(
    new import_client_transcribe.GetMedicalTranscriptionJobCommand({
      MedicalTranscriptionJobName: jobName
    })
  );
  const job = response.MedicalTranscriptionJob;
  const jobStatus = job?.TranscriptionJobStatus || "IN_PROGRESS";
  console.log(`Job ${jobName} status: ${jobStatus}`);
  if (jobStatus === "FAILED") {
    return {
      ...input,
      status: "FAILED",
      error: job?.FailureReason || "Unknown transcription failure"
    };
  }
  if (jobStatus === "COMPLETED") {
    return {
      ...input,
      status: "COMPLETED",
      transcriptUri: job?.Transcript?.TranscriptFileUri
    };
  }
  return {
    ...input,
    status: "IN_PROGRESS"
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
