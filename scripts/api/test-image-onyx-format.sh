#!/bin/bash

# Test image generation with Onyx-style request format
# This simulates what Onyx sends when testing image generation

if [ -z "$1" ]; then
  echo "Usage: $0 <api-key>"
  echo "Example: $0 sk-proj-your-key-here"
  exit 1
fi

API_KEY="$1"
BASE_URL="https://ai-forwarder.james-gibbard.workers.dev"

echo "Testing Image Generation with Onyx-compatible format..."
echo ""

# Test with dall-e-3 model (should map to Flux)
echo "Request:"
echo "POST $BASE_URL/v1/images/generations"
echo "Model: dall-e-3"
echo "Prompt: A simple test image"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$BASE_URL/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A cute cartoon cat sitting on a cloud",
    "n": 1,
    "size": "1024x1024",
    "response_format": "url"
  }')

# Split response and status
HTTP_BODY=$(echo "$RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_STATUS=$(echo "$RESPONSE" | grep HTTP_STATUS | cut -d: -f2)

echo "HTTP Status: $HTTP_STATUS"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Success! Response:"
  echo "$HTTP_BODY" | jq '.'

  # Check if we got image data
  if echo "$HTTP_BODY" | jq -e '.data[0].url or .data[0].b64_json' > /dev/null 2>&1; then
    echo ""
    echo "✅ Image data received successfully!"

    # Show URL or b64 info
    if echo "$HTTP_BODY" | jq -e '.data[0].url' > /dev/null 2>&1; then
      URL=$(echo "$HTTP_BODY" | jq -r '.data[0].url')
      echo "Image URL (first 100 chars): ${URL:0:100}..."
    elif echo "$HTTP_BODY" | jq -e '.data[0].b64_json' > /dev/null 2>&1; then
      B64=$(echo "$HTTP_BODY" | jq -r '.data[0].b64_json')
      echo "Base64 image data (first 100 chars): ${B64:0:100}..."
    fi
  else
    echo "⚠️  Warning: No image data found in response"
  fi
else
  echo "❌ Error! Status: $HTTP_STATUS"
  echo "Response:"
  echo "$HTTP_BODY" | jq '.'
fi

echo ""
echo "======================================================================"
echo "If this test passed, image generation should work in Onyx!"
echo "Configure in Onyx Admin → Image Generation:"
echo "  - Base URL: $BASE_URL/v1"
echo "  - API Key: ${API_KEY:0:15}..."
echo "  - Model: dall-e-3"
echo "======================================================================"

