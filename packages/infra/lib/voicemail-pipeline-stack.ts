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
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

interface VoicemailPipelineStackProps extends cdk.StackProps {
  stageName: string;
  table: dynamodb.Table;
  audioBucket: s3.Bucket;
  transcriptBucket: s3.Bucket;
  kmsKey: kms.Key;
}

export class VoicemailPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VoicemailPipelineStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', '..', 'api', 'handlers');

    const commonEnv: Record<string, string> = {
      TABLE_NAME: props.table.tableName,
      AUDIO_BUCKET: props.audioBucket.bucketName,
      TRANSCRIPT_BUCKET: props.transcriptBucket.bucketName,
      KMS_KEY_ARN: props.kmsKey.keyArn,
      STAGE: props.stageName,
    };

    // Secrets Manager ARN for Slack webhook (used by vm-complete-transcription)
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'AppCredentials', `vantage/credentials/${props.stageName}`,
    );

    // ── Lambda: Start Voicemail Transcription ──
    const vmStartTranscriptionFn = new lambdaNode.NodejsFunction(this, 'VmStartTranscriptionFn', {
      functionName: `vantage-vm-start-transcription-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'vm-start-transcription.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: commonEnv,
    });

    vmStartTranscriptionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'transcribe:StartMedicalTranscriptionJob',
        'transcribe:GetMedicalTranscriptionJob',
      ],
      resources: ['*'],
    }));
    props.audioBucket.grantRead(vmStartTranscriptionFn);
    props.transcriptBucket.grantWrite(vmStartTranscriptionFn);
    props.kmsKey.grantEncryptDecrypt(vmStartTranscriptionFn);
    props.table.grantReadWriteData(vmStartTranscriptionFn);

    // ── Lambda: Check Transcription Status (reuse existing) ──
    const vmCheckTranscriptionFn = new lambdaNode.NodejsFunction(this, 'VmCheckTranscriptionFn', {
      functionName: `vantage-vm-check-transcription-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'check-transcription.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: commonEnv,
    });

    vmCheckTranscriptionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:GetMedicalTranscriptionJob'],
      resources: ['*'],
    }));

    // ── Lambda: Complete Voicemail Transcription ──
    const vmCompleteTranscriptionFn = new lambdaNode.NodejsFunction(this, 'VmCompleteTranscriptionFn', {
      functionName: `vantage-vm-complete-transcription-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'vm-complete-transcription.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ...commonEnv,
        SECRET_NAME: `vantage/credentials/${props.stageName}`,
      },
    });

    props.transcriptBucket.grantReadWrite(vmCompleteTranscriptionFn);
    props.kmsKey.grantEncryptDecrypt(vmCompleteTranscriptionFn);
    props.table.grantReadWriteData(vmCompleteTranscriptionFn);
    appSecret.grantRead(vmCompleteTranscriptionFn);

    // ── Step Functions: Voicemail Transcription Pipeline ──
    const startJob = new tasks.LambdaInvoke(this, 'VmStartTranscriptionJob', {
      lambdaFunction: vmStartTranscriptionFn,
      outputPath: '$.Payload',
    });

    // Initial wait: 15s (audio needs time to land in Transcribe)
    const initialWait = new sfn.Wait(this, 'VmInitialWait', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(15)),
    });

    // Subsequent poll wait: 10s
    const waitForTranscription = new sfn.Wait(this, 'VmWaitForTranscription', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(10)),
    });

    const checkStatus = new tasks.LambdaInvoke(this, 'VmCheckTranscriptionStatus', {
      lambdaFunction: vmCheckTranscriptionFn,
      outputPath: '$.Payload',
    });

    const processResult = new tasks.LambdaInvoke(this, 'VmProcessTranscriptionResult', {
      lambdaFunction: vmCompleteTranscriptionFn,
      outputPath: '$.Payload',
    });

    // Route FAILED to the same completion Lambda — it handles both
    // COMPLETED and FAILED, updating DynamoDB accordingly.
    const handleFailure = new tasks.LambdaInvoke(this, 'VmHandleTranscriptionFailure', {
      lambdaFunction: vmCompleteTranscriptionFn,
      outputPath: '$.Payload',
    });

    const skipAlreadyDone = new sfn.Succeed(this, 'VmTranscriptionAlreadyDone');

    // Poll loop: initialWait (15s) → check → choice → waitForTranscription (10s) → check ...
    // Max 24 attempts (15s + 23*10s = 245s ≈ 4 min)
    const isComplete = new sfn.Choice(this, 'VmIsTranscriptionComplete')
      .when(sfn.Condition.stringEquals('$.status', 'COMPLETED'), processResult)
      .when(sfn.Condition.stringEquals('$.status', 'FAILED'), handleFailure)
      .otherwise(waitForTranscription);

    // After startJob, check if we should skip (idempotent re-trigger)
    const shouldProceed = new sfn.Choice(this, 'VmShouldProceed')
      .when(sfn.Condition.stringEquals('$.status', 'COMPLETED'), skipAlreadyDone)
      .when(sfn.Condition.stringEquals('$.status', 'ALREADY_IN_PROGRESS'), skipAlreadyDone)
      .otherwise(initialWait);

    const definition = startJob
      .next(shouldProceed);

    // First poll: initialWait (15s) → check → choice
    initialWait
      .next(checkStatus)
      .next(isComplete);

    // Subsequent polls: waitForTranscription (10s) → check (loops back via isComplete)
    waitForTranscription
      .next(checkStatus);

    const stateMachine = new sfn.StateMachine(this, 'VmTranscriptionStateMachine', {
      stateMachineName: `vantage-vm-transcription-${props.stageName}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'VmStateMachineLogs', {
          logGroupName: `/aws/stepfunctions/vantage-vm-transcription-${props.stageName}`,
          retention: logs.RetentionDays.ONE_YEAR,
        }),
        level: sfn.LogLevel.ERROR,
      },
    });

    // ── Lambda: S3 Event Trigger (starts Step Functions for voicemails) ──
    const vmTriggerFn = new lambdaNode.NodejsFunction(this, 'VmS3TriggerFn', {
      functionName: `vantage-vm-s3-trigger-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'transcription', 'vm-s3-trigger.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(15),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        TABLE_NAME: props.table.tableName,
      },
    });

    stateMachine.grantStartExecution(vmTriggerFn);
    props.table.grantReadData(vmTriggerFn);

    // Wire S3 events via EventBridge -> trigger Lambda
    new events.Rule(this, 'VoicemailUploadRule', {
      ruleName: `vantage-voicemail-upload-${props.stageName}`,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.audioBucket.bucketName] },
          object: { key: [{ prefix: 'voicemails/' }] },
        },
      },
      targets: [new eventsTargets.LambdaFunction(vmTriggerFn)],
    });

    // Grant Transcribe service access to S3 and KMS
    props.audioBucket.grantRead(new iam.ServicePrincipal('transcribe.amazonaws.com'));
    props.transcriptBucket.grantWrite(new iam.ServicePrincipal('transcribe.amazonaws.com'));

    // ── Outputs ──
    new cdk.CfnOutput(this, 'VmStateMachineArn', { value: stateMachine.stateMachineArn });
  }
}
