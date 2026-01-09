#!/bin/bash

# Configuration
AWS_ACCOUNT_ID="478014850703"
AWS_REGION="ap-southeast-2"
AWS_PROFILE="developer-engineer-515422922164"  # Set your AWS SSO profile
ECR_REPOSITORY="sagemaker-paddleocr"
IMAGE_TAG="latest"

# Export profile for AWS CLI commands
export AWS_PROFILE="${AWS_PROFILE}"

# Full image name
IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "Building Docker image for SageMaker with PaddleOCR..."

# Navigate to docker directory
cd "$(dirname "$0")"

# Login to AWS ECR first (needed to pull base image)
echo "Logging into AWS ECR to pull base image..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin 763104351884.dkr.ecr.${AWS_REGION}.amazonaws.com

if [ $? -ne 0 ]; then
    echo "❌ ECR login failed for base image"
    exit 1
fi

# Build the Docker image
echo "Building image: ${IMAGE_URI}"
docker build --platform linux/amd64 -t ${ECR_REPOSITORY}:${IMAGE_TAG} .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "✅ Docker build successful"

# Tag the image
docker tag ${ECR_REPOSITORY}:${IMAGE_TAG} ${IMAGE_URI}

# Login to ECR
echo "Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

if [ $? -ne 0 ]; then
    echo "❌ ECR login failed"
    exit 1
fi

# Create ECR repository if it doesn't exist
echo "Creating ECR repository if it doesn't exist..."
aws ecr describe-repositories --repository-names ${ECR_REPOSITORY} --region ${AWS_REGION} 2>/dev/null || \
    aws ecr create-repository --repository-name ${ECR_REPOSITORY} --region ${AWS_REGION}

# Push the image
echo "Pushing image to ECR: ${IMAGE_URI}"
docker push ${IMAGE_URI}

if [ $? -ne 0 ]; then
    echo "❌ Docker push failed"
    exit 1
fi

echo "✅ Successfully pushed image to ECR"
echo ""
echo "Image URI: ${IMAGE_URI}"
echo ""
echo "Update your Lambda function to use this image URI"
