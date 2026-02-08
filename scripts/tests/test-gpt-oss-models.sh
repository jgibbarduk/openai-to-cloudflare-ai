#!/bin/bash
# Test working Cloudflare models
# Note: @cf/openai/gpt-oss models are not available in this Cloudflare account
. .env

: ${API_KEY:="sk-proj-c4nY8Ah0PT6OjIAYgG4gHpdyhCYrme0p4wFEViSkr0xQmljyjgxsmbdk8SjMCqhYaAd8y9dlm3Z1nwADH15JHIm3dhAO5fNLu0qDuvWKJGofriaEo3Rb9pOpqzIcFBbp5QA8Cpet34ptkIqxwcn8varl0Ans927cxzzyfDYsvKit72Q2Tfieky12WLdPkjrN7z0elG-mlt"}
: ${CLOUDFLARE_WORKER_URL:="https://ai-forwarder.james-gibbard.workers.dev"}

echo "⚠️  Note: @cf/openai/gpt-oss-20b and gpt-oss-120b are NOT available in this Cloudflare account"
echo "Testing alternatives that work..."
echo ""

echo "Testing Llama 3.3 70B (tool-capable)..."
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "messages": [
      {"role": "user", "content": "What is 3 * 10? Answer with just the number."}
    ],
    "max_tokens": 50
  }' | jq '.choices[0].message.content'

echo ""
echo "Testing Llama 3.2 3B (smaller, faster)..."
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3.2-3b-instruct",
    "messages": [
      {"role": "user", "content": "What is 5 + 7? Answer with just the number."}
    ],
    "max_tokens": 50
  }' | jq '.choices[0].message.content'

echo ""
echo "Testing Llama 3 8B (balanced)..."
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [
      {"role": "user", "content": "What is 2 + 2? Answer with just the number."}
    ],
    "max_tokens": 50
  }' | jq '.choices[0].message.content'

echo ""
echo "Testing gpt-4o-mini alias..."
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is 9 * 9? Answer with just the number."}
    ],
    "max_tokens": 50
  }' | jq '.choices[0].message.content'
