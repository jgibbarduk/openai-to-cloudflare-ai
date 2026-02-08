#!/bin/bash
# Tool calling / function calling request
# Usage: ./scripts/api/tool-call.sh [model]

. "$(dirname "$0")/../helpers/common.sh"

MODEL="${1:-@cf/qwen/qwen3-30b-a3b-fp8}"

make_request POST "/v1/chat/completions" $(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "user", "content": "Search for information about Cloudflare Workers AI"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "Search the web for information",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Search query"
            }
          },
          "required": ["query"]
        }
      }
    }
  ],
  "max_tokens": 150
}
EOF
)
