/*
 * EMR API Stack — Vantage Functional-Medicine EMR REST API.
 *
 * Isolated per-resource from the main VantageApp API:
 *   - own API Gateway (vantage-emr-api-{stage})
 *   - own CloudWatch access log group
 *   - reads/writes the EMR table + documents bucket (not VantageApp's)
 *   - reuses the existing Vantage Cognito User Pool (same 5 internal users
 *     log into both; no compliance benefit to a second pool)
 *
 * Dev-stage behavior matches api-stack.ts: the Cognito authorizer is not
 * attached in `dev`, so the stage is callable without tokens for smoke tests.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface EmrApiStackProps extends cdk.StackProps {
  stageName: string;
  emrTable: dynamodb.Table;
  emrDocumentsBucket: s3.Bucket;
  emrKmsKey: kms.Key;
  userPool: cognito.UserPool;
}

export class EmrApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: EmrApiStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', '..', 'api', 'handlers');

    const commonEnv: Record<string, string> = {
      TABLE_NAME: props.emrTable.tableName,
      EMR_DOCUMENTS_BUCKET: props.emrDocumentsBucket.bucketName,
      EMR_KMS_KEY_ARN: props.emrKmsKey.keyArn,
      STAGE: props.stageName,
    };

    const lambdaDefaults: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: commonEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
    };

    const listPatientsFn = new lambdaNode.NodejsFunction(this, 'EmrListPatientsFn', {
      ...lambdaDefaults,
      functionName: `vantage-emr-list-patients-${props.stageName}`,
      entry: path.join(lambdaDir, 'emr', 'list-patients.ts'),
      handler: 'handler',
    });
    props.emrTable.grantReadData(listPatientsFn);
    props.emrKmsKey.grantDecrypt(listPatientsFn);

    const getPatientFn = new lambdaNode.NodejsFunction(this, 'EmrGetPatientFn', {
      ...lambdaDefaults,
      functionName: `vantage-emr-get-patient-${props.stageName}`,
      entry: path.join(lambdaDir, 'emr', 'get-patient.ts'),
      handler: 'handler',
    });
    props.emrTable.grantReadData(getPatientFn);
    props.emrKmsKey.grantDecrypt(getPatientFn);

    const listVoicemailsFn = new lambdaNode.NodejsFunction(this, 'EmrListVoicemailsFn', {
      ...lambdaDefaults,
      functionName: `vantage-emr-list-voicemails-${props.stageName}`,
      entry: path.join(lambdaDir, 'emr', 'list-voicemails.ts'),
      handler: 'handler',
    });
    props.emrTable.grantReadData(listVoicemailsFn);
    props.emrKmsKey.grantDecrypt(listVoicemailsFn);

    const attachVoicemailFn = new lambdaNode.NodejsFunction(this, 'EmrAttachVoicemailFn', {
      ...lambdaDefaults,
      functionName: `vantage-emr-attach-voicemail-${props.stageName}`,
      entry: path.join(lambdaDir, 'emr', 'attach-voicemail.ts'),
      handler: 'handler',
    });
    props.emrTable.grantReadWriteData(attachVoicemailFn);
    props.emrKmsKey.grantEncryptDecrypt(attachVoicemailFn);

    const accessLogGroup = new logs.LogGroup(this, 'EmrApiAccessLogs', {
      logGroupName: `/aws/apigateway/vantage-emr-api-${props.stageName}-access`,
      retention: logs.RetentionDays.ONE_YEAR,
    });

    this.api = new apigateway.RestApi(this, 'VantageEmrApi', {
      restApiName: `vantage-emr-api-${props.stageName}`,
      description: 'Vantage functional-medicine EMR API',
      deployOptions: {
        stageName: props.stageName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true,
        throttlingBurstLimit: 50,
        throttlingRateLimit: 25,
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

    const authorizer = props.stageName !== 'dev'
      ? new apigateway.CognitoUserPoolsAuthorizer(this, 'EmrCognitoAuth', {
          cognitoUserPools: [props.userPool],
          authorizerName: `vantage-emr-cognito-${props.stageName}`,
          identitySource: 'method.request.header.Authorization',
        })
      : undefined;

    const authMethodOptions: apigateway.MethodOptions = authorizer
      ? { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO }
      : {};

    const patients = this.api.root.addResource('patients');
    patients.addMethod('GET', new apigateway.LambdaIntegration(listPatientsFn), authMethodOptions);
    const patientById = patients.addResource('{id}');
    patientById.addMethod('GET', new apigateway.LambdaIntegration(getPatientFn), authMethodOptions);

    const voicemails = this.api.root.addResource('voicemails');
    voicemails.addMethod('GET', new apigateway.LambdaIntegration(listVoicemailsFn), authMethodOptions);
    const voicemailById = voicemails.addResource('{id}');
    const voicemailAttach = voicemailById.addResource('attach');
    voicemailAttach.addMethod('POST', new apigateway.LambdaIntegration(attachVoicemailFn), authMethodOptions);

    new cdk.CfnOutput(this, 'EmrApiUrl', { value: this.api.url });
  }
}
