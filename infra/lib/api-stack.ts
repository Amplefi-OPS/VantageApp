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

    const lambdaDir = path.join(__dirname, '..', 'lambda');

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
      logRetention: logs.RetentionDays.ONE_YEAR,
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

    // Acuity + Zoom + Stripe credentials are fetched at runtime via Secrets Manager.
    // No secrets in Lambda environment variables.

    // ── Lambda: List Acuity Appointments ──
    const listAcuityAppointmentsFn = new lambdaNode.NodejsFunction(this, 'ListAcuityAppointmentsFn', {
      ...lambdaDefaults,
      functionName: `vantage-list-acuity-appointments-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'list-acuity-appointments.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadData(listAcuityAppointmentsFn);

    // ── Lambda: Cancel Acuity Appointment ──
    const cancelAcuityAppointmentFn = new lambdaNode.NodejsFunction(this, 'CancelAcuityAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-cancel-acuity-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'cancel-acuity-appointment.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(cancelAcuityAppointmentFn);

    // ── Lambda: No-Show Acuity Appointment ──
    const noshowAcuityAppointmentFn = new lambdaNode.NodejsFunction(this, 'NoshowAcuityAppointmentFn', {
      ...lambdaDefaults,
      functionName: `vantage-noshow-acuity-appointment-${props.stageName}`,
      entry: path.join(lambdaDir, 'api', 'noshow-acuity-appointment.ts'),
      handler: 'handler',
      environment: { ...commonEnv, },
    });
    props.table.grantReadWriteData(noshowAcuityAppointmentFn);

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

    // ── Grant Secrets Manager read to Lambdas that need third-party credentials ──
    const secretConsumers = [
      listAcuityAppointmentsFn,
      cancelAcuityAppointmentFn,
      noshowAcuityAppointmentFn,
      listZoomVoicemailsFn,
      listZoomCallLogsFn,
      attachVoicemailFn,
      archiveVoicemailFn,
      listFaxesFn,
      sendFaxFn,
      stripeCustomerSearchFn,
      stripePaymentIntentFn,
      stripeChargeNoshowFn,
      stripeTransactionsFn,
    ];
    for (const fn of secretConsumers) {
      appSecret.grantRead(fn);
    }

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
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'https://main.dvufomlgdfium.amplifyapp.com',
          'https://providerdev.vantagerefinery.com',
          ...(props.stageName === 'dev' ? ['http://localhost:5173', 'http://localhost:4173'] : []),
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

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

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

    // GET /appointments (Acuity Scheduling proxy)
    const appointments = this.api.root.addResource('appointments');
    appointments.addMethod('GET', new apigateway.LambdaIntegration(listAcuityAppointmentsFn), authMethodOptions);

    // PUT /appointments/{id}/cancel
    const appointmentById = appointments.addResource('{id}');
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

    // GET /patients/{id}/notes  &  POST /patients/{id}/notes
    const patientNotes = patientById.addResource('notes');
    patientNotes.addMethod('GET', new apigateway.LambdaIntegration(listNotesFn), authMethodOptions);
    patientNotes.addMethod('POST', new apigateway.LambdaIntegration(createNoteFn), authMethodOptions);

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

    // GET /stripe/transactions
    const stripeTransactions = stripe.addResource('transactions');
    stripeTransactions.addMethod('GET', new apigateway.LambdaIntegration(stripeTransactionsFn), authMethodOptions);

    // POST /billing/charge
    const billing = this.api.root.addResource('billing');
    const charge = billing.addResource('charge');
    charge.addMethod('POST', new apigateway.LambdaIntegration(billingChargeFn), authMethodOptions);

    // ── Outputs ──
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
