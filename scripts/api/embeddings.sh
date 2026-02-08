#!/bin/bash
. .env

: ${API_KEY:="your_cloudflare_worker_api_key"}
: ${CLOUDFLARE_WORKER_URL:="your_worker_url"}
: ${EMBEDDING_MODEL:="@cf/baai/bge-base-en-v1.5"} # Example embedding model
: ${TEXT_MODEL:="@cf/meta/llama-2-7b-chat-int8"}  # Example text model

echo "TEST 1: Valid embedding request (single text)"
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/embeddings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "The food was delicious and the waiter...",
    "model": "'"$EMBEDDING_MODEL"'",
    "encoding_format": "float"
  }' | jq

echo -e "\nTEST 2: Valid batch request (multiple texts)"
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/embeddings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": ["Cloudflare Workers AI", "Language models are amazing"],
    "model": "'"$EMBEDDING_MODEL"'"
  }' | jq

echo -e "\nTEST 3: Base64 encoding test"
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/embeddings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Convert this to base64",
    "model": "'"$EMBEDDING_MODEL"'",
    "encoding_format": "base64"
  }' | jq

echo -e "\nTEST 4: Invalid model test"
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/embeddings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "This should fail",
    "model": "'"$TEXT_MODEL"'"
  }' | jq

echo -e "\nTEST 5: Missing required fields"
curl -s -X POST "${CLOUDFLARE_WORKER_URL}/embeddings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
