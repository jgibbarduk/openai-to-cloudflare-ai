#!/bin/bash
# Test Responses API streaming with reasoning model

# Load API key
source "$(dirname "$0")/../helpers/common.sh"

echo "Testing Responses API Streaming with gpt-4o (Qwen)"
echo "================================================"
echo ""

curl -N https://ai-forwarder.james-gibbard.workers.dev/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "gpt-4o",
    "input": "What is 2+2? Think step by step.",
    "stream": true,
    "temperature": 0
  }' | while IFS= read -r line; do
    echo "$line"
  done

echo ""
echo "Test completed"

