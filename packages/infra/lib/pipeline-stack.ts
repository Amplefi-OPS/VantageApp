import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface PipelineStackProps extends cdk.StackProps {
  stageName: string;
  table: dynamodb.Table;
  audioBucket: s3.Bucket;
  transcriptBucket: s3.Bucket;
  kmsKey: kms.Key;
}

export class TranscriptionPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', '..', 'api', 'handlers');

    const commonEnv: Record<string, string> = {
      TABLE_NAME: props.table.tableName,
      AUDIO_BUCKET: props.audioBucket.bucketName,
      TRANSCRIPT_BUCKET: props.transcriptBucket.bucketName,
      KMS_KEY_ARN: props.kmsKey.keyArn,
      STAGE: props.stageName,
    };

    // ── Lambda: Start Transcription ──
    const startTranscriptionFn = new lambdaNode.NodejsFunction(this, 'StartTranscriptionFn', {
      functionName: `vantage-start-transcription-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'start-transcription.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: commonEnv,
    });

    // Transcribe Medical permissions
    startTranscriptionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'transcribe:StartMedicalTranscriptionJob',
        'transcribe:GetMedicalTranscriptionJob',
      ],
      resources: ['*'],
    }));
    props.audioBucket.grantRead(startTranscriptionFn);
    props.transcriptBucket.grantWrite(startTranscriptionFn);
    props.kmsKey.grantEncryptDecrypt(startTranscriptionFn);
    props.table.grantReadWriteData(startTranscriptionFn);

    // ── Lambda: Check Transcription Status ──
    const checkTranscriptionFn = new lambdaNode.NodejsFunction(this, 'CheckTranscriptionFn', {
      functionName: `vantage-check-transcription-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'check-transcription.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: commonEnv,
    });

    checkTranscriptionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:GetMedicalTranscriptionJob'],
      resources: ['*'],
    }));

    // ── Lambda: Complete Transcription ──
    const completeTranscriptionFn = new lambdaNode.NodejsFunction(this, 'CompleteTranscriptionFn', {
      functionName: `vantage-complete-transcription-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'complete-transcription.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: commonEnv,
    });

    props.transcriptBucket.grantReadWrite(completeTranscriptionFn);
    props.kmsKey.grantEncryptDecrypt(completeTranscriptionFn);
    props.table.grantReadWriteData(completeTranscriptionFn);

    // ── Step Functions: Transcription Pipeline ──
    // State 1: Start transcription job
    const startJob = new tasks.LambdaInvoke(this, 'StartTranscriptionJob', {
      lambdaFunction: startTranscriptionFn,
      outputPath: '$.Payload',
    });

    // State 2a: Initial wait (15s — audio needs time to start processing)
    const initialWait = new sfn.Wait(this, 'InitialWait', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(15)),
    });

    // State 2b: Subsequent poll wait (10s)
    const waitForTranscription = new sfn.Wait(this, 'WaitForTranscription', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(10)),
    });

    // State 3: Check job status
    const checkStatus = new tasks.LambdaInvoke(this, 'CheckTranscriptionStatus', {
      lambdaFunction: checkTranscriptionFn,
      outputPath: '$.Payload',
    });

    // State 4: Process completed transcription
    const processResult = new tasks.LambdaInvoke(this, 'ProcessTranscriptionResult', {
      lambdaFunction: completeTranscriptionFn,
      outputPath: '$.Payload',
    });

    // State 5: Handle failure
    const handleFailure = new sfn.Pass(this, 'TranscriptionFailed', {
      parameters: {
        'status': 'FAILED',
        'error.$': '$.error',
        'jobName.$': '$.jobName',
      },
    });

    // Choice: is job complete?
    const isComplete = new sfn.Choice(this, 'IsTranscriptionComplete')
      .when(sfn.Condition.stringEquals('$.status', 'COMPLETED'), processResult)
      .when(sfn.Condition.stringEquals('$.status', 'FAILED'), handleFailure)
      .otherwise(waitForTranscription);

    // Wire up: start → initial wait (15s) → check → choice → poll wait (10s) → check ...
    const definition = startJob
      .next(initialWait)
      .next(checkStatus)
      .next(isComplete);

    waitForTranscription
      .next(checkStatus);

    const stateMachine = new sfn.StateMachine(this, 'TranscriptionStateMachine', {
      stateMachineName: `vantage-transcription-${props.stageName}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'StateMachineLogs', {
          logGroupName: `/aws/stepfunctions/vantage-transcription-${props.stageName}`,
          retention: logs.RetentionDays.ONE_YEAR,
        }),
        level: sfn.LogLevel.ERROR,
      },
    });

    // ── Lambda: S3 Event Trigger (starts Step Functions) ──
    const triggerFn = new lambdaNode.NodejsFunction(this, 'S3TriggerFn', {
      functionName: `vantage-s3-trigger-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 's3-trigger.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(15),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        TABLE_NAME: props.table.tableName,
      },
    });

    stateMachine.grantStartExecution(triggerFn);
    props.table.grantReadData(triggerFn);

    // Wire S3 events via EventBridge -> trigger Lambda (avoids cross-stack circular deps)
    new events.Rule(this, 'AudioUploadRule', {
      ruleName: `vantage-audio-upload-${props.stageName}`,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.audioBucket.bucketName] },
          object: { key: [{ prefix: 'dictations/' }] },
        },
      },
      targets: [new eventsTargets.LambdaFunction(triggerFn)],
    });

    // Grant Transcribe service access to S3 and KMS
    props.audioBucket.grantRead(new iam.ServicePrincipal('transcribe.amazonaws.com'));
    props.transcriptBucket.grantWrite(new iam.ServicePrincipal('transcribe.amazonaws.com'));

    // ── Outputs ──
    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
  }
}
