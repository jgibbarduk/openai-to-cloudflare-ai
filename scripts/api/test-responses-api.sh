#!/bin/bash

# Test the /v1/responses endpoint to verify it returns the correct format

BASE_URL="http://localhost:8787"
API_KEY="${OPENAI_API_KEY:-test-key}"

echo "Testing /v1/responses endpoint..."
echo "=================================="

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "gpt-4o",
    "input": "Tell me a short story about a unicorn in exactly 50 words."
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo ""
echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response Body:"
echo "$BODY" | jq '.'

echo ""
echo "Validation Checks:"
echo "=================="

# Check if object is "response"
OBJECT=$(echo "$BODY" | jq -r '.object')
if [ "$OBJECT" = "response" ]; then
  echo "✅ object is 'response'"
else
  echo "❌ object is '$OBJECT' (expected 'response')"
fi

# Check if id starts with resp_
ID=$(echo "$BODY" | jq -r '.id')
if [[ "$ID" =~ ^resp_ ]]; then
  echo "✅ id starts with 'resp_'"
else
  echo "❌ id is '$ID' (expected to start with 'resp_')"
fi

# Check if status is present
STATUS=$(echo "$BODY" | jq -r '.status')
if [ "$STATUS" = "completed" ]; then
  echo "✅ status is 'completed'"
else
  echo "❌ status is '$STATUS' (expected 'completed')"
fi

# Check if output array exists
OUTPUT_EXISTS=$(echo "$BODY" | jq -r '.output | length')
if [ "$OUTPUT_EXISTS" -gt 0 ]; then
  echo "✅ output array exists with $OUTPUT_EXISTS items"
else
  echo "❌ output array is missing or empty"
fi

# Check if output[0] is a message
OUTPUT_TYPE=$(echo "$BODY" | jq -r '.output[0].type')
if [ "$OUTPUT_TYPE" = "message" ]; then
  echo "✅ output[0].type is 'message'"
else
  echo "❌ output[0].type is '$OUTPUT_TYPE' (expected 'message')"
fi

# Check if message has output_text content
CONTENT_TYPE=$(echo "$BODY" | jq -r '.output[0].content[0].type')
if [ "$CONTENT_TYPE" = "output_text" ]; then
  echo "✅ content[0].type is 'output_text'"
else
  echo "❌ content[0].type is '$CONTENT_TYPE' (expected 'output_text')"
fi

# Check if usage has proper nested structure
INPUT_TOKENS=$(echo "$BODY" | jq -r '.usage.input_tokens')
OUTPUT_TOKENS=$(echo "$BODY" | jq -r '.usage.output_tokens')
CACHED_TOKENS=$(echo "$BODY" | jq -r '.usage.input_tokens_details.cached_tokens')
REASONING_TOKENS=$(echo "$BODY" | jq -r '.usage.output_tokens_details.reasoning_tokens')

if [ "$INPUT_TOKENS" != "null" ] && [ "$OUTPUT_TOKENS" != "null" ]; then
  echo "✅ usage has input_tokens ($INPUT_TOKENS) and output_tokens ($OUTPUT_TOKENS)"
else
  echo "❌ usage is missing token counts"
fi

if [ "$CACHED_TOKENS" != "null" ] && [ "$REASONING_TOKENS" != "null" ]; then
  echo "✅ usage has nested token details"
else
  echo "❌ usage is missing nested token details"
fi

echo ""
echo "Full Response Structure:"
echo "======================="
echo "$BODY" | jq 'keys'

