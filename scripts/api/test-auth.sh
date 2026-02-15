#!/bin/bash

# Test authentication with the worker
# This will help debug what's happening with the API key

BASE_URL="https://ai-forwarder.james-gibbard.workers.dev"

echo "=== Testing Authentication ==="
echo ""

echo "1. Testing without API key (should fail):"
curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }' | jq '.'

echo ""
echo "2. Testing with API key from environment (should succeed if API_KEY env var is set):"
if [ -z "$API_KEY" ]; then
  echo "ERROR: API_KEY environment variable not set"
  echo "Please run: export API_KEY='your-actual-key-here'"
else
  curl -s -X POST "$BASE_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{
      "model": "gpt-4",
      "messages": [{"role": "user", "content": "Hello"}],
      "max_tokens": 10
    }' | jq '.'
fi

echo ""
echo "3. Testing image generation with API key:"
if [ -z "$API_KEY" ]; then
  echo "ERROR: API_KEY environment variable not set"
else
  curl -s -X POST "$BASE_URL/v1/images/generations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{
      "model": "dall-e-3",
      "prompt": "A cute cat",
      "n": 1,
      "size": "1024x1024"
    }' | jq '.'
fi

echo ""
echo "=== Test Complete ==="
echo "Check the logs in Cloudflare dashboard to see detailed authentication debugging"

