import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

interface ScheduledTasksStackProps extends cdk.StackProps {
  stageName: string;
  table: dynamodb.Table;
}

export class ScheduledTasksStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ScheduledTasksStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', '..', 'api', 'handlers');

    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'AppCredentials', `vantage/credentials/${props.stageName}`,
    );

    const sharedBundling: lambdaNode.BundlingOptions = {
      minify: true,
      sourceMap: true,
      target: 'node20',
      externalModules: ['@aws-sdk/*'],
    };

    // ── Lambda: Create daily "Check Fax Inbox" task ──
    const createDailyFaxTaskFn = new lambdaNode.NodejsFunction(this, 'CreateDailyFaxTaskFn', {
      functionName: `vantage-create-daily-fax-task-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'api', 'create-daily-fax-task.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(15),
      environment: {
        TABLE_NAME: props.table.tableName,
        STAGE: props.stageName,
        PROVIDER_ID: 'dr-jane-001',
      },
      bundling: sharedBundling,
    });

    props.table.grantReadWriteData(createDailyFaxTaskFn);

    // ── EventBridge: Weekdays at 8 AM Eastern ──
    // cron(minutes hours day-of-month month day-of-week year)
    // 13:00 UTC = 8:00 AM EST / 9:00 AM EDT (close enough for office use)
    new events.Rule(this, 'DailyFaxTaskRule', {
      ruleName: `vantage-daily-fax-task-${props.stageName}`,
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '13',
        weekDay: 'MON-FRI',
      }),
      targets: [new targets.LambdaFunction(createDailyFaxTaskFn)],
    });

    // ── Lambda: Auto-archive old Done tasks (graveyard fix) ──
    const autoArchiveDoneTasksFn = new lambdaNode.NodejsFunction(this, 'AutoArchiveDoneTasksFn', {
      functionName: `vantage-auto-archive-done-tasks-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'api', 'auto-archive-done-tasks.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        TABLE_NAME: props.table.tableName,
        STAGE: props.stageName,
        ARCHIVE_DONE_AFTER_DAYS: '30',
      },
      bundling: sharedBundling,
    });

    props.table.grantReadWriteData(autoArchiveDoneTasksFn);

    // ── EventBridge: Daily at 9 AM Eastern ──
    new events.Rule(this, 'AutoArchiveDoneTasksRule', {
      ruleName: `vantage-auto-archive-done-tasks-${props.stageName}`,
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '14',
      }),
      targets: [new targets.LambdaFunction(autoArchiveDoneTasksFn)],
    });

    // ── Lambda: Derive no-show charges (Phase 5 event producer) ──
    const deriveNoShowChargesFn = new lambdaNode.NodejsFunction(this, 'DeriveNoShowChargesFn', {
      functionName: `vantage-derive-no-show-charges-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'api', 'derive-no-show-charges.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(120),
      environment: {
        TABLE_NAME: props.table.tableName,
        STAGE: props.stageName,
        SECRET_NAME: `vantage/credentials/${props.stageName}`,
        EVENT_BUS_NAME: `vantage-billing-${props.stageName}`,
        PROVIDER_ID: 'dr-jane-001',
        NO_SHOW_FEE_CENTS: '3000',
        NO_SHOW_GRACE_MINUTES: '120',
        NO_SHOW_LOOKBACK_HOURS: '72',
      },
      bundling: sharedBundling,
    });
    props.table.grantReadWriteData(deriveNoShowChargesFn);
    appSecret.grantRead(deriveNoShowChargesFn);
    deriveNoShowChargesFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:us-east-1:${this.account}:event-bus/vantage-billing-${props.stageName}`],
      }),
    );

    // ── EventBridge: Weekdays at 11 PM UTC (after office hours) ──
    new events.Rule(this, 'DeriveNoShowChargesRule', {
      ruleName: `vantage-derive-no-show-charges-${props.stageName}`,
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '23',
        weekDay: 'MON-FRI',
      }),
      targets: [new targets.LambdaFunction(deriveNoShowChargesFn)],
    });

    // ── Lambda: Poll content@ Gmail inbox ──
    const pollContentInboxFn = new lambdaNode.NodejsFunction(this, 'PollContentInboxFn', {
      functionName: `vantage-poll-content-inbox-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'email', 'poll-content-inbox.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        TABLE_NAME: props.table.tableName,
        STAGE: props.stageName,
        SECRET_NAME: `vantage/credentials/${props.stageName}`,
      },
      bundling: sharedBundling,
    });
    props.table.grantReadWriteData(pollContentInboxFn);
    appSecret.grantRead(pollContentInboxFn);

    new events.Rule(this, 'PollContentInboxRule', {
      ruleName: `vantage-poll-content-inbox-${props.stageName}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(pollContentInboxFn)],
    });
  }
}
