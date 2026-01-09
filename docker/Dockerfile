# Use AWS Deep Learning Container as base (includes CUDA, cuDNN, PyTorch)
FROM 763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/pytorch-training:2.0.0-gpu-py310

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV LD_LIBRARY_PATH=/opt/conda/lib:$LD_LIBRARY_PATH

# Update and install system dependencies including ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install build tools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install PyTorch with CUDA 12.1 support first
RUN pip install --no-cache-dir \
    torch==2.5.1 \
    torchvision==0.20.1 \
    torchaudio==2.5.1 \
    --extra-index-url https://download.pytorch.org/whl/cu121

# Install cuDNN
RUN pip install --no-cache-dir nvidia-cudnn-cu12==9.1.0.70

# Install OpenCV packages
RUN pip install --no-cache-dir --ignore-installed --no-deps \
    opencv-python-headless==4.6.0.66 \
    opencv-contrib-python==4.6.0.66

# Install PaddlePaddle GPU and PaddleOCR
RUN pip install --no-cache-dir \
    paddlepaddle-gpu==2.6.2 \
    -f https://www.paddlepaddle.org.cn/whl/linux/mkl/avx/stable.html && \
    pip install --no-cache-dir paddleocr==2.7.3

# Install numerical computing and ML packages
RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    pandas>=2.3.0 \
    matplotlib>=3.10.0 \
    seaborn>=0.13.0 \
    ultralytics>=8.3.0

# Install video processing and utilities
RUN pip install --no-cache-dir \
    moviepy>=2.1.1 \
    tqdm>=4.66.0 \
    PyYAML>=6.0 \
    Pillow \
    shapely

# Install AWS and database packages
RUN pip install --no-cache-dir \
    boto3>=1.34.0 \
    psycopg2-binary>=2.9.0

# Install development tools
RUN pip install --no-cache-dir \
    pytest>=7.0.0 \
    black>=23.0.0

# Note: Verification skipped during build - packages will be verified at runtime in SageMaker

# Set working directory
WORKDIR /opt/ml/code

# SageMaker expects the training script to be in /opt/ml/code
ENV SAGEMAKER_PROGRAM=main.py
