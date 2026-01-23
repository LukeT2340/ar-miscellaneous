#!/bin/bash
set -e

# Check if S3_BUCKET is set
if [ -z "$S3_BUCKET" ]; then
  echo "❌ Error: S3_BUCKET environment variable not set"
  echo "Usage: S3_BUCKET=your-bucket-name ./deploy.sh"
  exit 1
fi

echo "📤 Uploading function.zip to S3..."
aws s3 cp function.zip s3://$S3_BUCKET/lambda-functions/create-clip.zip

echo "🚀 Updating Lambda function from S3..."
aws lambda update-function-code \
  --function-name create-clip \
  --s3-bucket $S3_BUCKET \
  --s3-key lambda-functions/create-clip.zip

echo "✅ Deployment complete!"
