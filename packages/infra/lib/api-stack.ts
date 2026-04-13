/*
 * API Stack — Vantage REST API (API Gateway + Lambda)
 *
 * DATABASE ARCHITECTURE (current state):
 *   v1 routes (this file) use DynamoDB single-table design.
 *     Handlers live in packages/api/handlers/api/.
 *   v2 routes (PostgreSQL via Aurora Data API) are NOT yet migrated into
 *     this stack. When v2 is ready, add a DatabaseStack dependency and
 *     wire new handlers from packages/api/handlers/domains/.
 *
 *   This is a known architectural decision that needs to be resolved
 *   before scaling beyond a single provider.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  stageName: string;
  table: dynamodb.Table;
  audioBucket: s3.Bucket;
  transcriptBucket: s3.Bucket;
  kmsKey: kms.Key;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', '..', 'api', 'handlers');

    // ── Secrets Manager ──
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'AppCredentials', `vantage/credentials/${props.stageName}`,
    );

    // ── Shared environment variables for all Lambdas ──
    const commonEnv: Record<string, string> = {
      TABLE_NAME: props.table.tableName,
      AUDIO_BUCKET: props.audioBucket.bucketName,
      TRANSCRIPT_BUCKET: props.transcriptBucket.bucketName,
      KMS_KEY_ARN: props.kmsKey.keyArn,
      STAGE: props.stageName,
      SECRET_NAME: `vantage/credentials/${props.stageName}`,
      PRESIGN_EXPIRY_SECONDS: '900', // 15 min
      MAX_UPLOAD_SIZE_MB: '100',
    };

    // ── Shared Lambda defaults ──
    const lambdaDefaults: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: commonEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
    };

    // ── Lambda: Presign Upload ──
    const presignFn = new lambdaNode.NodejsFunction(this, 'PresignUploadFn', {
      ...lambdaDefaults,
      functionName: `vantage-presign-upload-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'presign-upload.ts'),
      handler: 'handler',
    });
    props.audioBucket.grantPut(presignFn);
    props.kmsKey.grantEncrypt(presignFn);
    props.table.grantReadWriteData(presignFn);

    // ── Lambda: Get Tasks ──
    const getTasksFn = new lambdaNode.NodejsFunction(this, 'GetTasksFn', {
      ...lambdaDefaults,
      functionName: `vantage-get-tasks-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'get-tasks.ts'),
      handler: 'handler',
    });
    props.table.grantReadData(getTasksFn);

    // ── Lambda: Update Task ──
    const updateTaskFn = new lambdaNode.NodejsFunction(this, 'UpdateTaskFn', {
      ...lambdaDefaults,
      functionName: `vantage-update-task-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'update-task.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(updateTaskFn);

    // ── Lambda: Create Task ──
    const createTaskFn = new lambdaNode.NodejsFunction(this, 'CreateTaskFn', {
      ...lambdaDefaults,
      functionName: `vantage-create-task-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'create-task.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(createTaskFn);

    // Google Calendar + Zoom + Stripe credentials are fetched at runtime via Secrets Manager.
    // No secrets in Lambda environment variables.

    // ── Lambda: List Appointments (Google Calendar) ──
    const listAcuityAppointmentsFn = new lambdaNode.NodejsFunction(this, 'ListAcuityAppointmentsFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-acuity-appointments-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-acuity-appointments.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(listAcuityAppointmentsFn);

    // ── Lambda: Cancel Appointment (Google Calendar) ──
    const cancelAcuityAppointmentFn = new lambdaNode.NodejsFunction(this, 'CancelAcuityAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-cancel-acuity-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'cancel-acuity-appointment.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(cancelAcuityAppointmentFn);

    // ── Lambda: No-Show Appointment (DynamoDB-only) ──
    const noshowAcuityAppointmentFn = new lambdaNode.NodejsFunction(this, 'NoshowAcuityAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-noshow-acuity-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'noshow-acuity-appointment.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(noshowAcuityAppointmentFn);

    // ── Lambda: Create Appointment (Google Calendar) ──
    const createAppointmentFn = new lambdaNode.NodejsFunction(this, 'CreateAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-create-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'create-appointment.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(createAppointmentFn);

    // ── Lambda: Update Appointment (Google Calendar) ──
    const updateAppointmentFn = new lambdaNode.NodejsFunction(this, 'UpdateAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-update-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'update-appointment.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(updateAppointmentFn);

    // ── Lambda: Complete Appointment ──
    const completeAppointmentFn = new lambdaNode.NodejsFunction(this, 'CompleteAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-complete-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'complete-appointment.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(completeAppointmentFn);

    // ── Lambda: Get Dictation ──
    const getDictationFn = new lambdaNode.NodejsFunction(this, 'GetDictationFn', {
      ...lambdaDefaults,
      functionName: `vantage-get-dictation-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'get-dictation.ts'),
      handler: 'handler',
    });
    props.table.grantReadData(getDictationFn);
    props.transcriptBucket.grantRead(getDictationFn);
    props.audioBucket.grantRead(getDictationFn);
    props.kmsKey.grantDecrypt(getDictationFn);

    // ── Lambda: Create Patient ──
    const createPatientFn = new lambdaNode.NodejsFunction(this, 'CreatePatientFn', {
      ...lambdaDefaults,
      functionName: `vantage-create-patient-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'create-patient.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(createPatientFn);

    // ── Lambda: List Patients ──
    const listPatientsFn = new lambdaNode.NodejsFunction(this, 'ListPatientsFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-patients-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-patients.ts'),
      handler: 'handler',
    });
    props.table.grantReadData(listPatientsFn);

    // ── Lambda: Get Patient ──
    const getPatientFn = new lambdaNode.NodejsFunction(this, 'GetPatientFn', {
      ...lambdaDefaults,
      functionName: `vantage-get-patient-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'get-patient.ts'),
      handler: 'handler',
    });
    props.table.grantReadData(getPatientFn);

    // ── Lambda: Create Note ──
    const createNoteFn = new lambdaNode.NodejsFunction(this, 'CreateNoteFn', {
      ...lambdaDefaults,
      functionName: `vantage-create-note-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'create-note.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(createNoteFn);

    // ── Lambda: List Notes ──
    const listNotesFn = new lambdaNode.NodejsFunction(this, 'ListNotesFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-notes-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-notes.ts'),
      handler: 'handler',
    });
    props.table.grantReadData(listNotesFn);

    // ── Lambda: Delete Note ──
    const deleteNoteFn = new lambdaNode.NodejsFunction(this, 'DeleteNoteFn', {
      ...lambdaDefaults,
      functionName: `vantage-delete-note-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'delete-note.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(deleteNoteFn);

    // ── Lambda: Dashboard Counts ──
    const dashboardCountsFn = new lambdaNode.NodejsFunction(this, 'DashboardCountsFn', {
      ...lambdaDefaults,
      functionName: `vantage-dashboard-counts-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'dashboard-counts.ts'),
      handler: 'handler',
    });
    props.table.grantReadData(dashboardCountsFn);

    // Zoom credentials fetched at runtime via Secrets Manager.

    // ── Lambda: List Zoom Voicemails ──
    const listZoomVoicemailsFn = new lambdaNode.NodejsFunction(this, 'ListZoomVoicemailsFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-zoom-voicemails-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-zoom-voicemails.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60), // longer timeout for downloading audio to S3
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(listZoomVoicemailsFn);
    props.audioBucket.grantReadWrite(listZoomVoicemailsFn);
    props.kmsKey.grantEncryptDecrypt(listZoomVoicemailsFn);

    // ── Lambda: List Zoom Call Logs ──
    const listZoomCallLogsFn = new lambdaNode.NodejsFunction(this, 'ListZoomCallLogsFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-zoom-call-logs-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-zoom-call-logs.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(listZoomCallLogsFn);

    // ── Lambda: Attach Voicemail ──
    const attachVoicemailFn = new lambdaNode.NodejsFunction(this, 'AttachVoicemailFn', {
      ...lambdaDefaults,
      functionName: `vantage-attach-voicemail-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'attach-voicemail.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(attachVoicemailFn);

    // ── Lambda: Archive Voicemail ──
    const archiveVoicemailFn = new lambdaNode.NodejsFunction(this, 'ArchiveVoicemailFn', {
      ...lambdaDefaults,
      functionName: `vantage-archive-voicemail-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'archive-voicemail.ts'),
      handler: 'handler',
    });
    props.table.grantReadWriteData(archiveVoicemailFn);

    // ── Lambda: List Faxes ──
    const listFaxesFn = new lambdaNode.NodejsFunction(this, 'ListFaxesFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-faxes-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-faxes.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadData(listFaxesFn);

    // ── Lambda: Send Fax ──
    const sendFaxFn = new lambdaNode.NodejsFunction(this, 'SendFaxFn', {
      ...lambdaDefaults,
      functionName: `vantage-send-fax-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'send-fax.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(sendFaxFn);

    // Stripe credentials fetched at runtime via Secrets Manager.

    // ── Lambda: Stripe Customer Search ──
    const stripeCustomerSearchFn = new lambdaNode.NodejsFunction(this, 'StripeCustomerSearchFn', {
      ...lambdaDefaults,
      functionName: `vantage-stripe-customer-search-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'stripe-customer-search.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });

    // ── Lambda: Stripe Payment Intent ──
    const stripePaymentIntentFn = new lambdaNode.NodejsFunction(this, 'StripePaymentIntentFn', {
      ...lambdaDefaults,
      functionName: `vantage-stripe-payment-intent-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'stripe-payment-intent.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });

    // ── Lambda: Stripe Charge No-Show ──
    const stripeChargeNoshowFn = new lambdaNode.NodejsFunction(this, 'StripeChargeNoshowFn', {
      ...lambdaDefaults,
      functionName: `vantage-stripe-charge-noshow-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'stripe-charge-noshow.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });

    // ── Lambda: Stripe Setup Intent ──
    const stripeSetupIntentFn = new lambdaNode.NodejsFunction(this, 'StripeSetupIntentFn', {
      ...lambdaDefaults,
      functionName: `vantage-stripe-setup-intent-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'stripe-setup-intent.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });

    // ── Lambda: Stripe Confirm Setup ──
    const stripeConfirmSetupFn = new lambdaNode.NodejsFunction(this, 'StripeConfirmSetupFn', {
      ...lambdaDefaults,
      functionName: `vantage-stripe-confirm-setup-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'stripe-confirm-setup.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });

    // ── Lambda: Stripe Transactions ──
    const stripeTransactionsFn = new lambdaNode.NodejsFunction(this, 'StripeTransactionsFn', {
      ...lambdaDefaults,
      functionName: `vantage-stripe-transactions-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'stripe-transactions.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });

    // ── Lambda: Billing Charge ──
    const billingChargeFn = new lambdaNode.NodejsFunction(this, 'BillingChargeFn', {
      ...lambdaDefaults,
      functionName: `vantage-billing-charge-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'billing-charge.ts'),
      handler: 'handler',
      environment: {
        ...commonEnv,
        BILLING_EVENT_BUS: `vantage-billing-${props.stageName}`,
      },
    });
    props.table.grantReadWriteData(billingChargeFn);

    // Grant EventBridge put to billing Lambda
    billingChargeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/vantage-billing-${props.stageName}`],
    }));

    // ── Billing API Lambdas (Stripe direct) ──
    const billingEnv: Record<string, string> = {
      ...commonEnv,
      LEADS_TABLE: 'vantage-patient-leads',
      // Must match the secret name used by VR Landing site
      STRIPE_SECRET_NAME: 'vantage/stripe/secret-key',
    };

    const billingLookupFn = new lambdaNode.NodejsFunction(this, 'BillingLookupFn', {
      ...lambdaDefaults,
      functionName: `vantage-billing-lookup-${props.stageName}`,
      entry: path.join(lambdaDir, 'billing', 'billing-lookup.ts'),
      handler: 'handler',
      environment: billingEnv,
    });

    const billingDirectChargeFn = new lambdaNode.NodejsFunction(this, 'BillingDirectChargeFn', {
      ...lambdaDefaults,
      functionName: `vantage-billing-direct-charge-${props.stageName}`,
      entry: path.join(lambdaDir, 'billing', 'billing-charge.ts'),
      handler: 'handler',
      environment: billingEnv,
    });

    const billingNoShowFn = new lambdaNode.NodejsFunction(this, 'BillingNoShowFn', {
      ...lambdaDefaults,
      functionName: `vantage-billing-noshow-${props.stageName}`,
      entry: path.join(lambdaDir, 'billing', 'billing-noshow.ts'),
      handler: 'handler',
      environment: billingEnv,
    });

    const billingPaymentIntentFn = new lambdaNode.NodejsFunction(this, 'BillingPaymentIntentFn', {
      ...lambdaDefaults,
      functionName: `vantage-billing-payment-intent-${props.stageName}`,
      entry: path.join(lambdaDir, 'billing', 'billing-payment-intent.ts'),
      handler: 'handler',
      environment: billingEnv,
    });

    // IAM: Stripe secret, leads table scan/query, main table audit log writes
    const billingApiFns = [billingLookupFn, billingDirectChargeFn, billingNoShowFn, billingPaymentIntentFn];
    for (const fn of billingApiFns) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        // Same secret used by VR Landing: vantage/stripe/secret-key
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:vantage/stripe/secret-key*`],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/vantage-patient-leads`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/vantage-patient-leads/index/*`,
        ],
      }));
      props.table.grantWriteData(fn);
    }

    // ── Lambda: Notify Login Failure (unauthenticated — user isn't logged in) ──
    const notifyLoginFailureFn = new lambdaNode.NodejsFunction(this, 'NotifyLoginFailureFn', {
      ...lambdaDefaults,
      functionName: `vantage-notify-login-failure-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'notify-login-failure.ts'),
      handler: 'handler',
    });

    // ── KMS key policy: allow Transcribe Medical service to use the key ──
    props.kmsKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowTranscribeMedicalKmsAccess',
      actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
      principals: [new iam.ServicePrincipal('transcribe.amazonaws.com')],
      resources: ['*'],
    }));

    // ── Transcription environment variables ──
    const transcriptionEnv: Record<string, string> = {
      ...commonEnv,
      AUDIO_BUCKET_NAME: props.audioBucket.bucketName,
      TRANSCRIPTION_KMS_KEY_ARN: props.kmsKey.keyArn,
    };

    // ── Lambda: Get Upload URL (presigned S3 URL for audio upload) ──
    const getUploadUrlFn = new lambdaNode.NodejsFunction(this, 'GetUploadUrlFn', {
      ...lambdaDefaults,
      functionName: `vantage-get-upload-url-${props.stageName}`,
      entry: path.join(lambdaDir, 'transcription', 'get-upload-url.ts'),
      handler: 'handler',
      environment: transcriptionEnv,
    });

    // ── Lambda: Start Transcription ──
    const apiStartTranscriptionFn = new lambdaNode.NodejsFunction(this, 'ApiStartTranscriptionFn', {
      ...lambdaDefaults,
      functionName: `vantage-api-start-transcription-${props.stageName}`,
      entry: path.join(lambdaDir, 'transcription', 'start-medical-transcription.ts'),
      handler: 'handler',
      environment: transcriptionEnv,
    });

    // ── Lambda: Get Transcription Result ──
    const getTranscriptionResultFn = new lambdaNode.NodejsFunction(this, 'GetTranscriptionResultFn', {
      ...lambdaDefaults,
      functionName: `vantage-get-transcription-result-${props.stageName}`,
      entry: path.join(lambdaDir, 'transcription', 'get-transcription-result.ts'),
      handler: 'handler',
      environment: transcriptionEnv,
    });

    // ── IAM: Transcribe Medical + scoped S3 for all three transcription Lambdas ──
    const transcriptionFns = [getUploadUrlFn, apiStartTranscriptionFn, getTranscriptionResultFn];
    for (const fn of transcriptionFns) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'transcribe:StartMedicalTranscriptionJob',
          'transcribe:GetMedicalTranscriptionJob',
        ],
        resources: ['*'],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [
          `${props.audioBucket.bucketArn}/audio/*`,
          `${props.audioBucket.bucketArn}/transcriptions/*`,
        ],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [
          `${props.audioBucket.bucketArn}/audio/*`,
          `${props.audioBucket.bucketArn}/transcriptions/*`,
        ],
      }));
      props.kmsKey.grantEncryptDecrypt(fn);
      props.table.grantReadWriteData(fn);
    }

    // ── Lambda: Initiate Password Reset (custom flow — bypasses Cognito ForgotPassword) ──
    // USER_POOL_ID is hardcoded to the active pool (vantage-prod-v1, us-east-1_6HV34dJMd).
    // Pool was created manually with SMS MFA. Update here when pool changes.
    const activeUserPoolId = `us-east-1_6HV34dJMd`;
    const activeUserPoolArn = `arn:aws:cognito-idp:us-east-1:${this.account}:userpool/${activeUserPoolId}`;

    const initiatePasswordResetFn = new lambdaNode.NodejsFunction(this, 'InitiatePasswordResetFn', {
      ...lambdaDefaults,
      functionName: `vantage-initiate-password-reset-${props.stageName}`,
      entry: path.join(lambdaDir, 'auth', 'initiate-password-reset.ts'),
      handler: 'handler',
      environment: {
        ...commonEnv,
        USER_POOL_ID: activeUserPoolId,
        FROM_EMAIL: 'noreply@vantagerefinery.com',
      },
    });
    props.table.grantReadWriteData(initiatePasswordResetFn);
    initiatePasswordResetFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [activeUserPoolArn],
    }));
    initiatePasswordResetFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:us-east-1:${this.account}:identity/vantagerefinery.com`],
    }));

    // ── Lambda: Confirm Password Reset ──
    const confirmPasswordResetFn = new lambdaNode.NodejsFunction(this, 'ConfirmPasswordResetFn', {
      ...lambdaDefaults,
      functionName: `vantage-confirm-password-reset-${props.stageName}`,
      entry: path.join(lambdaDir, 'auth', 'confirm-password-reset.ts'),
      handler: 'handler',
      environment: {
        ...commonEnv,
        USER_POOL_ID: activeUserPoolId,
      },
    });
    props.table.grantReadWriteData(confirmPasswordResetFn);
    confirmPasswordResetFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminSetUserPassword'],
      resources: [activeUserPoolArn],
    }));

    // ── Grant Secrets Manager read to Lambdas that need third-party credentials ──
    // Any Lambda that calls getSecrets() — directly or via shared/zoom, shared/google,
    // or shared/slack — must be listed here. Audit when adding new handlers.
    const secretConsumers = [
      listAcuityAppointmentsFn,   // shared/google
      cancelAcuityAppointmentFn,  // shared/google
      noshowAcuityAppointmentFn,  // shared/google (may need in future)
      createAppointmentFn,        // shared/google
      updateAppointmentFn,        // shared/google
      listZoomVoicemailsFn,       // shared/zoom + getSecrets
      listZoomCallLogsFn,         // shared/zoom
      attachVoicemailFn,          // shared/zoom (downloads audio)
      archiveVoicemailFn,         // shared/zoom (deletes on Zoom)
      listFaxesFn,                // shared/zoom + getSecrets
      sendFaxFn,                  // shared/zoom + getSecrets
      stripeCustomerSearchFn,     // getSecrets (Stripe)
      stripePaymentIntentFn,      // getSecrets (Stripe) + shared/slack
      stripeChargeNoshowFn,       // getSecrets (Stripe) + shared/slack
      stripeSetupIntentFn,        // getSecrets (Stripe) + shared/slack
      stripeConfirmSetupFn,       // getSecrets (Stripe) + shared/slack
      stripeTransactionsFn,       // getSecrets (Stripe)
      billingChargeFn,            // shared/slack
      notifyLoginFailureFn,       // shared/slack
      createPatientFn,            // shared/slack
      billingLookupFn,            // getSecrets (Stripe)
      billingDirectChargeFn,      // getSecrets (Stripe)
      billingNoShowFn,            // getSecrets (Stripe)
    ];
    for (const fn of secretConsumers) {
      appSecret.grantRead(fn);
    }

    // ── API Gateway Access Log ──
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/vantage-api-${props.stageName}-access`,
      retention: logs.RetentionDays.ONE_YEAR,
    });

    // ── API Gateway ──
    this.api = new apigateway.RestApi(this, 'VantageApi', {
      restApiName: `vantage-api-${props.stageName}`,
      description: 'Vantage physician portal API',
      deployOptions: {
        stageName: props.stageName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false, // Do not log request/response bodies (PHI)
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: props.stageName === 'prod'
          ? ['https://providerdev.vantagerefinery.com']
          : [
              'https://main.d310usa2cmh4sh.amplifyapp.com',
              'https://main.dvufomlgdfium.amplifyapp.com',
              'https://providerdev.vantagerefinery.com',
              'http://localhost:5173',
              'http://localhost:4173',
            ],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Idempotency-Key',
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ── Cognito Authorizer ──
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
      cognitoUserPools: [props.userPool],
      authorizerName: `vantage-cognito-${props.stageName}`,
      identitySource: 'method.request.header.Authorization',
    });

    const authMethodOptions: apigateway.MethodOptions = props.stageName === 'dev'
      ? {}  // Dev: no authorizer — demo mode works, real tokens still accepted
      : { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };

    // ── Routes ──

    // POST /uploads/presign
    const uploads = this.api.root.addResource('uploads');
    const presign = uploads.addResource('presign');
    presign.addMethod('POST', new apigateway.LambdaIntegration(presignFn), authMethodOptions);

    // GET /tasks  &  POST /tasks
    const tasks = this.api.root.addResource('tasks');
    tasks.addMethod('GET', new apigateway.LambdaIntegration(getTasksFn), authMethodOptions);
    tasks.addMethod('POST', new apigateway.LambdaIntegration(createTaskFn), authMethodOptions);

    // PATCH /tasks/{task_id}
    const taskById = tasks.addResource('{task_id}');
    taskById.addMethod('PATCH', new apigateway.LambdaIntegration(updateTaskFn), authMethodOptions);

    // GET /appointments (Google Calendar)  &  POST /appointments
    const appointments = this.api.root.addResource('appointments');
    appointments.addMethod('GET', new apigateway.LambdaIntegration(listAcuityAppointmentsFn), authMethodOptions);
    appointments.addMethod('POST', new apigateway.LambdaIntegration(createAppointmentFn), authMethodOptions);

    // PATCH /appointments/{id}  &  PUT /appointments/{id}/cancel
    const appointmentById = appointments.addResource('{id}');
    appointmentById.addMethod('PATCH', new apigateway.LambdaIntegration(updateAppointmentFn), authMethodOptions);
    const cancelAppointment = appointmentById.addResource('cancel');
    cancelAppointment.addMethod('PUT', new apigateway.LambdaIntegration(cancelAcuityAppointmentFn), authMethodOptions);

    // PUT /appointments/{id}/no-show
    const noshowAppointment = appointmentById.addResource('no-show');
    noshowAppointment.addMethod('PUT', new apigateway.LambdaIntegration(noshowAcuityAppointmentFn), authMethodOptions);

    // PUT /appointments/{id}/complete
    const completeAppointment = appointmentById.addResource('complete');
    completeAppointment.addMethod('PUT', new apigateway.LambdaIntegration(completeAppointmentFn), authMethodOptions);

    // GET /dictations/{dictation_id}
    const dictations = this.api.root.addResource('dictations');
    const dictationById = dictations.addResource('{dictation_id}');
    dictationById.addMethod('GET', new apigateway.LambdaIntegration(getDictationFn), authMethodOptions);

    // GET /patients  &  POST /patients
    const patients = this.api.root.addResource('patients');
    patients.addMethod('GET', new apigateway.LambdaIntegration(listPatientsFn), authMethodOptions);
    patients.addMethod('POST', new apigateway.LambdaIntegration(createPatientFn), authMethodOptions);

    // GET /patients/{id}
    const patientById = patients.addResource('{id}');
    patientById.addMethod('GET', new apigateway.LambdaIntegration(getPatientFn), authMethodOptions);

    // GET /patients/{id}/notes  &  POST /patients/{id}/notes  &  DELETE /patients/{id}/notes/{noteId}
    const patientNotes = patientById.addResource('notes');
    patientNotes.addMethod('GET', new apigateway.LambdaIntegration(listNotesFn), authMethodOptions);
    patientNotes.addMethod('POST', new apigateway.LambdaIntegration(createNoteFn), authMethodOptions);
    const patientNoteById = patientNotes.addResource('{noteId}');
    patientNoteById.addMethod('DELETE', new apigateway.LambdaIntegration(deleteNoteFn), authMethodOptions);

    // GET /dashboard/counts
    const dashboard = this.api.root.addResource('dashboard');
    const dashboardCounts = dashboard.addResource('counts');
    dashboardCounts.addMethod('GET', new apigateway.LambdaIntegration(dashboardCountsFn), authMethodOptions);

    // POST /voicemails/attach  &  PATCH /voicemails/{id}/archive
    const voicemails = this.api.root.addResource('voicemails');
    const attach = voicemails.addResource('attach');
    attach.addMethod('POST', new apigateway.LambdaIntegration(attachVoicemailFn), authMethodOptions);
    const voicemailById = voicemails.addResource('{id}');
    const archiveResource = voicemailById.addResource('archive');
    archiveResource.addMethod('PATCH', new apigateway.LambdaIntegration(archiveVoicemailFn), authMethodOptions);

    // GET /faxes  &  POST /faxes
    const faxes = this.api.root.addResource('faxes');
    faxes.addMethod('GET', new apigateway.LambdaIntegration(listFaxesFn), authMethodOptions);
    faxes.addMethod('POST', new apigateway.LambdaIntegration(sendFaxFn), authMethodOptions);

    // GET /zoom/voicemails  &  GET /zoom/call-logs
    const zoom = this.api.root.addResource('zoom');
    const zoomVoicemails = zoom.addResource('voicemails');
    zoomVoicemails.addMethod('GET', new apigateway.LambdaIntegration(listZoomVoicemailsFn), authMethodOptions);
    const zoomCallLogs = zoom.addResource('call-logs');
    zoomCallLogs.addMethod('GET', new apigateway.LambdaIntegration(listZoomCallLogsFn), authMethodOptions);

    // GET /stripe/customers
    const stripe = this.api.root.addResource('stripe');
    const stripeCustomers = stripe.addResource('customers');
    stripeCustomers.addMethod('GET', new apigateway.LambdaIntegration(stripeCustomerSearchFn), authMethodOptions);

    // POST /stripe/payment-intent
    const stripePaymentIntent = stripe.addResource('payment-intent');
    stripePaymentIntent.addMethod('POST', new apigateway.LambdaIntegration(stripePaymentIntentFn), authMethodOptions);

    // POST /stripe/charge-no-show
    const stripeChargeNoShow = stripe.addResource('charge-no-show');
    stripeChargeNoShow.addMethod('POST', new apigateway.LambdaIntegration(stripeChargeNoshowFn), authMethodOptions);

    // POST /stripe/setup-intent
    const stripeSetupIntent = stripe.addResource('setup-intent');
    stripeSetupIntent.addMethod('POST', new apigateway.LambdaIntegration(stripeSetupIntentFn), authMethodOptions);

    // POST /stripe/confirm-setup
    const stripeConfirmSetup = stripe.addResource('confirm-setup');
    stripeConfirmSetup.addMethod('POST', new apigateway.LambdaIntegration(stripeConfirmSetupFn), authMethodOptions);

    // GET /stripe/transactions
    const stripeTransactions = stripe.addResource('transactions');
    stripeTransactions.addMethod('GET', new apigateway.LambdaIntegration(stripeTransactionsFn), authMethodOptions);

    // GET /billing/lookup  &  POST /billing/charge  &  POST /billing/no-show  &  POST /billing/payment-intent
    const billing = this.api.root.addResource('billing');
    const billingLookup = billing.addResource('lookup');
    billingLookup.addMethod('GET', new apigateway.LambdaIntegration(billingLookupFn), authMethodOptions);
    const charge = billing.addResource('charge');
    charge.addMethod('POST', new apigateway.LambdaIntegration(billingDirectChargeFn), authMethodOptions);
    const noShow = billing.addResource('no-show');
    noShow.addMethod('POST', new apigateway.LambdaIntegration(billingNoShowFn), authMethodOptions);
    const billingPaymentIntent = billing.addResource('payment-intent');
    billingPaymentIntent.addMethod('POST', new apigateway.LambdaIntegration(billingPaymentIntentFn), authMethodOptions);

    // POST /notifications/login-failure (no auth — user isn't logged in)
    const notifications = this.api.root.addResource('notifications');
    const loginFailure = notifications.addResource('login-failure');
    loginFailure.addMethod('POST', new apigateway.LambdaIntegration(notifyLoginFailureFn));

    // POST /auth/forgot-password  &  POST /auth/confirm-forgot-password
    // (no auth — custom reset flow that works alongside EMAIL_OTP MFA)
    const authResource = this.api.root.addResource('auth');
    const forgotPasswordResource = authResource.addResource('forgot-password');
    forgotPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(initiatePasswordResetFn));
    const confirmPasswordResource = authResource.addResource('confirm-forgot-password');
    confirmPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(confirmPasswordResetFn));

    // GET /transcription/upload-url  &  POST /transcription/start  &  GET /transcription/result
    const transcription = this.api.root.addResource('transcription');
    const uploadUrl = transcription.addResource('upload-url');
    uploadUrl.addMethod('GET', new apigateway.LambdaIntegration(getUploadUrlFn), authMethodOptions);
    const startTranscription = transcription.addResource('start');
    startTranscription.addMethod('POST', new apigateway.LambdaIntegration(apiStartTranscriptionFn), authMethodOptions);
    const transcriptionResult = transcription.addResource('result');
    transcriptionResult.addMethod('GET', new apigateway.LambdaIntegration(getTranscriptionResultFn), authMethodOptions);

    // ── Outputs ──
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
