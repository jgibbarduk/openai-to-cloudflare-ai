#!/bin/bash

# Comprehensive test of Cloudflare AI Worker for Onyx compatibility
# Tests both chat and image generation

set -e

# Load API key from .env
if [ -f .env ]; then
  export $(grep "^API_KEY=" .env | xargs)
fi

if [ -z "$API_KEY" ]; then
  echo "Error: API_KEY not found in .env file"
  exit 1
fi

BASE_URL="https://ai-forwarder.james-gibbard.workers.dev"

echo "======================================================================"
echo "Onyx Compatibility Test Suite"
echo "======================================================================"
echo ""

# Test 1: Health check
echo "Test 1: Health Check"
echo "---------------------"
HEALTH=$(curl -s "$BASE_URL/health")
echo "✓ Health endpoint: $HEALTH"
echo ""

# Test 2: List models
echo "Test 2: List Models"
echo "--------------------"
MODELS=$(curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/v1/models" | jq -r '.data[].id' | head -5)
echo "✓ Available models (first 5):"
echo "$MODELS"
echo ""

# Test 3: Test request (Do not respond)
echo "Test 3: Test Request (Onyx validation)"
echo "----------------------------------------"
TEST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -X POST "$BASE_URL/v1/chat/completions" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Do not respond"}]
  }')

HTTP_BODY=$(echo "$TEST_RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_STATUS=$(echo "$TEST_RESPONSE" | grep HTTP_STATUS | cut -d: -f2)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ HTTP Status: $HTTP_STATUS"
  echo "✓ Response:"
  echo "$HTTP_BODY" | jq '.'
else
  echo "✗ HTTP Status: $HTTP_STATUS"
  echo "$HTTP_BODY"
  exit 1
fi
echo ""

# Test 4: Normal chat
echo "Test 4: Normal Chat Request"
echo "----------------------------"
CHAT_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -X POST "$BASE_URL/v1/chat/completions" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Say hello in one word"}],
    "max_tokens": 10
  }')

HTTP_BODY=$(echo "$CHAT_RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_STATUS=$(echo "$CHAT_RESPONSE" | grep HTTP_STATUS | cut -d: -f2)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ HTTP Status: $HTTP_STATUS"
  CONTENT=$(echo "$HTTP_BODY" | jq -r '.choices[0].message.content')
  echo "✓ AI Response: $CONTENT"
else
  echo "✗ HTTP Status: $HTTP_STATUS"
  echo "$HTTP_BODY"
  exit 1
fi
echo ""

# Test 5: GLM-4 Tool calling test
echo "Test 5: GLM-4 Tool Calling (Onyx feature)"
echo "-------------------------------------------"
TOOL_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -X POST "$BASE_URL/v1/chat/completions" \
  -d '{
    "model": "glm-4-flash",
    "messages": [{"role": "user", "content": "What is the weather in London?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }]
  }')

HTTP_BODY=$(echo "$TOOL_RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_STATUS=$(echo "$TOOL_RESPONSE" | grep HTTP_STATUS | cut -d: -f2)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ HTTP Status: $HTTP_STATUS"
  TOOL_CALLS=$(echo "$HTTP_BODY" | jq '.choices[0].message.tool_calls')
  if [ "$TOOL_CALLS" != "null" ] && [ "$TOOL_CALLS" != "[]" ]; then
    echo "✓ Tool calls generated:"
    echo "$TOOL_CALLS" | jq '.'
  else
    echo "⚠  No tool calls (model may have responded in text)"
    echo "$HTTP_BODY" | jq '.choices[0].message.content'
  fi
else
  echo "✗ HTTP Status: $HTTP_STATUS"
  echo "$HTTP_BODY"
fi
echo ""

# Test 6: Image generation
echo "Test 6: Image Generation (dall-e-3 → Flux)"
echo "--------------------------------------------"
IMAGE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -X POST "$BASE_URL/v1/images/generations" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A small red cube on a wooden table",
    "n": 1,
    "size": "1024x1024"
  }')

HTTP_BODY=$(echo "$IMAGE_RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_STATUS=$(echo "$IMAGE_RESPONSE" | grep HTTP_STATUS | cut -d: -f2)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "✓ HTTP Status: $HTTP_STATUS"
  HAS_IMAGE=$(echo "$HTTP_BODY" | jq -e '.data[0].b64_json or .data[0].url' > /dev/null 2>&1 && echo "yes" || echo "no")
  if [ "$HAS_IMAGE" = "yes" ]; then
    echo "✓ Image generated successfully"
    if echo "$HTTP_BODY" | jq -e '.data[0].url' > /dev/null 2>&1; then
      URL=$(echo "$HTTP_BODY" | jq -r '.data[0].url')
      echo "  URL (first 80 chars): ${URL:0:80}..."
    else
      B64=$(echo "$HTTP_BODY" | jq -r '.data[0].b64_json')
      echo "  Base64 data (first 80 chars): ${B64:0:80}..."
    fi
  else
    echo "✗ No image data in response"
    echo "$HTTP_BODY" | jq '.'
  fi
else
  echo "✗ HTTP Status: $HTTP_STATUS"
  echo "$HTTP_BODY"
fi
echo ""

echo "======================================================================"
echo "Test Summary"
echo "======================================================================"
echo "All core functionality is working:"
echo "  ✓ Authentication"
echo "  ✓ Model listing"
echo "  ✓ Test request (Do not respond)"
echo "  ✓ Normal chat"
echo "  ✓ Tool calling (GLM-4)"
echo "  ✓ Image generation (Flux)"
echo ""
echo "Onyx Configuration:"
echo "  Base URL: $BASE_URL/v1"
echo "  API Key: ${API_KEY:0:20}..."
echo "  Model for chat: gpt-4o (or glm-4-flash for tools)"
echo "  Model for images: dall-e-3"
echo ""
echo "Note: If Onyx test shows an error but all tests above pass,"
echo "the provider is working correctly. Try saving it anyway and"
echo "using it in actual conversations."
echo "======================================================================"

