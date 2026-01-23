#!/bin/bash
set -e

echo "📥 Downloading static ffmpeg binary for Lambda..."

# Create bin directory
mkdir -p bin

# Download static ffmpeg build for Lambda (Linux x86_64)
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz

# Extract
cd /tmp
tar xf ffmpeg.tar.xz
cd ffmpeg-*-static

# Copy only ffmpeg binary
cp ffmpeg /Users/luke.thompson/Sites/lambda-functions/functions/create-clip/bin/

# Cleanup
cd /tmp
rm -rf ffmpeg.tar.xz ffmpeg-*-static

cd /Users/luke.thompson/Sites/lambda-functions/functions/create-clip
chmod +x bin/ffmpeg

echo "✅ FFmpeg binary downloaded to bin/ffmpeg ($(du -h bin/ffmpeg | cut -f1))"
