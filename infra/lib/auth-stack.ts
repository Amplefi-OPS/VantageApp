import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface AuthStackProps extends cdk.StackProps {
  stageName: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', 'lambda');

    // ── Pre Sign-Up Trigger: Email Domain Restriction ──
    const preSignUpFn = new lambdaNode.NodejsFunction(this, 'PreSignUpFn', {
      functionName: `vantage-pre-sign-up-${props.stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(lambdaDir, 'auth', 'pre-sign-up.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_YEAR,
    });

    // ── Cognito User Pool ──
    this.userPool = new cognito.UserPool(this, 'VantageUserPool', {
      userPoolName: `vantage-providers-${props.stageName}`,
      selfSignUpEnabled: false, // Admin-only creation for providers
      signInAliases: {
        email: true,
        username: false,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        provider_id: new cognito.StringAttribute({ mutable: false }),
        role: new cognito.StringAttribute({ mutable: true }), // provider | admin
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: false,
        otp: true, // CDK requires at least one; we override to EMAIL_OTP below
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(1),
      },
      accountRecovery: cognito.AccountRecovery.NONE, // Admin-only reset (email used for MFA)
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      lambdaTriggers: {
        preSignUp: preSignUpFn,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Override MFA to Email OTP (CDK L2 doesn't support EMAIL_OTP yet) ──
    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.addPropertyOverride('EnabledMfas', ['EMAIL_OTP']);
    cfnUserPool.addPropertyOverride('EmailConfiguration', {
      EmailSendingAccount: 'DEVELOPER',
      SourceArn: `arn:aws:ses:us-east-1:${this.account}:identity/vantagerefinery.com`,
      From: 'noreply@vantagerefinery.com',
    });

    // ── User Pool Groups ──
    new cognito.CfnUserPoolGroup(this, 'ProviderGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'providers',
      description: 'Physician/provider users',
    });

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admins',
      description: 'Administrative users with cross-provider access',
    });

    // ── User Pool Client (for web portal) ──
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `vantage-web-${props.stageName}`,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      enableTokenRevocation: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // ── Hosted UI Domain (for OAuth flows if needed) ──
    this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: `vantage-health-${props.stageName}`,
      },
    });

    // ── Outputs ──
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolArn', { value: this.userPool.userPoolArn });
  }
}
