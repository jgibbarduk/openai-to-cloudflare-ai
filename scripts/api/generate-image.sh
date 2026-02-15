#!/bin/bash

# ============================================================================
# Image Generation Test Script
# ============================================================================
# Tests the /v1/images/generations endpoint with the Flux model
# Maps gpt-image-1 to Cloudflare's Flux 2 Klein 9B model
# ============================================================================

set -e

# Source common helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../helpers/common.sh"

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"
MODEL="${1:-gpt-image-1}"
PROMPT="${2:-A beautiful sunset over mountains with golden light reflecting on a calm lake}"
IMAGE_SIZE="${3:-1024x1024}"
RESPONSE_FORMAT="${4:-url}"
OUTPUT_FILE="${5:-/tmp/generated_image.json}"

# Validate inputs
if [ -z "$API_KEY" ]; then
  echo "❌ Error: API_KEY environment variable not set"
  echo "Usage: API_KEY=sk-... ./generate-image.sh [model] [prompt] [size] [format] [output_file]"
  exit 1
fi

if [ -z "$PROMPT" ]; then
  echo "❌ Error: Prompt is required"
  exit 1
fi

echo "🎨 Image Generation Test"
echo "================================"
echo "📍 API URL: $API_URL"
echo "🤖 Model: $MODEL"
echo "💭 Prompt: $PROMPT"
echo "📏 Size: $IMAGE_SIZE"
echo "📋 Response Format: $RESPONSE_FORMAT"
echo "💾 Output File: $OUTPUT_FILE"
echo ""

# Create request payload
PAYLOAD=$(cat <<EOF
{
  "model": "$MODEL",
  "prompt": "$PROMPT",
  "n": 1,
  "size": "$IMAGE_SIZE",
  "quality": "standard",
  "response_format": "$RESPONSE_FORMAT"
}
EOF
)

echo "📤 Sending request..."
echo "Request payload:"
echo "$PAYLOAD" | jq . 2>/dev/null || echo "$PAYLOAD"
echo ""

# Make the API request
RESPONSE=$(curl -s -X POST "${API_URL}/v1/images/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# Save response
echo "$RESPONSE" > "$OUTPUT_FILE"

echo "📥 Response received"
echo "Saved to: $OUTPUT_FILE"
echo ""

# Parse and display response
if echo "$RESPONSE" | jq . >/dev/null 2>&1; then
  echo "✅ Valid JSON response"
  echo ""
  echo "Response details:"
  echo "$RESPONSE" | jq .
  echo ""

  # Extract image data info
  IMAGE_COUNT=$(echo "$RESPONSE" | jq '.data | length' 2>/dev/null || echo "0")
  MODEL_RETURNED=$(echo "$RESPONSE" | jq -r '.model' 2>/dev/null || echo "unknown")
  CREATED=$(echo "$RESPONSE" | jq '.created' 2>/dev/null || echo "unknown")

  echo "📊 Summary:"
  echo "  - Images generated: $IMAGE_COUNT"
  echo "  - Model returned: $MODEL_RETURNED"
  echo "  - Created timestamp: $CREATED"
  echo ""

  # If response format is URL, try to extract and display
  if [ "$RESPONSE_FORMAT" = "url" ]; then
    IMAGE_URL=$(echo "$RESPONSE" | jq -r '.data[0].url' 2>/dev/null || echo "")
    if [ -n "$IMAGE_URL" ] && [ "$IMAGE_URL" != "null" ]; then
      echo "🖼️  Image URL:"
      if [[ "$IMAGE_URL" == data:image* ]]; then
        echo "  (Data URL - base64 encoded image)"
        # Extract just the first 100 chars of the data URL
        echo "  ${IMAGE_URL:0:100}..."
      else
        echo "  $IMAGE_URL"
      fi
    fi
  elif [ "$RESPONSE_FORMAT" = "b64_json" ]; then
    B64_DATA=$(echo "$RESPONSE" | jq -r '.data[0].b64_json' 2>/dev/null | head -c 100)
    if [ -n "$B64_DATA" ]; then
      echo "🖼️  Image (base64, first 100 chars):"
      echo "  ${B64_DATA}..."
    fi
  fi

  echo ""
  echo "✅ Test completed successfully!"
else
  echo "❌ Invalid JSON response:"
  echo "$RESPONSE"
  exit 1
fi
