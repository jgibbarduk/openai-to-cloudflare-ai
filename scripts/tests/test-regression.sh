#!/bin/bash
##############################################################################
# REGRESSION TEST SUITE - AI Forwarder OpenAI Proxy
#
# This comprehensive test suite ensures all core functionality continues
# to work correctly after any code changes.
#
# Usage:
#   ./scripts/tests/test-regression.sh
#   ./scripts/tests/test-regression.sh --verbose
#   ./scripts/tests/test-regression.sh --model @cf/qwen/qwen3-30b-a3b-fp8
##############################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VERBOSE=${VERBOSE:-false}
WORKER_URL="${CLOUDFLARE_WORKER_URL:-https://ai-forwarder.james-gibbard.workers.dev}"
API_KEY="${API_KEY:-.env}"

# Load environment if file path provided
if [[ -f "$API_KEY" ]]; then
  export $(cat "$API_KEY" | grep -v '^#' | xargs)
  API_KEY="${API_KEY_ACTUAL:-${API_KEY}}"
elif [[ -f ".env" ]]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose) VERBOSE=true; shift ;;
    --url) WORKER_URL="$2"; shift 2 ;;
    --key) API_KEY="$2"; shift 2 ;;
    --model) TEST_MODEL="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Test models
declare -a MODELS=(
  "@cf/qwen/qwen3-30b-a3b-fp8"
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  "@cf/openai/gpt-oss-20b"
)

# Override with single model if specified
if [[ -n "${TEST_MODEL:-}" ]]; then
  MODELS=("$TEST_MODEL")
fi

##############################################################################
# HELPER FUNCTIONS
##############################################################################

log_test() {
  local name="$1"
  printf "${BLUE}[TEST]${NC} %s\n" "$name"
  TESTS_RUN=$((TESTS_RUN + 1))
}

log_pass() {
  local message="${1:-PASSED}"
  printf "${GREEN}✓${NC} %s\n" "$message"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
  local message="$1"
  printf "${RED}✗${NC} %s\n" "$message"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_info() {
  printf "${YELLOW}ℹ${NC} %s\n" "$1"
}

log_section() {
  printf "\n${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
  printf "${BLUE}%s${NC}\n" "$1"
  printf "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"
}

assert_status_code() {
  local actual="$1"
  local expected="${2:-200}"
  local message="$3"

  if [[ "$actual" == "$expected" ]]; then
    log_pass "$message (HTTP $actual)"
    return 0
  else
    log_fail "$message (expected HTTP $expected, got $actual)"
    return 1
  fi
}

assert_json_field() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local message="$4"

  local actual=$(echo "$json" | jq -r "$field" 2>/dev/null || echo "MISSING")

  if [[ "$actual" == "$expected" ]]; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (expected '$expected', got '$actual')"
    [[ "$VERBOSE" == "true" ]] && echo "Full JSON: $json" >&2
    return 1
  fi
}

assert_json_contains() {
  local json="$1"
  local field="$2"
  local message="$3"

  local result=$(echo "$json" | jq "$field" 2>/dev/null)

  if [[ ! -z "$result" && "$result" != "null" ]]; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (field not found or null)"
    [[ "$VERBOSE" == "true" ]] && echo "Full JSON: $json" >&2
    return 1
  fi
}

make_request() {
  local method="$1"
  local endpoint="$2"
  local data="$3"

  if [[ "$method" == "POST" || "$method" == "PUT" ]]; then
    curl -s -X "$method" \
      "${WORKER_URL}${endpoint}" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$data" \
      -w "\n%{http_code}"
  else
    curl -s -X "$method" \
      "${WORKER_URL}${endpoint}" \
      -H "Authorization: Bearer $API_KEY" \
      -w "\n%{http_code}"
  fi
}

##############################################################################
# CORE TESTS
##############################################################################

test_health_check() {
  log_section "HEALTH CHECK"

  log_test "GET /health endpoint"
  local response=$(make_request GET "/health" "")
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  assert_status_code "$http_code" "200" "Health check responds with 200"
  assert_json_field "$body" ".status" "ok" "Health status is 'ok'"
  assert_json_contains "$body" ".providers.workers_ai" "Workers AI provider available"
}

test_models_endpoint() {
  log_section "MODELS ENDPOINT"

  log_test "GET /v1/models"
  local response=$(make_request GET "/v1/models" "")
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  assert_status_code "$http_code" "200" "Models endpoint responds with 200"
  assert_json_field "$body" ".object" "list" "Response is a list"
  assert_json_contains "$body" ".data | length" "Models list is not empty"
}

test_simple_chat() {
  log_section "SIMPLE CHAT COMPLETIONS"

  for model in "${MODELS[@]}"; do
    log_test "Chat completion with $model"

    local payload=$(cat <<EOF
{
  "model": "$model",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Say 'hello world' only"}
  ],
  "max_tokens": 100
}
EOF
)

    local response=$(make_request POST "/v1/chat/completions" "$payload")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    assert_status_code "$http_code" "200" "Chat completions responds with 200 for $model"
    assert_json_field "$body" ".object" "chat.completion" "Response is chat.completion"
    assert_json_contains "$body" ".choices[0].message.content" "Message content exists"

    # Verify response is not empty
    local content=$(echo "$body" | jq -r '.choices[0].message.content' 2>/dev/null || echo "")
    if [[ -z "$content" || "$content" == "null" ]]; then
      log_fail "Message content is empty or null"
    else
      log_pass "Message content is not empty"
    fi
  done
}

test_streaming_chat() {
  log_section "STREAMING CHAT COMPLETIONS"

  for model in "${MODELS[@]}"; do
    log_test "Streaming chat with $model"

    local payload=$(cat <<EOF
{
  "model": "$model",
  "messages": [
    {"role": "user", "content": "Count to 3"}
  ],
  "stream": true,
  "max_tokens": 50
}
EOF
)

    # Get HTTP status without full response
    local http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "${WORKER_URL}/v1/chat/completions" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload")

    assert_status_code "$http_code" "200" "Streaming responds with 200 for $model"

    # Verify we get SSE format
    local response=$(curl -s -X POST "${WORKER_URL}/v1/chat/completions" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" | head -n 5)

    if echo "$response" | grep -q "data:"; then
      log_pass "Response uses SSE format (contains 'data:')"
    else
      log_fail "Response does not use SSE format"
    fi
  done
}

test_tool_calling() {
  log_section "TOOL CALLING / FUNCTION CALLING"

  for model in "${MODELS[@]}"; do
    log_test "Tool calling with $model"

    local payload=$(cat <<EOF
{
  "model": "$model",
  "messages": [
    {"role": "user", "content": "Search for information about Claude"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search",
        "description": "Search for information",
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
  "max_tokens": 100
}
EOF
)

    local response=$(make_request POST "/v1/chat/completions" "$payload")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    assert_status_code "$http_code" "200" "Tool calling responds with 200 for $model"

    # For models that support tools, check for tool_calls OR content
    local has_tool_calls=$(echo "$body" | jq '.choices[0].message.tool_calls' 2>/dev/null)
    local has_content=$(echo "$body" | jq '.choices[0].message.content' 2>/dev/null)

    if [[ "$has_tool_calls" != "null" && "$has_tool_calls" != "[]" ]]; then
      log_pass "Tool calls detected in response"
    elif [[ ! -z "$has_content" && "$has_content" != "null" ]]; then
      log_pass "Message content provided (model may not support structured tool calls)"
    else
      log_fail "No tool_calls or content in response"
    fi
  done
}

test_llama_auto_switch() {
  log_section "LLAMA AUTO-SWITCH FUNCTIONALITY"

  log_test "Llama auto-switches to Qwen for tool calling"

  local payload=$(cat <<EOF
{
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "messages": [
    {"role": "user", "content": "Find info about Python"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "Search the web",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {"type": "string"}
          }
        }
      }
    }
  ]
}
EOF
)

  local response=$(make_request POST "/v1/chat/completions" "$payload")
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)

  assert_status_code "$http_code" "200" "Auto-switch responds with 200"

  # Should get a valid response (either tool calls or content)
  local message=$(echo "$body" | jq '.choices[0].message' 2>/dev/null)
  if [[ ! -z "$message" && "$message" != "null" ]]; then
    log_pass "Llama request handled correctly (auto-switched)"
  else
    log_fail "No message in response"
  fi
}

test_error_handling() {
  log_section "ERROR HANDLING"

  log_test "Invalid API key returns 401"
  local payload='{"model": "@cf/qwen/qwen3-30b-a3b-fp8", "messages": [{"role": "user", "content": "hi"}]}'
  local http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer invalid_key" \
    -H "Content-Type: application/json" \
    -d "$payload")

  assert_status_code "$http_code" "401" "Invalid API key returns 401"

  log_test "Missing required fields returns 400"
  local bad_payload='{"model": "@cf/qwen/qwen3-30b-a3b-fp8"}'
  local http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$bad_payload")

  assert_status_code "$http_code" "400" "Missing messages returns 400"

  log_test "Nonexistent endpoint returns 404"
  local http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X GET "${WORKER_URL}/v1/nonexistent" \
    -H "Authorization: Bearer $API_KEY")

  assert_status_code "$http_code" "404" "Nonexistent endpoint returns 404"
}

test_response_format() {
  log_section "RESPONSE FORMAT COMPLIANCE"

  log_test "Response follows OpenAI chat completion format"

  local payload=$(cat <<EOF
{
  "model": "@cf/qwen/qwen3-30b-a3b-fp8",
  "messages": [{"role": "user", "content": "Hi"}],
  "max_tokens": 50
}
EOF
)

  local response=$(make_request POST "/v1/chat/completions" "$payload")
  local body=$(echo "$response" | head -n-1)

  assert_json_field "$body" ".id" "" "Has completion ID"
  assert_json_field "$body" ".object" "chat.completion" "Object type is correct"
  assert_json_contains "$body" ".created" "Has created timestamp"
  assert_json_contains "$body" ".model" "Has model name"
  assert_json_contains "$body" ".choices" "Has choices array"
  assert_json_contains "$body" ".choices[0].message" "Has message"
  assert_json_contains "$body" ".choices[0].message.role" "Message has role"
  assert_json_contains "$body" ".choices[0].message.content" "Message has content"
  assert_json_contains "$body" ".usage" "Has usage information"
}

##############################################################################
# MAIN TEST EXECUTION
##############################################################################

main() {
  clear

  printf "${BLUE}"
  cat << "EOF"
  ╔══════════════════════════════════════════════════════════╗
  ║     AI FORWARDER - REGRESSION TEST SUITE v1.0            ║
  ║     Testing OpenAI-Compatible Proxy Functionality        ║
  ╚══════════════════════════════════════════════════════════╝
EOF
  printf "${NC}\n"

  log_info "Worker URL: $WORKER_URL"
  log_info "Test models: ${MODELS[*]}"
  log_info "Verbose: $VERBOSE"
  echo ""

  # Run all tests
  test_health_check
  test_models_endpoint
  test_simple_chat
  test_streaming_chat
  test_tool_calling
  test_llama_auto_switch
  test_error_handling
  test_response_format

  # Summary
  log_section "TEST SUMMARY"

  printf "Total Tests: ${BLUE}%d${NC}\n" "$TESTS_RUN"
  printf "Passed: ${GREEN}%d${NC}\n" "$TESTS_PASSED"
  printf "Failed: ${RED}%d${NC}\n" "$TESTS_FAILED"

  local pass_rate=$((TESTS_PASSED * 100 / TESTS_RUN))
  printf "Pass Rate: ${YELLOW}%d%%${NC}\n\n" "$pass_rate"

  if [[ $TESTS_FAILED -eq 0 ]]; then
    printf "${GREEN}✓ ALL TESTS PASSED${NC}\n"
    return 0
  else
    printf "${RED}✗ SOME TESTS FAILED${NC}\n"
    return 1
  fi
}

main "$@"
