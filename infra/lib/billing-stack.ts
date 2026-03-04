import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface BillingStackProps extends cdk.StackProps {
  stageName: string;
  table: dynamodb.Table;
}

export class BillingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BillingStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', 'lambda');

    // ── Dead-letter queue for failed billing events ──
    const dlq = new sqs.Queue(this, 'BillingDLQ', {
      queueName: `vantage-billing-dlq-${props.stageName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // ── EventBridge bus for billing events ──
    const billingBus = new events.EventBus(this, 'BillingEventBus', {
      eventBusName: `vantage-billing-${props.stageName}`,
    });

    // ── Lambda: Process Stripe charges ──
    const stripeProcessorFn = new lambdaNode.NodejsFunction(this, 'StripeProcessorFn', {
      functionName: `vantage-stripe-processor-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'billing', 'stripe-processor.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
        STAGE: props.stageName,
        // STRIPE_SECRET_KEY stored in Secrets Manager, fetched at runtime
        STRIPE_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:vantage/stripe-key-${props.stageName}`,
      },
      deadLetterQueue: dlq,
      retryAttempts: 2,
      logRetention: logs.RetentionDays.ONE_YEAR,
    });
    props.table.grantReadWriteData(stripeProcessorFn);

    // Grant Secrets Manager read for Stripe key
    stripeProcessorFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:vantage/stripe-key-${props.stageName}*`],
      }),
    );

    // ── Lambda: Process QuickBooks events ──
    const quickbooksProcessorFn = new lambdaNode.NodejsFunction(this, 'QuickBooksProcessorFn', {
      functionName: `vantage-quickbooks-processor-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'billing', 'quickbooks-processor.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
        STAGE: props.stageName,
        QB_CREDENTIALS_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:vantage/quickbooks-${props.stageName}`,
      },
      deadLetterQueue: dlq,
      retryAttempts: 2,
      logRetention: logs.RetentionDays.ONE_YEAR,
    });
    props.table.grantReadWriteData(quickbooksProcessorFn);

    quickbooksProcessorFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:vantage/quickbooks-${props.stageName}*`],
      }),
    );

    // ── EventBridge Rules ──

    // Route "charge" events to Stripe processor
    new events.Rule(this, 'StripeChargeRule', {
      eventBus: billingBus,
      ruleName: `vantage-stripe-charge-${props.stageName}`,
      eventPattern: {
        source: ['vantage.billing'],
        detailType: ['ChargeRequested'],
        detail: {
          provider: ['stripe'],
        },
      },
      targets: [new targets.LambdaFunction(stripeProcessorFn)],
    });

    // Route "record" events to QuickBooks processor
    new events.Rule(this, 'QuickBooksRecordRule', {
      eventBus: billingBus,
      ruleName: `vantage-quickbooks-record-${props.stageName}`,
      eventPattern: {
        source: ['vantage.billing'],
        detailType: ['ChargeRequested', 'RefundRequested', 'RecordEvent'],
        detail: {
          provider: ['quickbooks'],
        },
      },
      targets: [new targets.LambdaFunction(quickbooksProcessorFn)],
    });

    // ── Lambda: DLQ Monitor (Slack alerts) ──
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'AppCredentials', `vantage/credentials/${props.stageName}`,
    );

    const dlqMonitorFn = new lambdaNode.NodejsFunction(this, 'DlqMonitorFn', {
      functionName: `vantage-dlq-monitor-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'billing', 'dlq-monitor.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(15),
      environment: {
        STAGE: props.stageName,
        DLQ_URL: dlq.queueUrl,
        SECRET_NAME: `vantage/credentials/${props.stageName}`,
      },
      logRetention: logs.RetentionDays.ONE_YEAR,
    });
    dlq.grantSendMessages(dlqMonitorFn); // read attributes
    dlqMonitorFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['sqs:GetQueueAttributes'],
        resources: [dlq.queueArn],
      }),
    );
    appSecret.grantRead(dlqMonitorFn);

    // Run every 5 minutes
    new events.Rule(this, 'DlqMonitorSchedule', {
      ruleName: `vantage-dlq-monitor-schedule-${props.stageName}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(dlqMonitorFn)],
    });

    // ── Outputs ──
    new cdk.CfnOutput(this, 'BillingEventBusArn', { value: billingBus.eventBusArn });
    new cdk.CfnOutput(this, 'BillingDLQUrl', { value: dlq.queueUrl });
  }
}
