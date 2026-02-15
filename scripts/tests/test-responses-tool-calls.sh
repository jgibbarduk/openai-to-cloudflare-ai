#!/bin/bash

# Test Responses API with tool calls (streaming)

set -e

source "$(dirname "$0")/../helpers/common.sh"

echo "🧪 Testing Responses API with Tool Calls (Streaming)"
echo "=================================================="

# Test with a query that should trigger a tool call
curl -s "${API_URL}/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "OpenAI-Beta: responses=v1" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "What is the weather like in San Francisco?"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather for a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and state, e.g. San Francisco, CA"
              },
              "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"],
                "description": "The temperature unit to use"
              }
            },
            "required": ["location"]
          }
        }
      }
    ],
    "stream": true
  }' \
  --no-buffer

echo ""
echo "✅ Test completed"

