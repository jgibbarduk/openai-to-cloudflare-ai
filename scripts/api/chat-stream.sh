#!/bin/bash
# Streaming chat completion request
# Usage: ./scripts/api/chat-stream.sh [model]

. "$(dirname "$0")/../helpers/common.sh"

MODEL="${1:-@cf/qwen/qwen3-30b-a3b-fp8}"

make_request_stream POST "/v1/chat/completions" $(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "user", "content": "Count from 1 to 5"}
  ],
  "stream": true,
  "max_tokens": 100
}
EOF
)
