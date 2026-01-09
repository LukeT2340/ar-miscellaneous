# SageMaker Custom Docker Image with PaddleOCR

This directory contains the Dockerfile and build script to create a custom SageMaker training image with PaddleOCR support.

## Prerequisites

- Docker installed and running
- AWS CLI configured with credentials
- Permissions to create ECR repositories and push images

## Build and Push

1. Build and push the image to ECR:

   ```bash
   cd docker
   ./build-and-push.sh
   ```

2. The script will:
   - Build the Docker image with PyTorch, CUDA, cuDNN, and PaddleOCR
   - Create an ECR repository if needed
   - Push the image to: `478014850703.dkr.ecr.ap-southeast-2.amazonaws.com/sagemaker-paddleocr:latest`

## Image Contents

- **Base**: AWS Deep Learning Container (PyTorch 2.0.0 with GPU support)
- **CUDA/cuDNN**: Pre-configured for GPU operations
- **PaddleOCR**: Version 2.7.3 with PaddlePaddle GPU 2.6.0
- **Additional**: OpenCV, Pillow, Shapely for image processing

## Usage

The Lambda function in `functions/integrations/index.ts` has been updated to use this custom image for all training jobs.
