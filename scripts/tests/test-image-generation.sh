#!/bin/bash

# ============================================================================
# Comprehensive Image Generation Test Suite
# ============================================================================
# Tests various image generation scenarios with Flux model
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../helpers/common.sh"

API_URL="${WORKER_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ -z "$API_KEY" ]; then
  echo -e "${RED}❌ Error: API_KEY environment variable not set${NC}"
  echo "Usage: API_KEY=sk-... ./test-image-generation.sh"
  exit 1
fi

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# ============================================================================
# Helper function to run a test
# ============================================================================
run_test() {
  local test_name="$1"
  local model="$2"
  local prompt="$3"
  local response_format="$4"
  local expected_status="$5"

  echo ""
  echo -e "${BLUE}▶ Test: $test_name${NC}"
  echo "  Model: $model"
  echo "  Prompt: ${prompt:0:60}..."
  echo "  Format: $response_format"

  local payload=$(cat <<EOF
{
  "model": "$model",
  "prompt": "$prompt",
  "n": 1,
  "response_format": "$response_format"
}
EOF
)

  local response=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/v1/images/generations" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  if [ "$http_code" = "$expected_status" ]; then
    if echo "$body" | jq . >/dev/null 2>&1; then
      local model_returned=$(echo "$body" | jq -r '.model' 2>/dev/null)
      local image_count=$(echo "$body" | jq '.data | length' 2>/dev/null)
      echo -e "${GREEN}✅ PASSED${NC} (HTTP $http_code, Model: $model_returned, Images: $image_count)"
      ((TESTS_PASSED++))
      return 0
    else
      echo -e "${RED}❌ FAILED${NC} (Invalid JSON response)"
      ((TESTS_FAILED++))
      return 1
    fi
  else
    echo -e "${RED}❌ FAILED${NC} (Expected HTTP $expected_status, got $http_code)"
    echo "Response: $body"
    ((TESTS_FAILED++))
    return 1
  fi
}

# ============================================================================
# Test Cases
# ============================================================================
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Image Generation Test Suite${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo "API URL: $API_URL"
echo ""

# Test 1: Basic image generation with gpt-image-1
run_test \
  "Basic image generation (gpt-image-1)" \
  "gpt-image-1" \
  "A serene mountain landscape at sunrise" \
  "url" \
  "200"

# Test 2: Alternative alias dall-e-3
run_test \
  "Image generation with dall-e-3 alias" \
  "dall-e-3" \
  "A futuristic city with neon lights" \
  "url" \
  "200"

# Test 3: Base64 response format
run_test \
  "Image generation with b64_json format" \
  "gpt-image-1" \
  "A peaceful forest with sunlight filtering through trees" \
  "b64_json" \
  "200"

# Test 4: Longer prompt
run_test \
  "Image generation with detailed prompt" \
  "gpt-image-1" \
  "A portrait of a woman with flowing golden hair, wearing an elegant silk dress, standing in a sunlit garden with blooming roses and butterflies, cinematic lighting, detailed oil painting style" \
  "url" \
  "200"

# Test 5: Abstract concept
run_test \
  "Abstract concept image" \
  "gpt-image-1" \
  "The concept of artificial intelligence visualized as interconnected neural networks of light" \
  "url" \
  "200"

# Test 6: Missing prompt (should fail)
echo ""
echo -e "${BLUE}▶ Test: Missing prompt (should fail)${NC}"
local missing_prompt_response=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/v1/images/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-1"}')

local http_code=$(echo "$missing_prompt_response" | tail -n1)
if [ "$http_code" != "200" ]; then
  echo -e "${GREEN}✅ PASSED${NC} (Correctly rejected, HTTP $http_code)"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAILED${NC} (Should have rejected missing prompt)"
  ((TESTS_FAILED++))
fi

# Test 7: Missing model (should fail)
echo ""
echo -e "${BLUE}▶ Test: Missing model (should fail)${NC}"
local missing_model_response=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/v1/images/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A test image"}')

local http_code=$(echo "$missing_model_response" | tail -n1)
if [ "$http_code" != "200" ]; then
  echo -e "${GREEN}✅ PASSED${NC} (Correctly rejected, HTTP $http_code)"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAILED${NC} (Should have rejected missing model)"
  ((TESTS_FAILED++))
fi

# Test 8: Invalid model (should fail)
echo ""
echo -e "${BLUE}▶ Test: Invalid image model (should fail)${NC}"
local invalid_model_response=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/v1/images/generations" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"invalid-model","prompt":"A test image"}')

local http_code=$(echo "$invalid_model_response" | tail -n1)
if [ "$http_code" != "200" ]; then
  echo -e "${GREEN}✅ PASSED${NC} (Correctly rejected, HTTP $http_code)"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAILED${NC} (Should have rejected invalid model)"
  ((TESTS_FAILED++))
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Test Summary${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
