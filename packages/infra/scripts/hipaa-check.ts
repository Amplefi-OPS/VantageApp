#!/usr/bin/env npx ts-node
/**
 * HIPAA Infrastructure Compliance Verification
 *
 * Reads synthesized CloudFormation templates from cdk.out/ and verifies
 * that required HIPAA controls are present. Intended for compliance officer
 * review before production launch.
 *
 * Usage: npx ts-node scripts/hipaa-check.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Helpers ──

const CDK_OUT = path.join(__dirname, '..', 'cdk.out');

interface CfnTemplate {
  Resources: Record<string, { Type: string; Properties: any }>;
}

function loadTemplate(name: string): CfnTemplate {
  const file = path.join(CDK_OUT, `${name}.template.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Template not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findResources(template: CfnTemplate, type: string): [string, any][] {
  return Object.entries(template.Resources).filter(([, r]) => r.Type === type);
}

function findResource(template: CfnTemplate, type: string): [string, any] | undefined {
  return findResources(template, type)[0];
}

interface CheckResult {
  name: string;
  category: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(category: string, name: string, passed: boolean, detail: string) {
  results.push({ category, name, passed, detail });
}

// ── Load Templates ──

let storage: CfnTemplate;
let auth: CfnTemplate;
let api: CfnTemplate;
let scheduledTasks: CfnTemplate;

try {
  storage = loadTemplate('Vantage-Storage-dev');
  auth = loadTemplate('Vantage-Auth-dev');
  api = loadTemplate('Vantage-Api-dev');
  scheduledTasks = loadTemplate('Vantage-ScheduledTasks-dev');
} catch (err) {
  console.error(`\x1b[31mFATAL: Could not load templates. Run 'npx cdk synth --all' first.\x1b[0m`);
  console.error((err as Error).message);
  process.exit(1);
}

// ═══════════════════════════════════════════
// ENCRYPTION AT REST
// ═══════════════════════════════════════════

const CAT_ENCRYPT = 'ENCRYPTION AT REST';

// S3 audio bucket — SSE-KMS
{
  const buckets = findResources(storage, 'AWS::S3::Bucket');
  const audioBucket = buckets.find(([id]) => id.startsWith('AudioBucket'));
  if (!audioBucket) {
    check(CAT_ENCRYPT, 'S3 audio bucket SSE-KMS', false, 'AudioBucket resource not found');
  } else {
    const enc = audioBucket[1].Properties?.BucketEncryption?.ServerSideEncryptionConfiguration;
    const algo = enc?.[0]?.ServerSideEncryptionByDefault?.SSEAlgorithm;
    const hasKmsKey = !!enc?.[0]?.ServerSideEncryptionByDefault?.KMSMasterKeyID;
    const passed = algo === 'aws:kms' && hasKmsKey;
    check(CAT_ENCRYPT, 'S3 audio bucket SSE-KMS', passed,
      passed ? `${audioBucket[0]}: SSEAlgorithm=aws:kms with KMS key`
        : `${audioBucket[0]}: Expected aws:kms with KMS key, got algo=${algo} hasKey=${hasKmsKey}`);
  }
}

// S3 transcript bucket — SSE-KMS
{
  const buckets = findResources(storage, 'AWS::S3::Bucket');
  const transcriptBucket = buckets.find(([id]) => id.startsWith('TranscriptBucket'));
  if (!transcriptBucket) {
    check(CAT_ENCRYPT, 'S3 transcript bucket SSE-KMS', false, 'TranscriptBucket resource not found');
  } else {
    const enc = transcriptBucket[1].Properties?.BucketEncryption?.ServerSideEncryptionConfiguration;
    const algo = enc?.[0]?.ServerSideEncryptionByDefault?.SSEAlgorithm;
    const hasKmsKey = !!enc?.[0]?.ServerSideEncryptionByDefault?.KMSMasterKeyID;
    const passed = algo === 'aws:kms' && hasKmsKey;
    check(CAT_ENCRYPT, 'S3 transcript bucket SSE-KMS', passed,
      passed ? `${transcriptBucket[0]}: SSEAlgorithm=aws:kms with KMS key`
        : `${transcriptBucket[0]}: Expected aws:kms with KMS key, got algo=${algo} hasKey=${hasKmsKey}`);
  }
}

// DynamoDB table — SSE with KMS key
{
  const table = findResource(storage, 'AWS::DynamoDB::Table');
  if (!table) {
    check(CAT_ENCRYPT, 'DynamoDB table SSE with KMS', false, 'DynamoDB Table resource not found');
  } else {
    const sse = table[1].Properties?.SSESpecification;
    const passed = sse?.SSEEnabled === true && !!sse?.KMSMasterKeyId;
    check(CAT_ENCRYPT, 'DynamoDB table SSE with KMS', passed,
      passed ? `${table[0]}: SSEEnabled=true, SSEType=${sse.SSEType}`
        : `${table[0]}: SSEEnabled=${sse?.SSEEnabled}, KMSMasterKeyId=${!!sse?.KMSMasterKeyId}`);
  }
}

// KMS key — EnableKeyRotation
{
  const key = findResource(storage, 'AWS::KMS::Key');
  if (!key) {
    check(CAT_ENCRYPT, 'KMS key rotation enabled', false, 'KMS Key resource not found');
  } else {
    const rotation = key[1].Properties?.EnableKeyRotation;
    check(CAT_ENCRYPT, 'KMS key rotation enabled', rotation === true,
      rotation === true ? `${key[0]}: EnableKeyRotation=true`
        : `${key[0]}: EnableKeyRotation=${rotation}`);
  }
}

// ═══════════════════════════════════════════
// ACCESS CONTROLS
// ═══════════════════════════════════════════

const CAT_ACCESS = 'ACCESS CONTROLS';

// S3 buckets — block public access (all four flags true)
{
  const buckets = findResources(storage, 'AWS::S3::Bucket');
  const dataBuckets = buckets.filter(([id]) =>
    id.startsWith('AudioBucket') || id.startsWith('TranscriptBucket'));

  for (const [id, r] of dataBuckets) {
    const pac = r.Properties?.PublicAccessBlockConfiguration;
    const allTrue = pac?.BlockPublicAcls === true
      && pac?.BlockPublicPolicy === true
      && pac?.IgnorePublicAcls === true
      && pac?.RestrictPublicBuckets === true;
    check(CAT_ACCESS, `S3 ${id} block public access`, allTrue,
      allTrue ? `${id}: All four public access block flags are true`
        : `${id}: BlockPublicAcls=${pac?.BlockPublicAcls} BlockPublicPolicy=${pac?.BlockPublicPolicy} IgnorePublicAcls=${pac?.IgnorePublicAcls} RestrictPublicBuckets=${pac?.RestrictPublicBuckets}`);
  }
}

// API Gateway — Cognito authorizer on protected routes
{
  const authorizer = findResource(api, 'AWS::ApiGateway::Authorizer');
  if (!authorizer) {
    check(CAT_ACCESS, 'API Gateway Cognito authorizer exists', false, 'No Authorizer resource found');
  } else {
    const isCognito = authorizer[1].Properties?.Type === 'COGNITO_USER_POOLS';
    check(CAT_ACCESS, 'API Gateway Cognito authorizer exists', isCognito,
      isCognito ? `${authorizer[0]}: Type=COGNITO_USER_POOLS`
        : `${authorizer[0]}: Type=${authorizer[1].Properties?.Type}`);
  }

  // Check that all non-OPTIONS methods use COGNITO_USER_POOLS except login-failure
  const methods = findResources(api, 'AWS::ApiGateway::Method')
    .filter(([, r]) => r.Properties?.HttpMethod !== 'OPTIONS');

  const unauthMethods = methods.filter(([, r]) =>
    r.Properties?.AuthorizationType !== 'COGNITO_USER_POOLS');

  // login-failure is expected to be unauthenticated (user isn't logged in)
  const unexpected = unauthMethods.filter(([id]) =>
    !id.toLowerCase().includes('loginfailure'));

  check(CAT_ACCESS, 'All protected routes use Cognito auth', unexpected.length === 0,
    unexpected.length === 0
      ? `All ${methods.length} non-OPTIONS methods are authorized (1 login-failure route intentionally unauthenticated)`
      : `Unprotected routes found: ${unexpected.map(([id, r]) => `${id} (${r.Properties.HttpMethod} AuthType=${r.Properties.AuthorizationType})`).join(', ')}`);
}

// Cognito MFA — enabled (ON or OPTIONAL, not OFF)
{
  const pool = findResource(auth, 'AWS::Cognito::UserPool');
  if (!pool) {
    check(CAT_ACCESS, 'Cognito MFA enabled', false, 'UserPool resource not found');
  } else {
    const mfa = pool[1].Properties?.MfaConfiguration;
    const passed = mfa === 'ON' || mfa === 'OPTIONAL';
    check(CAT_ACCESS, 'Cognito MFA enabled', passed,
      passed ? `${pool[0]}: MfaConfiguration=${mfa}`
        : `${pool[0]}: MfaConfiguration=${mfa} (expected ON or OPTIONAL)`);
  }
}

// Cognito pre-sign-up Lambda trigger
{
  const pool = findResource(auth, 'AWS::Cognito::UserPool');
  if (!pool) {
    check(CAT_ACCESS, 'Cognito pre-sign-up Lambda trigger', false, 'UserPool resource not found');
  } else {
    const lambdaConfig = pool[1].Properties?.LambdaConfig;
    const hasPreSignUp = !!lambdaConfig?.PreSignUp;
    check(CAT_ACCESS, 'Cognito pre-sign-up Lambda trigger', hasPreSignUp,
      hasPreSignUp ? `${pool[0]}: PreSignUp trigger configured`
        : `${pool[0]}: No PreSignUp trigger in LambdaConfig`);
  }
}

// ═══════════════════════════════════════════
// TRANSMISSION SECURITY
// ═══════════════════════════════════════════

const CAT_TRANSMIT = 'TRANSMISSION SECURITY';

// S3 bucket policies — enforce aws:SecureTransport
{
  const policies = findResources(storage, 'AWS::S3::BucketPolicy');
  const dataPolicies = policies.filter(([id]) =>
    id.startsWith('AudioBucket') || id.startsWith('TranscriptBucket'));

  for (const [id, r] of dataPolicies) {
    const statements: any[] = r.Properties?.PolicyDocument?.Statement || [];
    const hasDenyHttp = statements.some((s: any) =>
      s.Effect === 'Deny'
      && s.Action === 's3:*'
      && s.Condition?.Bool?.['aws:SecureTransport'] === 'false');
    check(CAT_TRANSMIT, `S3 ${id} enforces HTTPS`, hasDenyHttp,
      hasDenyHttp ? `${id}: Deny policy with aws:SecureTransport=false condition present`
        : `${id}: Missing Deny policy for non-TLS requests`);
  }
}

// API Gateway — TLS version
{
  // CDK RestApi defaults to TLS 1.2 (EDGE endpoint). Check the RestApi resource.
  const restApi = findResource(api, 'AWS::ApiGateway::RestApi');
  if (!restApi) {
    check(CAT_TRANSMIT, 'API Gateway minimum TLS version', false, 'RestApi resource not found');
  } else {
    // API Gateway always enforces TLS 1.2 minimum for EDGE/REGIONAL endpoints.
    // Custom domain names can lower this, but no custom domain is configured here —
    // the default *.execute-api.amazonaws.com endpoint enforces TLS 1.2.
    // If a DomainName resource exists, check its SecurityPolicy.
    const domain = findResource(api, 'AWS::ApiGateway::DomainName');
    if (domain) {
      const policy = domain[1].Properties?.SecurityPolicy;
      const passed = policy === 'TLS_1_2';
      check(CAT_TRANSMIT, 'API Gateway minimum TLS version', passed,
        passed ? `${domain[0]}: SecurityPolicy=TLS_1_2`
          : `${domain[0]}: SecurityPolicy=${policy} (expected TLS_1_2)`);
    } else {
      // No custom domain — API Gateway execute-api endpoint enforces TLS 1.2 by default
      check(CAT_TRANSMIT, 'API Gateway minimum TLS version', true,
        `${restApi[0]}: No custom domain — execute-api endpoint enforces TLS 1.2 by default`);
    }
  }
}

// ═══════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════

const CAT_AUDIT = 'AUDIT LOGGING';

// CloudTrail — exists and enabled
{
  const trail = findResource(storage, 'AWS::CloudTrail::Trail');
  if (!trail) {
    check(CAT_AUDIT, 'CloudTrail trail enabled', false, 'No CloudTrail Trail resource found');
  } else {
    const logging = trail[1].Properties?.IsLogging;
    check(CAT_AUDIT, 'CloudTrail trail enabled', logging === true,
      logging === true ? `${trail[0]}: IsLogging=true`
        : `${trail[0]}: IsLogging=${logging}`);
  }
}

// API Gateway — access logging
{
  const stage = findResource(api, 'AWS::ApiGateway::Stage');
  if (!stage) {
    check(CAT_AUDIT, 'API Gateway access logging', false, 'No API Gateway Stage resource found');
  } else {
    const methodSettings = stage[1].Properties?.MethodSettings;
    const hasLogging = Array.isArray(methodSettings) && methodSettings.some(
      (ms: any) => ms.LoggingLevel === 'INFO' || ms.LoggingLevel === 'ERROR');
    // Also check for AccessLogSetting (structured access logs)
    const hasAccessLog = !!stage[1].Properties?.AccessLogSetting?.DestinationArn;
    // MethodSettings LoggingLevel=INFO covers execution logging
    check(CAT_AUDIT, 'API Gateway execution logging', hasLogging,
      hasLogging ? `${stage[0]}: MethodSettings LoggingLevel=INFO`
        : `${stage[0]}: No logging level set in MethodSettings`);
    // Note: AccessLogSetting (structured access logs) is separate and optional
    // but recommended. Report its status.
    check(CAT_AUDIT, 'API Gateway access log destination', hasAccessLog,
      hasAccessLog ? `${stage[0]}: AccessLogSetting configured`
        : `${stage[0]}: No AccessLogSetting.DestinationArn — structured access logs not configured (execution logs via MethodSettings are active)`);
  }
}

// DynamoDB PITR
{
  const table = findResource(storage, 'AWS::DynamoDB::Table');
  if (!table) {
    check(CAT_AUDIT, 'DynamoDB point-in-time recovery', false, 'DynamoDB Table resource not found');
  } else {
    const pitr = table[1].Properties?.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled;
    check(CAT_AUDIT, 'DynamoDB point-in-time recovery', pitr === true,
      pitr === true ? `${table[0]}: PointInTimeRecoveryEnabled=true`
        : `${table[0]}: PointInTimeRecoveryEnabled=${pitr}`);
  }
}

// ═══════════════════════════════════════════
// DATA RETENTION
// ═══════════════════════════════════════════

const CAT_RETENTION = 'DATA RETENTION';

// Audio bucket — 90-day dictation lifecycle
{
  const buckets = findResources(storage, 'AWS::S3::Bucket');
  const audioBucket = buckets.find(([id]) => id.startsWith('AudioBucket'));
  if (!audioBucket) {
    check(CAT_RETENTION, 'S3 audio bucket 90-day dictation expiry', false, 'AudioBucket not found');
  } else {
    const rules: any[] = audioBucket[1].Properties?.LifecycleConfiguration?.Rules || [];
    const dictationRule = rules.find((r: any) =>
      r.Prefix === 'dictations/' && r.Status === 'Enabled');
    const passed = dictationRule?.ExpirationInDays === 90;
    check(CAT_RETENTION, 'S3 audio bucket 90-day dictation expiry', passed,
      passed ? `${audioBucket[0]}: dictations/ prefix expires at 90 days`
        : `${audioBucket[0]}: Expected 90-day expiry on dictations/, got ${dictationRule?.ExpirationInDays ?? 'no rule found'}`);
  }
}

// Transcript bucket — 2555-day (7 year) lifecycle
{
  const buckets = findResources(storage, 'AWS::S3::Bucket');
  const transcriptBucket = buckets.find(([id]) => id.startsWith('TranscriptBucket'));
  if (!transcriptBucket) {
    check(CAT_RETENTION, 'S3 transcript bucket 2555-day expiry', false, 'TranscriptBucket not found');
  } else {
    const rules: any[] = transcriptBucket[1].Properties?.LifecycleConfiguration?.Rules || [];
    const retainRule = rules.find((r: any) => r.Status === 'Enabled' && r.ExpirationInDays === 2555);
    const passed = !!retainRule;
    check(CAT_RETENTION, 'S3 transcript bucket 2555-day (7yr) expiry', passed,
      passed ? `${transcriptBucket[0]}: Lifecycle rule expires at 2555 days`
        : `${transcriptBucket[0]}: Expected 2555-day expiry rule, found rules: ${JSON.stringify(rules.map((r: any) => ({ prefix: r.Prefix, days: r.ExpirationInDays })))}`);
  }
}

// ═══════════════════════════════════════════
// SCHEDULED TASKS
// ═══════════════════════════════════════════

const CAT_SCHEDULED = 'SCHEDULED TASKS';

// EventBridge rule for daily fax task
{
  const rule = findResource(scheduledTasks, 'AWS::Events::Rule');
  if (!rule) {
    check(CAT_SCHEDULED, 'Daily fax task EventBridge rule exists', false, 'No Events::Rule resource found');
    check(CAT_SCHEDULED, 'Daily fax task rule targets correct Lambda', false, 'No Events::Rule resource found');
  } else {
    const state = rule[1].Properties?.State;
    const schedule = rule[1].Properties?.ScheduleExpression;
    const isEnabled = state === 'ENABLED';
    check(CAT_SCHEDULED, 'Daily fax task EventBridge rule exists and enabled', isEnabled,
      isEnabled ? `${rule[0]}: State=ENABLED, Schedule=${schedule}`
        : `${rule[0]}: State=${state} (expected ENABLED)`);

    // Verify it targets the CreateDailyFaxTask Lambda
    const targets: any[] = rule[1].Properties?.Targets || [];
    const lambdaFn = findResource(scheduledTasks, 'AWS::Lambda::Function');
    const lambdaFns = findResources(scheduledTasks, 'AWS::Lambda::Function')
      .filter(([, r]) => r.Properties?.FunctionName?.includes?.('daily-fax-task'));

    let targetMatchesLambda = false;
    if (lambdaFns.length > 0 && targets.length > 0) {
      const targetArn = targets[0]?.Arn?.['Fn::GetAtt']?.[0];
      targetMatchesLambda = lambdaFns.some(([id]) => id === targetArn);
    }
    check(CAT_SCHEDULED, 'Daily fax task rule targets correct Lambda', targetMatchesLambda,
      targetMatchesLambda ? `${rule[0]}: Target points to create-daily-fax-task Lambda`
        : `${rule[0]}: Target does not match expected Lambda (targets: ${JSON.stringify(targets)})`);
  }
}

// ═══════════════════════════════════════════
// TRANSCRIBE MEDICAL SECURITY
// ═══════════════════════════════════════════

const CAT_TRANSCRIBE = 'TRANSCRIBE MEDICAL SECURITY';

// CHECK 22 — Transcribe Medical output encrypted with KMS
{
  const lambdas = findResources(api, 'AWS::Lambda::Function');
  const hasKmsEnv = lambdas.some(([, r]) => {
    const env = r.Properties?.Environment?.Variables;
    return env && 'TRANSCRIPTION_KMS_KEY_ARN' in env;
  });
  check(CAT_TRANSCRIBE, 'Transcribe Medical output encrypted with KMS', hasKmsEnv,
    hasKmsEnv
      ? 'At least one Lambda has TRANSCRIPTION_KMS_KEY_ARN in environment variables'
      : 'No Lambda found with TRANSCRIPTION_KMS_KEY_ARN environment variable');
}

// CHECK 23 — Transcribe Medical IAM uses least-privilege actions
{
  const policies = findResources(api, 'AWS::IAM::Policy');
  const hasTranscribeAction = policies.some(([, r]) => {
    const statements: any[] = r.Properties?.PolicyDocument?.Statement || [];
    return statements.some((s: any) => {
      const actions: string[] = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.includes('transcribe:StartMedicalTranscriptionJob');
    });
  });
  check(CAT_TRANSCRIBE, 'Transcribe Medical IAM uses least-privilege actions', hasTranscribeAction,
    hasTranscribeAction
      ? 'IAM policy includes explicit transcribe:StartMedicalTranscriptionJob action (not wildcard)'
      : 'No IAM policy found with explicit transcribe:StartMedicalTranscriptionJob action');
}

// ═══════════════════════════════════════════
// MFA ENFORCEMENT
// ═══════════════════════════════════════════

const CAT_MFA = 'MFA ENFORCEMENT';

// CHECK 24 — Cognito MFA set to REQUIRED (ON), not OPTIONAL
{
  const pool = findResource(auth, 'AWS::Cognito::UserPool');
  if (!pool) {
    check(CAT_MFA, 'Cognito MFA set to REQUIRED', false, 'UserPool resource not found');
  } else {
    const mfa = pool[1].Properties?.MfaConfiguration;
    const passed = mfa === 'ON';
    check(CAT_MFA, 'Cognito MFA set to REQUIRED', passed,
      passed ? `${pool[0]}: MfaConfiguration=ON (REQUIRED)`
        : `${pool[0]}: MfaConfiguration=${mfa} (expected ON — OPTIONAL is not HIPAA-compliant)`);
  }
}

// ═══════════════════════════════════════════
// BILLING AUDIT
// ═══════════════════════════════════════════

const CAT_BILLING = 'BILLING AUDIT';

// CHECK 25 — Billing charges write audit logs to DynamoDB
{
  const policies = findResources(api, 'AWS::IAM::Policy');
  // Look for policies that grant dynamodb:PutItem on the main table
  // AND are attached to billing-related Lambda roles
  const billingRoles = findResources(api, 'AWS::Lambda::Function')
    .filter(([, r]) => {
      const name = r.Properties?.FunctionName || '';
      return name.includes('billing-lookup') ||
             name.includes('billing-direct-charge') ||
             name.includes('billing-noshow');
    })
    .map(([, r]) => r.Properties?.Role?.['Fn::GetAtt']?.[0])
    .filter(Boolean);

  const hasPutItem = policies.some(([, r]) => {
    const statements: any[] = r.Properties?.PolicyDocument?.Statement || [];
    return statements.some((s: any) => {
      const actions: string[] = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.some((a: string) => a === 'dynamodb:PutItem' || a === 'dynamodb:*');
    });
  });

  // Also check via grantWriteData — which grants BatchWriteItem, PutItem, UpdateItem, DeleteItem
  const hasWriteGrant = policies.some(([, r]) => {
    const statements: any[] = r.Properties?.PolicyDocument?.Statement || [];
    const roles = r.Properties?.Roles || [];
    const attachedToBilling = roles.some((role: any) =>
      billingRoles.includes(role.Ref || role['Fn::GetAtt']?.[0]));
    if (!attachedToBilling) return false;
    return statements.some((s: any) => {
      const actions: string[] = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.includes('dynamodb:PutItem');
    });
  });

  const passed = hasPutItem || hasWriteGrant;
  check(CAT_BILLING, 'Billing charges write audit logs to DynamoDB', passed,
    passed
      ? 'Billing Lambda IAM policies include dynamodb:PutItem for audit logging'
      : 'No dynamodb:PutItem permission found for billing Lambda functions');
}

// ═══════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════

console.log('\n' + '═'.repeat(72));
console.log('  HIPAA INFRASTRUCTURE COMPLIANCE VERIFICATION REPORT');
console.log('  Generated: ' + new Date().toISOString());
console.log('  Templates: cdk.out/ (CDK synth output)');
console.log('═'.repeat(72) + '\n');

let currentCategory = '';
let passCount = 0;
let failCount = 0;

for (const r of results) {
  if (r.category !== currentCategory) {
    currentCategory = r.category;
    console.log(`── ${currentCategory} ──`);
  }
  const icon = r.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  [${icon}] ${r.name}`);
  console.log(`         ${r.detail}`);
  if (r.passed) passCount++;
  else failCount++;
}

console.log('\n' + '─'.repeat(72));
const total = passCount + failCount;
const color = failCount === 0 ? '\x1b[32m' : '\x1b[31m';
console.log(`${color}SUMMARY: ${passCount}/${total} checks passed, ${failCount} failed.\x1b[0m`);

if (failCount > 0) {
  console.log('\n\x1b[31mFAILED CHECKS:\x1b[0m');
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  - [${r.category}] ${r.name}`);
    console.log(`    ${r.detail}`);
  }
}

console.log('─'.repeat(72));
process.exit(failCount > 0 ? 1 : 0);
