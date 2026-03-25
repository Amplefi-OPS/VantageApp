#!/bin/bash
# Restore Lambda env vars that get wiped by CDK deploy.
# Run this AFTER every `cdk deploy`.
# Generated 2026-03-25

set -e

echo "Restoring Zoom/Fax Lambda environment variables..."

aws lambda update-function-configuration --function-name vantage-list-zoom-voicemails-dev \
  --environment 'Variables={TABLE_NAME=vantage-dev,SECRET_NAME=vantage/credentials/dev,STAGE=dev,PRESIGN_EXPIRY_SECONDS=900,MAX_UPLOAD_SIZE_MB=100,KMS_KEY_ARN=arn:aws:kms:us-east-1:841722554807:key/428e941a-3782-47b7-bbb4-5043fdb64e49,AUDIO_BUCKET=vantage-audio-dev-841722554807,TRANSCRIPT_BUCKET=vantage-transcripts-dev-841722554807,ZOOM_ACCOUNT_ID=zD57LYyNSiWL_Lw5vkelug,ZOOM_CLIENT_ID=IRb5i44HRyPxYppANGlSw,ZOOM_CLIENT_SECRET=rrnxeucFKzvSEF60ZAiTme5mfa28R2Zv,ZOOM_USER_EMAIL=jane@vantagerefinery.com,ZOOM_AUTO_RECEPTIONIST_IDS=P1Bq1w6ATwqFSCLJFYkfZw\,DvTFo2phSce1lUA5YUyQYw\,aHt2uK35QKWmM7G0u8PjOQ\,PmmGfdpjRHqmA7aJWnpBwA\,InIry0JASsWa3cICJeK8Qg,SCOPE_VERSION=2}' \
  --output text --query "FunctionName" && echo " OK"

aws lambda update-function-configuration --function-name vantage-list-zoom-call-logs-dev \
  --environment 'Variables={TABLE_NAME=vantage-dev,SECRET_NAME=vantage/credentials/dev,STAGE=dev,PRESIGN_EXPIRY_SECONDS=900,MAX_UPLOAD_SIZE_MB=100,KMS_KEY_ARN=arn:aws:kms:us-east-1:841722554807:key/428e941a-3782-47b7-bbb4-5043fdb64e49,AUDIO_BUCKET=vantage-audio-dev-841722554807,TRANSCRIPT_BUCKET=vantage-transcripts-dev-841722554807,ZOOM_ACCOUNT_ID=zD57LYyNSiWL_Lw5vkelug,ZOOM_CLIENT_ID=IRb5i44HRyPxYppANGlSw,ZOOM_CLIENT_SECRET=rrnxeucFKzvSEF60ZAiTme5mfa28R2Zv,ZOOM_USER_EMAIL=jane@vantagerefinery.com,ZOOM_AUTO_RECEPTIONIST_IDS=P1Bq1w6ATwqFSCLJFYkfZw\,DvTFo2phSce1lUA5YUyQYw\,aHt2uK35QKWmM7G0u8PjOQ\,PmmGfdpjRHqmA7aJWnpBwA\,InIry0JASsWa3cICJeK8Qg}' \
  --output text --query "FunctionName" && echo " OK"

aws lambda update-function-configuration --function-name vantage-list-faxes-dev \
  --environment 'Variables={TABLE_NAME=vantage-dev,SECRET_NAME=vantage/credentials/dev,STAGE=dev,PRESIGN_EXPIRY_SECONDS=900,MAX_UPLOAD_SIZE_MB=100,KMS_KEY_ARN=arn:aws:kms:us-east-1:841722554807:key/428e941a-3782-47b7-bbb4-5043fdb64e49,AUDIO_BUCKET=vantage-audio-dev-841722554807,TRANSCRIPT_BUCKET=vantage-transcripts-dev-841722554807,ZOOM_ACCOUNT_ID=zD57LYyNSiWL_Lw5vkelug,ZOOM_CLIENT_ID=IRb5i44HRyPxYppANGlSw,ZOOM_CLIENT_SECRET=rrnxeucFKzvSEF60ZAiTme5mfa28R2Zv,ZOOM_FAX_EXTENSION_ID=mPeMi39fRIuFEM-_5cGFUA}' \
  --output text --query "FunctionName" && echo " OK"

aws lambda update-function-configuration --function-name vantage-send-fax-dev \
  --environment 'Variables={TABLE_NAME=vantage-dev,SECRET_NAME=vantage/credentials/dev,STAGE=dev,PRESIGN_EXPIRY_SECONDS=900,MAX_UPLOAD_SIZE_MB=100,KMS_KEY_ARN=arn:aws:kms:us-east-1:841722554807:key/428e941a-3782-47b7-bbb4-5043fdb64e49,AUDIO_BUCKET=vantage-audio-dev-841722554807,TRANSCRIPT_BUCKET=vantage-transcripts-dev-841722554807,ZOOM_ACCOUNT_ID=zD57LYyNSiWL_Lw5vkelug,ZOOM_CLIENT_ID=IRb5i44HRyPxYppANGlSw,ZOOM_CLIENT_SECRET=rrnxeucFKzvSEF60ZAiTme5mfa28R2Zv,ZOOM_FAX_EXTENSION_ID=mPeMi39fRIuFEM-_5cGFUA}' \
  --output text --query "FunctionName" && echo " OK"

aws lambda update-function-configuration --function-name vantage-attach-voicemail-dev \
  --environment 'Variables={TABLE_NAME=vantage-dev,SECRET_NAME=vantage/credentials/dev,STAGE=dev,PRESIGN_EXPIRY_SECONDS=900,MAX_UPLOAD_SIZE_MB=100,KMS_KEY_ARN=arn:aws:kms:us-east-1:841722554807:key/428e941a-3782-47b7-bbb4-5043fdb64e49,AUDIO_BUCKET=vantage-audio-dev-841722554807,TRANSCRIPT_BUCKET=vantage-transcripts-dev-841722554807,ZOOM_ACCOUNT_ID=zD57LYyNSiWL_Lw5vkelug,ZOOM_CLIENT_ID=IRb5i44HRyPxYppANGlSw,ZOOM_CLIENT_SECRET=rrnxeucFKzvSEF60ZAiTme5mfa28R2Zv}' \
  --output text --query "FunctionName" && echo " OK"

aws lambda update-function-configuration --function-name vantage-archive-voicemail-dev \
  --environment 'Variables={TABLE_NAME=vantage-dev,SECRET_NAME=vantage/credentials/dev,STAGE=dev,PRESIGN_EXPIRY_SECONDS=900,MAX_UPLOAD_SIZE_MB=100,KMS_KEY_ARN=arn:aws:kms:us-east-1:841722554807:key/428e941a-3782-47b7-bbb4-5043fdb64e49,AUDIO_BUCKET=vantage-audio-dev-841722554807,TRANSCRIPT_BUCKET=vantage-transcripts-dev-841722554807,ZOOM_ACCOUNT_ID=zD57LYyNSiWL_Lw5vkelug,ZOOM_CLIENT_ID=IRb5i44HRyPxYppANGlSw,ZOOM_CLIENT_SECRET=rrnxeucFKzvSEF60ZAiTme5mfa28R2Zv}' \
  --output text --query "FunctionName" && echo " OK"

echo ""
echo "All Zoom/Fax Lambda env vars restored."
