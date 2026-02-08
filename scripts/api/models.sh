#!/bin/bash
. .env

curl -X GET "${CLOUDFLARE_WORKER_URL}/v1/models" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" | jq
