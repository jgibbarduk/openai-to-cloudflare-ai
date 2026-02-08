#!/bin/bash
# Simple chat completion request
# Usage: ./scripts/api/chat-complete.sh [model]

. "$(dirname "$0")/../helpers/common.sh"

MODEL="${1:-@cf/qwen/qwen3-30b-a3b-fp8}"

make_request POST "/v1/chat/completions" $(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is 2 + 2?"}
  ],
  "max_tokens": 100
}
EOF
)
