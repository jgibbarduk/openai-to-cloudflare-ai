#!/bin/bash

# Diagnostic script to help debug Onyx authentication issues
# This simulates what Onyx should be doing when calling your Cloudflare Worker

echo "======================================================================"
echo "Onyx → Cloudflare Workers AI Authentication Diagnostic"
echo "======================================================================"
echo ""

BASE_URL="https://ai-forwarder.james-gibbard.workers.dev"

# Check if API key is provided
if [ -z "$1" ]; then
  echo "❌ ERROR: No API key provided"
  echo ""
  echo "Usage: $0 <your-api-key>"
  echo ""
  echo "Example:"
  echo "  $0 sk-proj-your-full-key-here"
  echo ""
  exit 1
fi

API_KEY="$1"

echo "🔑 Testing with API key: ${API_KEY:0:15}..."
echo ""

# Test 1: Health check (no auth required)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1: Health Check (no auth required)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/health")
echo "Response: $HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | jq -e '.status == "ok"' > /dev/null 2>&1; then
  echo "✅ Health check passed"
else
  echo "❌ Health check failed"
fi
echo ""

# Test 2: Request without API key (should fail)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2: Chat Request WITHOUT API Key (should fail with 401)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
NO_AUTH_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"test"}]}')
echo "Response: $NO_AUTH_RESPONSE"
if echo "$NO_AUTH_RESPONSE" | jq -e '.error.code == 401' > /dev/null 2>&1; then
  echo "✅ Correctly rejected unauthenticated request"
else
  echo "⚠️  Expected 401 error, got something else"
fi
echo ""

# Test 3: Chat request with API key (should succeed)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3: Chat Request WITH API Key (should succeed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
CHAT_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 10
  }')

# Check if we got a successful response (has 'choices' array)
if echo "$CHAT_RESPONSE" | jq -e '.choices' > /dev/null 2>&1; then
  echo "✅ Chat request succeeded!"
  echo "Response:"
  echo "$CHAT_RESPONSE" | jq '.'
elif echo "$CHAT_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "❌ Chat request failed with error:"
  echo "$CHAT_RESPONSE" | jq '.'
else
  echo "⚠️  Unexpected response format:"
  echo "$CHAT_RESPONSE"
fi
echo ""

# Test 4: Image generation with API key (should succeed)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 4: Image Generation WITH API Key (should succeed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "This test may take 10-30 seconds..."
IMAGE_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A simple test image of a cat",
    "n": 1,
    "size": "1024x1024"
  }')

# Check if we got a successful response (has 'data' array)
if echo "$IMAGE_RESPONSE" | jq -e '.data' > /dev/null 2>&1; then
  echo "✅ Image generation succeeded!"
  IMAGE_COUNT=$(echo "$IMAGE_RESPONSE" | jq '.data | length')
  echo "Generated $IMAGE_COUNT image(s)"
  echo ""
  echo "Full response:"
  echo "$IMAGE_RESPONSE" | jq '.'
elif echo "$IMAGE_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "❌ Image generation failed with error:"
  echo "$IMAGE_RESPONSE" | jq '.'
else
  echo "⚠️  Unexpected response format:"
  echo "$IMAGE_RESPONSE"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "If all tests passed, your Cloudflare Worker is configured correctly!"
echo ""
echo "If Onyx still fails to authenticate:"
echo "1. Go to Onyx Admin → Configuration → Image Generation"
echo "2. Make sure the API Key field is filled with: ${API_KEY:0:15}..."
echo "3. Make sure the Base URL is: $BASE_URL/v1"
echo "4. Click 'Test' in the Onyx UI"
echo "5. Check Cloudflare logs: npx wrangler tail --format pretty"
echo ""
echo "Look for these log entries in Cloudflare:"
echo "  [Auth] Authorization header present: true"
echo "  [Auth] Provided key (first 8 chars): ${API_KEY:0:8}..."
echo "  [Auth] Authentication successful"
echo ""
echo "======================================================================"

