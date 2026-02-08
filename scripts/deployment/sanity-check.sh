#!/bin/bash
# Quick sanity check - tests all supported models with basic requests
# Usage: ./scripts/deployment/sanity-check.sh

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Load environment
if [[ -f ".env" ]]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

WORKER_URL="${CLOUDFLARE_WORKER_URL:-https://ai-forwarder.james-gibbard.workers.dev}"
API_KEY="${API_KEY:?Error: API_KEY not set}"

# Models to test
declare -a MODELS=(
  "@cf/qwen/qwen3-30b-a3b-fp8"
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  "@cf/openai/gpt-oss-20b"
)

PASSED=0
FAILED=0

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Quick Sanity Check - Testing Core Functionality${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Test health
echo -e "${YELLOW}[1/3]${NC} Testing health endpoint..."
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "${WORKER_URL}/health" \
  -H "Authorization: Bearer $API_KEY")

if [[ "$http_code" == "200" ]]; then
  echo -e "${GREEN}✓${NC} Health check passed\n"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗${NC} Health check failed (HTTP $http_code)\n"
  FAILED=$((FAILED + 1))
fi

# Test models endpoint
echo -e "${YELLOW}[2/3]${NC} Testing models endpoint..."
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "${WORKER_URL}/v1/models" \
  -H "Authorization: Bearer $API_KEY")

if [[ "$http_code" == "200" ]]; then
  echo -e "${GREEN}✓${NC} Models endpoint passed\n"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗${NC} Models endpoint failed (HTTP $http_code)\n"
  FAILED=$((FAILED + 1))
fi

# Test each model
echo -e "${YELLOW}[3/3]${NC} Testing chat completion for each model..."
for model in "${MODELS[@]}"; do
  echo -n "  Testing $model... "

  local payload=$(cat <<EOF
{
  "model": "$model",
  "messages": [{"role": "user", "content": "Hi"}],
  "max_tokens": 50
}
EOF
)

  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload")

  if [[ "$http_code" == "200" ]]; then
    echo -e "${GREEN}✓${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗${NC} (HTTP $http_code)"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

if [[ $FAILED -eq 0 ]]; then
  echo -e "\n${GREEN}✓ Sanity check PASSED${NC}\n"
  exit 0
else
  echo -e "\n${RED}✗ Sanity check FAILED${NC}\n"
  exit 1
fi
