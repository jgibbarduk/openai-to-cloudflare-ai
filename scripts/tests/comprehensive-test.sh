#!/bin/bash

# Comprehensive API Test Suite for Onyx-Compatible OpenAI Proxy
# Tests all working functionality
#
# Usage:
#   # Test against local dev server (no auth required)
#   ./scripts/tests/comprehensive-test.sh
#
#   # Test against production
#   WORKER_URL=https://your-worker.workers.dev API_KEY=your-key ./scripts/tests/comprehensive-test.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
# Default to localhost for local testing (no auth required in dev)
WORKER_URL="${WORKER_URL:=http://localhost:8787}"
# API_KEY is optional - if not set, will test without auth (works for localhost)
API_KEY="${API_KEY:=}"

PASS=0
FAIL=0

test_endpoint() {
  local name=$1
  local method=$2
  local endpoint=$3
  local data=$4
  local expected_code=$5

  echo -ne "${YELLOW}Testing $name...${NC} "

  # Build curl command with optional API key
  local curl_cmd="curl -s -w \"\n%{http_code}\" -X \"$method\" \"$WORKER_URL$endpoint\""
  curl_cmd="$curl_cmd -H \"Content-Type: application/json\""

  # Only add Authorization header if API_KEY is set
  if [ -n "$API_KEY" ]; then
    curl_cmd="$curl_cmd -H \"Authorization: Bearer $API_KEY\""
  fi

  if [ -n "$data" ]; then
    curl_cmd="$curl_cmd -d '$data'"
  fi

  local response=$(eval "$curl_cmd")
  local http_code=$(echo "$response" | tail -1)
  # Use sed instead of head -n -1 for macOS compatibility
  local body=$(echo "$response" | sed '$d')

  if [ "$http_code" == "$expected_code" ]; then
    echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
    PASS=$((PASS + 1))
    echo "$body" | head -200
  else
    echo -e "${RED}✗ FAIL${NC} (HTTP $http_code, expected $expected_code)"
    FAIL=$((FAIL + 1))
    echo "$body" | head -200
  fi
  echo ""
}

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Onyx-Compatible OpenAI Proxy Test Suite                ║${NC}"
echo -e "${BLUE}║     Cloudflare Workers AI Backend                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}\n"

# Test 1: Health Endpoint (No Auth)
echo -e "${YELLOW}=== Health & Status ===${NC}"
echo -ne "Testing health endpoint... "
HEALTH=$(curl -s "$WORKER_URL/health")
if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗ FAIL${NC}"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 2: Models Endpoint
echo -e "${YELLOW}=== Model Management ===${NC}"
test_endpoint "List models" "GET" "/v1/models" "" "200"

# Test 3: Simple Chat Completions
echo -e "${YELLOW}=== Chat Completions (Basic) ===${NC}"

test_endpoint "Chat with gpt-4o-mini" "POST" "/v1/chat/completions" \
  '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 50
  }' "200"

test_endpoint "Chat with llama-3-8b" "POST" "/v1/chat/completions" \
  '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [{"role": "user", "content": "Say hi"}],
    "max_tokens": 50
  }' "200"

test_endpoint "Chat with gpt-4 alias" "POST" "/v1/chat/completions" \
  '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 50
  }' "200"

# Test 4: Message Validation
echo -e "${YELLOW}=== Message Validation ===${NC}"

test_endpoint "Message with null content" "POST" "/v1/chat/completions" \
  '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": null}],
    "max_tokens": 50
  }' "200"

test_endpoint "Message with developer role" "POST" "/v1/chat/completions" \
  '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "developer", "content": "You are helpful"}],
    "max_tokens": 50
  }' "200"

# Test 5: Streaming
echo -e "${YELLOW}=== Streaming ===${NC}"

echo -ne "Testing streaming response... "
STREAM=$(curl -s -N -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Count to 3"}],
    "stream": true,
    "max_tokens": 50
  }' | head -5)

if echo "$STREAM" | grep -q "data:"; then
  echo -e "${GREEN}✓ PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗ FAIL${NC}"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 6: Tool Calling (Capable Model)
echo -e "${YELLOW}=== Tool Calling ===${NC}"

test_endpoint "Tool calling with llama-3.3-70b" "POST" "/v1/chat/completions" \
  '{
    "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "messages": [{"role": "user", "content": "Get weather in Tokyo"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather",
        "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}
      }
    }],
    "max_tokens": 100
  }' "200"

# Test 7: Tool Stripping (Non-Capable Model)
echo -e "${YELLOW}=== Tool Compatibility ===${NC}"

echo -ne "Tool stripping on non-capable model... "
RESPONSE=$(curl -s -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [{"role": "user", "content": "Hello"}],
    "tools": [{"type": "function", "function": {"name": "test", "description": "test", "parameters": {}}}],
    "max_tokens": 50
  }')

if echo "$RESPONSE" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ PASS${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗ FAIL${NC}"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 8: Error Handling
echo -e "${YELLOW}=== Error Handling ===${NC}"

# Skip auth test in dev mode (no API_KEY configured)
if [ -n "$API_KEY" ]; then
  test_endpoint "Missing API key" "POST" "/v1/chat/completions" \
    '{"model": "gpt-4", "messages": [{"role": "user", "content": "test"}]}' "401"
else
  echo -e "${YELLOW}Skipping auth test (no API_KEY configured for dev mode)${NC}"
  echo ""
fi

# Test 9: Parameter Handling
echo -e "${YELLOW}=== Parameter Handling ===${NC}"

test_endpoint "Temperature within range" "POST" "/v1/chat/completions" \
  '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "test"}],
    "temperature": 0.7,
    "max_tokens": 50
  }' "200"

test_endpoint "top_p within range" "POST" "/v1/chat/completions" \
  '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "test"}],
    "top_p": 0.9,
    "max_tokens": 50
  }' "200"

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Test Summary                            ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║ ${GREEN}Passed: $PASS${NC}${BLUE}                                              ║${NC}"
echo -e "${BLUE}║ ${RED}Failed: $FAIL${NC}${BLUE}                                              ║${NC}"
TOTAL=$((PASS + FAIL))
echo -e "${BLUE}║ Total:  $TOTAL                                              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo -e "\n${RED}✗ Some tests failed${NC}"
  exit 1
fi
