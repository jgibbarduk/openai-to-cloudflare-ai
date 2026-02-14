#!/bin/bash

# Test Responses API streaming with proper event types
# This should now work with litellm without validation errors

URL="${WORKER_URL:-https://ai-forwarder.james-gibbard.workers.dev}"

echo "Testing Responses API streaming..."
echo "Expected event types: response.output_item.added, response.output_text.delta, response.output_item.done"
echo ""

curl -N "${URL}/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "gpt-4o",
    "input": "Count from 1 to 5 slowly.",
    "stream": true
  }' 2>&1 | head -20

echo ""
echo "Test complete. Check for 'type' field in each event."

