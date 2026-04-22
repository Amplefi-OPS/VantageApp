import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import { Construct } from 'constructs';

interface StorageStackProps extends cdk.StackProps {
  stageName: string;
  retentionAudioDays: number;
  retentionTranscriptDays: number;
}

export class StorageStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;
  public readonly audioBucket: s3.Bucket;
  public readonly transcriptBucket: s3.Bucket;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // ── KMS Key for PHI encryption ──
    this.kmsKey = new kms.Key(this, 'PhiEncryptionKey', {
      alias: `vantage-phi-${props.stageName}`,
      description: 'KMS key for encrypting PHI data (audio, transcripts, DynamoDB)',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── S3: Raw Audio Bucket ──
    this.audioBucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: `vantage-audio-${props.stageName}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      serverAccessLogsPrefix: 'access-logs/',
      lifecycleRules: [
        {
          id: 'expire-dictation-audio',
          prefix: 'dictations/',
          expiration: cdk.Duration.days(props.retentionAudioDays),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
        {
          id: 'expire-voicemail-audio',
          prefix: 'voicemails/',
          expiration: cdk.Duration.days(2555), // ~7 years (HIPAA retention)
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: props.stageName === 'prod'
            ? [
                'https://provider.vantagerefinery.com',
                'https://providerdev.vantagerefinery.com',
              ]
            : [
                'https://main.d310usa2cmh4sh.amplifyapp.com',
                'https://main.dvufomlgdfium.amplifyapp.com',
                'https://provider.vantagerefinery.com',
                'https://providerdev.vantagerefinery.com',
                'http://localhost:5173',
                'http://localhost:4173',
              ],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      eventBridgeEnabled: true, // Send S3 events to EventBridge (avoids cross-stack circular deps)
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── S3: Transcript Bucket ──
    this.transcriptBucket = new s3.Bucket(this, 'TranscriptBucket', {
      bucketName: `vantage-transcripts-${props.stageName}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      serverAccessLogsPrefix: 'access-logs/',
      lifecycleRules: [
        {
          id: 'retain-transcripts',
          expiration: cdk.Duration.days(props.retentionTranscriptDays), // ~7 years
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── DynamoDB: Single-table design ──
    // PK/SK pattern:
    //   PROVIDER#{id}                    / PROFILE                -> Provider record
    //   PROVIDER#{id}                    / TASK#{id}              -> Task
    //   PROVIDER#{id}                    / APPT#{date}#{id}       -> Appointment
    //   PROVIDER#{id}                    / DICT#{id}              -> Dictation
    //   PATIENT#{token}                  / PROFILE                -> Patient reference
    //   BILLING#{id}                     / EVENT                  -> Billing event
    //   AUDIT#{yyyy-mm-dd}              / {timestamp}#{entity}   -> Audit log
    this.table = new dynamodb.Table(this, 'VantageTable', {
      tableName: `vantage-${props.stageName}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // GSI1: Query tasks by provider + status + dueDate
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Query by entity type across providers (admin views, billing lookups)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── CloudTrail for data events ──
    const trail = new cloudtrail.Trail(this, 'DataTrail', {
      trailName: `vantage-data-trail-${props.stageName}`,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: false,
      enableFileValidation: true,
    });

    trail.addS3EventSelector([
      { bucket: this.audioBucket },
      { bucket: this.transcriptBucket },
    ], {
      readWriteType: cloudtrail.ReadWriteType.ALL,
      includeManagementEvents: false,
    });

    // ── Outputs ──
    new cdk.CfnOutput(this, 'AudioBucketName', { value: this.audioBucket.bucketName });
    new cdk.CfnOutput(this, 'TranscriptBucketName', { value: this.transcriptBucket.bucketName });
    new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'KmsKeyArn', { value: this.kmsKey.keyArn });
  }
}
