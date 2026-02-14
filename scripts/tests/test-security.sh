#!/bin/bash

# ============================================================================
# Security Test Script
# ============================================================================
# Tests that the API correctly enforces authentication
# ============================================================================

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-https://ai-forwarder.james-gibbard.workers.dev}"
VALID_API_KEY="${API_KEY:-}" # Should be set in environment

# Helper function to run a test
run_test() {
  local test_name="$1"
  local auth_header="$2"
  local expected_status="$3"

  echo -n "Test: $test_name... "

  local response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    ${auth_header:+-H "$auth_header"} \
    -d '{
      "model": "gpt-3.5-turbo",
      "messages": [{"role": "user", "content": "Hello"}]
    }')

  if [ "$response" = "$expected_status" ]; then
    echo -e "${GREEN}PASSED${NC} (Got $response)"
    return 0
  else
    echo -e "${RED}FAILED${NC} (Expected $expected_status, got $response)"
    return 1
  fi
}

echo "🔒 API Security Test"
echo "====================="
echo "URL: $API_URL"

FAILED=0

# Test 1: No Authorization header
run_test "No Authorization header" "" "401" || ((FAILED++))

# Test 2: Invalid Authorization header (no Bearer)
run_test "Invalid format (no Bearer)" "Authorization: InvalidKey" "401" || ((FAILED++))

# Test 3: Invalid API Key
run_test "Invalid API Key" "Authorization: Bearer invalid-key-123" "401" || ((FAILED++))

# Test 4: Valid API Key (only if provided)
if [ -n "$VALID_API_KEY" ]; then
  run_test "Valid API Key" "Authorization: Bearer $VALID_API_KEY" "200" || ((FAILED++))
else
  echo -e "${YELLOW}Skipping Valid API Key test (API_KEY not set)${NC}"
fi

echo ""
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All security tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ $FAILED security tests failed!${NC}"
  exit 1
fi
