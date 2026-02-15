#!/bin/bash
# Test tool calling with Llama 3.3 70B (tool-capable model)
. .env

: ${API_KEY:=""}
: ${CLOUDFLARE_WORKER_URL:=""}

echo "Testing Llama 3.3 70B with tool calling..."
echo "Note: gpt-oss-20b model not available in Cloudflare Workers AI"
echo ""

curl -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "messages": [
      {"role": "user", "content": "What is the weather like in Tokyo today? If you have a get_weather function, call it."}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather in a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city name"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "description": "Temperature unit"
            }
          },
          "required": ["location"]
        }
      }
    }],
    "max_tokens": 200
  }' | jq .
