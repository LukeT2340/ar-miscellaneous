#!/bin/bash
set -e

echo "📦 Packaging Lambda function..."

# Create a clean package directory
rm -rf package
mkdir -p package

# Copy the built function
cp dist/index.js package/
cp dist/index.js.map package/

# Copy ffmpeg binary if it exists
if [ -d "bin" ]; then
  echo "📹 Including ffmpeg binary..."
  cp -r bin package/
fi

# Copy Prisma schema and generate client in package directory
mkdir -p package/prisma
cp prisma/schema.prisma package/prisma/

# Create a temporary package.json for production dependencies
cat > package/package.json << EOF
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.958.0",
    "@prisma/client": "^6.2.0"
  }
}
EOF

# Install production dependencies
echo "📥 Installing production dependencies..."
cd package
npm install --production --no-package-lock

# Generate Prisma Client
echo "🔨 Generating Prisma Client..."
npx prisma generate

# Remove package.json and unnecessary files
rm package.json
rm -rf prisma

cd ..

# Create the zip file
echo "🗜️  Creating zip file..."
cd package
zip -r ../function.zip . > /dev/null
cd ..

# Show the size
echo "✅ Package created: function.zip ($(du -h function.zip | cut -f1))"

# Cleanup
rm -rf package

echo "🎉 Ready to deploy!"
