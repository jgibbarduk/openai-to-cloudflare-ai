#!/bin/bash
# Test Llama 3.3 70B with tool calling
. .env

: ${API_KEY:="sk-proj-c4nY8Ah0PT6OjIAYgG4gHpdyhCYrme0p4wFEViSkr0xQmljyjgxsmbdk8SjMCqhYaAd8y9dlm3Z1nwADH15JHIm3dhAO5fNLu0qDuvWKJGofriaEo3Rb9pOpqzIcFBbp5QA8Cpet34ptkIqxwcn8varl0Ans927cxzzyfDYsvKit72Q2Tfieky12WLdPkjrN7z0elG-mlt"}
: ${CLOUDFLARE_WORKER_URL:="https://ai-forwarder.james-gibbard.workers.dev"}

echo "Testing Llama 3.3 70B with tool calling..."
curl -X POST "${CLOUDFLARE_WORKER_URL}/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "messages": [
      {"role": "user", "content": "What is the weather in London?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "internal_search",
        "description": "Search for information",
        "parameters": {
          "type": "object",
          "properties": {
            "queries": {
              "type": "array",
              "items": {"type": "string"},
              "description": "Search queries"
            }
          },
          "required": ["queries"]
        }
      }
    }]
  }' | jq .
