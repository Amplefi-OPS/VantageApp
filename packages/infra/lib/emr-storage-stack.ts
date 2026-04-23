import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface EmrStorageStackProps extends cdk.StackProps {
  stageName: string;
}

/**
 * Functional-medicine EMR storage — fully isolated from VantageApp:
 * its own KMS key, its own DynamoDB table, its own S3 bucket.
 * Separate BAA posture; separate CloudTrail export target later.
 *
 * Single-table design:
 *   PATIENT#{id}  PROFILE                    -> face sheet
 *   PATIENT#{id}  TODO#{todo_id}             -> patient-linked todo
 *   PATIENT#{id}  ENCOUNTER#{date}#{id}      -> future
 *   PATIENT#{id}  DICTATION#{ts}#{id}        -> future
 *   PATIENT#{id}  MED#{rxnorm}               -> future
 *   PATIENT#{id}  LAB#{loinc}#{ts}           -> future
 *   PATIENT#{id}  DOC#{sha256}               -> S3 pointer
 *
 * GSI1 usage:
 *   PATIENT / {last_name}#{first_name}       -> roster browsing
 *   TODO#OPEN / {due_at}#{todo_id}           -> doc's global open to-dos
 *   LEGACY#HHA / {legacy_billing_id}         -> import idempotency + reconciliation
 */
export class EmrStorageStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;
  public readonly table: dynamodb.Table;
  public readonly documentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: EmrStorageStackProps) {
    super(scope, id, props);

    this.kmsKey = new kms.Key(this, 'EmrPhiKey', {
      alias: `vantage-emr-phi-${props.stageName}`,
      description: 'KMS key for EMR PHI (DynamoDB + documents bucket)',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.documentsBucket = new s3.Bucket(this, 'EmrDocumentsBucket', {
      bucketName: `vantage-emr-docs-${props.stageName}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      serverAccessLogsPrefix: 'access-logs/',
      // No expiration: clinical documents (faxes, labs, dictation audio, import archives)
      // are retained per HIPAA requirements. Lifecycle rules can be added later per prefix.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.table = new dynamodb.Table(this, 'EmrTable', {
      tableName: `vantage-emr-${props.stageName}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'EmrTableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'EmrDocumentsBucketName', { value: this.documentsBucket.bucketName });
    new cdk.CfnOutput(this, 'EmrKmsKeyArn', { value: this.kmsKey.keyArn });
  }
}
