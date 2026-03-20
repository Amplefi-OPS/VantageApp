import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
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
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: logs.RetentionDays.ONE_YEAR,
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
  }
}
