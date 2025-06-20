#!/bin/bash

# Exit on error
set -e

echo "Starting deployment process for Asura AI extension..."

# Step 1: Install dependencies
echo "Installing dependencies..."
npm install

# Step 2: Run linting
echo "Running linting checks..."
npm run lint

# Step 3: Compile the extension
echo "Compiling the extension..."
npm run compile

# Step 4: Package the extension
echo "Packaging the extension into a VSIX file..."
npx vsce package

# Check if packaging was successful
if [ $? -eq 0 ]; then
    echo "✅ Extension packaged successfully!"
    
    # Find the generated VSIX file
    VSIX_FILE=$(find . -maxdepth 1 -name "*.vsix" | sort -V | tail -n 1)
    
    if [ -n "$VSIX_FILE" ]; then
        echo "Generated VSIX file: $VSIX_FILE"
        
        echo ""
        echo "Deployment options:"
        echo "-------------------"
        echo "1. To install the extension locally for testing:"
        echo "   code --install-extension $VSIX_FILE"
        echo ""
        echo "2. To publish to the VS Code Marketplace:"
        echo "   npx vsce publish"
        echo "   (Note: You need to be logged in with 'vsce login' and have the appropriate permissions)"
        echo ""
        echo "3. To publish to an Open VSX Registry:"
        echo "   npx ovsx publish $VSIX_FILE"
        echo "   (Note: You need to set the OVSX_PAT environment variable with your Open VSX token)"
    else
        echo "❌ Could not find the generated VSIX file."
    fi
else
    echo "❌ Failed to package the extension."
    exit 1
fi
