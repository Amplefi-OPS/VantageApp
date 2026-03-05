#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { TranscriptionPipelineStack } from '../lib/pipeline-stack';
import { BillingStack } from '../lib/billing-stack';
import { VoicemailPipelineStack } from '../lib/voicemail-pipeline-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext('region') || 'us-east-1',
};

const stageName = app.node.tryGetContext('environment') || 'dev';

// ── Storage: S3 buckets, KMS keys, DynamoDB tables ──
const storage = new StorageStack(app, `Vantage-Storage-${stageName}`, {
  env,
  stageName,
  retentionAudioDays: app.node.tryGetContext('retentionAudioDays') || 90,
  retentionTranscriptDays: app.node.tryGetContext('retentionTranscriptDays') || 2555,
});

// ── Auth: Cognito User Pool ──
const auth = new AuthStack(app, `Vantage-Auth-${stageName}`, {
  env,
  stageName,
});

// ── API: API Gateway + Lambda handlers ──
const api = new ApiStack(app, `Vantage-Api-${stageName}`, {
  env,
  stageName,
  table: storage.table,
  audioBucket: storage.audioBucket,
  transcriptBucket: storage.transcriptBucket,
  kmsKey: storage.kmsKey,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

// ── Transcription Pipeline: Step Functions + EventBridge ──
const pipeline = new TranscriptionPipelineStack(app, `Vantage-Pipeline-${stageName}`, {
  env,
  stageName,
  table: storage.table,
  audioBucket: storage.audioBucket,
  transcriptBucket: storage.transcriptBucket,
  kmsKey: storage.kmsKey,
});

// ── Voicemail Pipeline: Step Functions + EventBridge ──
const vmPipeline = new VoicemailPipelineStack(app, `Vantage-VmPipeline-${stageName}`, {
  env,
  stageName,
  table: storage.table,
  audioBucket: storage.audioBucket,
  transcriptBucket: storage.transcriptBucket,
  kmsKey: storage.kmsKey,
});

// ── Billing: EventBridge + Lambda + DLQ ──
const billing = new BillingStack(app, `Vantage-Billing-${stageName}`, {
  env,
  stageName,
  table: storage.table,
});

app.synth();
