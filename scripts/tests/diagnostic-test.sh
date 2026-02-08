#!/bin/bash

# Comprehensive API diagnostic test suite
# This script tests various aspects of the API to identify issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Source environment if available
if [ -f .env ]; then
  source .env
fi

# Configuration
API_KEY="${API_KEY:=sk-proj-test}"
WORKER_URL="${CLOUDFLARE_WORKER_URL:=https://ai-forwarder.james-gibbard.workers.dev}"

echo -e "${BLUE}=== OpenAI Proxy API Diagnostic Test Suite ===${NC}\n"

# Test 1: Health Endpoint
echo -e "${YELLOW}[1] Testing Health Endpoint...${NC}"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${WORKER_URL}/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
BODY=$(echo "$HEALTH_RESPONSE" | head -1)

if [ "$HTTP_CODE" == "200" ]; then
  echo -e "${GREEN}✓ Health endpoint working${NC}"
  echo "Response: $BODY" | jq .
else
  echo -e "${RED}✗ Health endpoint failed (HTTP $HTTP_CODE)${NC}"
  echo "$BODY"
fi

echo ""

# Test 2: Models Endpoint
echo -e "${YELLOW}[2] Testing Models Endpoint...${NC}"
MODELS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${WORKER_URL}/v1/models" \
  -H "Authorization: Bearer ${API_KEY}")
HTTP_CODE=$(echo "$MODELS_RESPONSE" | tail -1)
BODY=$(echo "$MODELS_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
  echo -e "${GREEN}✓ Models endpoint working${NC}"
  MODEL_COUNT=$(echo "$BODY" | jq '.data | length' 2>/dev/null || echo "unknown")
  echo "Available models: $MODEL_COUNT"
  echo "$BODY" | jq '.data[0:2]'
else
  echo -e "${RED}✗ Models endpoint failed (HTTP $HTTP_CODE)${NC}"
  echo "$BODY"
fi

echo ""

# Test 3: Simple Chat Completion (No Tools)
echo -e "${YELLOW}[3] Testing Simple Chat Completion...${NC}"
CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ],
    "max_tokens": 100
  }')
HTTP_CODE=$(echo "$CHAT_RESPONSE" | tail -1)
BODY=$(echo "$CHAT_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
  CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content' 2>/dev/null || echo "ERROR")
  if [ "$CONTENT" != " " ] && [ "$CONTENT" != "ERROR" ]; then
    echo -e "${GREEN}✓ Chat completion working${NC}"
    echo "Response: $CONTENT"
  else
    echo -e "${RED}✗ Chat completion returned empty content${NC}"
    echo "Full response:"
    echo "$BODY" | jq .
  fi
else
  echo -e "${RED}✗ Chat completion failed (HTTP $HTTP_CODE)${NC}"
  echo "$BODY"
fi

echo ""

# Test 4: Chat with Explicit Model Name
echo -e "${YELLOW}[4] Testing with Explicit Cloudflare Model Name...${NC}"
CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "max_tokens": 100
  }')
HTTP_CODE=$(echo "$CHAT_RESPONSE" | tail -1)
BODY=$(echo "$CHAT_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
  CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content' 2>/dev/null || echo "ERROR")
  if [ "$CONTENT" != " " ] && [ "$CONTENT" != "ERROR" ]; then
    echo -e "${GREEN}✓ Cloudflare model working${NC}"
    echo "Response: ${CONTENT:0:100}..."
  else
    echo -e "${RED}✗ Cloudflare model returned empty content${NC}"
    echo "Full response:"
    echo "$BODY" | jq .
  fi
else
  echo -e "${RED}✗ Cloudflare model test failed (HTTP $HTTP_CODE)${NC}"
  echo "$BODY"
fi

echo ""

# Test 5: Streaming Test
echo -e "${YELLOW}[5] Testing Streaming Response...${NC}"
echo -n "Starting stream... "
STREAM_TEST=$(curl -s -N -X POST "${WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [
      {"role": "user", "content": "Count to 3"}
    ],
    "stream": true,
    "max_tokens": 50
  }' | head -20)

if echo "$STREAM_TEST" | grep -q "data:"; then
  echo -e "${GREEN}✓${NC}"
  echo "Sample stream chunks:"
  echo "$STREAM_TEST" | head -5
else
  echo -e "${RED}✗ No stream data received${NC}"
fi

echo ""

# Test 6: Tool Calling Test
echo -e "${YELLOW}[6] Testing Tool Calling (on capable model)...${NC}"
TOOL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "messages": [
      {"role": "user", "content": "Get the weather in Tokyo"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }],
    "max_tokens": 100
  }')
HTTP_CODE=$(echo "$TOOL_RESPONSE" | tail -1)
BODY=$(echo "$TOOL_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
  echo -e "${GREEN}✓ Tool calling request accepted${NC}"
  TOOL_CALLS=$(echo "$BODY" | jq '.choices[0].message | select(.tool_calls != null)' 2>/dev/null)
  if [ -n "$TOOL_CALLS" ]; then
    echo "Tool calls made:"
    echo "$BODY" | jq '.choices[0].message.tool_calls'
  else
    CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content' 2>/dev/null)
    echo "Response (no tool calls): ${CONTENT:0:100}..."
  fi
else
  echo -e "${RED}✗ Tool calling failed (HTTP $HTTP_CODE)${NC}"
  echo "$BODY"
fi

echo ""

# Test 7: Error Handling - Invalid Model
echo -e "${YELLOW}[7] Testing Error Handling (Invalid Model)...${NC}"
ERROR_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/invalid/nonexistent-model",
    "messages": [
      {"role": "user", "content": "test"}
    ]
  }')
HTTP_CODE=$(echo "$ERROR_RESPONSE" | tail -1)
BODY=$(echo "$ERROR_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${GREEN}✓ Error handling working${NC}"
  ERROR_MSG=$(echo "$BODY" | jq '.error.message' 2>/dev/null || echo "Unknown")
  echo "Error message: $ERROR_MSG"
else
  echo -e "${YELLOW}⚠ Invalid model was accepted (should probably fail)${NC}"
fi

echo ""

# Test 8: Message Validation
echo -e "${YELLOW}[8] Testing Message Validation...${NC}"
VALIDATION_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [
      {"role": "user", "content": null}
    ]
  }')
HTTP_CODE=$(echo "$VALIDATION_RESPONSE" | tail -1)
BODY=$(echo "$VALIDATION_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" == "200" ]; then
  CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content' 2>/dev/null)
  if [ -n "$CONTENT" ]; then
    echo -e "${GREEN}✓ Null content handling working (converted to: '$CONTENT')${NC}"
  else
    echo -e "${YELLOW}⚠ Null content accepted but resulted in empty response${NC}"
  fi
else
  echo -e "${RED}✗ Null content handling failed${NC}"
fi

echo ""
echo -e "${BLUE}=== Diagnostic Test Complete ===${NC}\n"
echo -e "${YELLOW}Summary:${NC}"
echo "- Check if responses contain actual content (not just spaces)"
echo "- If all empty, the underlying Cloudflare AI may not be responding"
echo "- Check wrangler logs: wrangler tail --format pretty"
echo "- Verify API_KEY is correct and has Cloudflare AI access"
