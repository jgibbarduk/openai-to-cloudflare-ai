#!/bin/bash
# Test tool calling with GLM-4.7-Flash model
. .env

: ${API_KEY:="sk-proj-c4nY8Ah0PT6OjIAYgG4gHpdyhCYrme0p4wFEViSkr0xQmljyjgxsmbdk8SjMCqhYaAd8y9dlm3Z1nwADH15JHIm3dhAO5fNLu0qDuvWKJGofriaEo3Rb9pOpqzIcFBbp5QA8Cpet34ptkIqxwcn8varl0Ans927cxzzyfDYsvKit72Q2Tfieky12WLdPkjrN7z0elG-mlt"}
: ${CLOUDFLARE_WORKER_URL:="https://ai-forwarder.james-gibbard.workers.dev"}

echo "Testing GLM-4.7-Flash with tool calling..."
echo ""

curl -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/zai-org/glm-4.7-flash",
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

