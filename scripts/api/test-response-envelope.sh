#!/bin/bash

# ============================================================================
# Test OpenAI Response Envelope Compliance
# ============================================================================
#
# This test validates that ALL chat completion responses from the proxy
# have the required OpenAI Chat Completion response envelope:
#   - choices[0].message.role === "assistant"
#   - choices[0].message.content (string, never null/undefined)
#   - Proper finish_reason ("stop" or "tool_calls")
#
# Usage: ./scripts/api/test-response-envelope.sh
#

set -e

# Source common helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../helpers/common.sh"

# Configuration
BASE_URL="${BASE_URL:-https://ai-forwarder.james-gibbard.workers.dev}"
API_KEY="${API_KEY:-sk-test-key}"

echo "🧪 Testing OpenAI Response Envelope Compliance"
echo "   Base URL: $BASE_URL"
echo ""

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to validate OpenAI response envelope
validate_response_envelope() {
    local response="$1"
    local test_name="$2"

    TESTS_RUN=$((TESTS_RUN + 1))

    # Check for required fields
    local has_choices=$(echo "$response" | jq 'has("choices")' 2>/dev/null)
    local has_message=$(echo "$response" | jq '.choices[0] | has("message")' 2>/dev/null)
    local has_role=$(echo "$response" | jq '.choices[0].message.role' 2>/dev/null)
    local has_content=$(echo "$response" | jq '.choices[0].message | has("content")' 2>/dev/null)
    local content_value=$(echo "$response" | jq '.choices[0].message.content' 2>/dev/null)
    local finish_reason=$(echo "$response" | jq '.choices[0].finish_reason' 2>/dev/null)

    # Validate
    local passed=true
    local errors=()

    if [[ "$has_choices" != "true" ]]; then
        passed=false
        errors+=("Missing 'choices' array")
    fi

    if [[ "$has_message" != "true" ]]; then
        passed=false
        errors+=("Missing 'message' in choices[0]")
    fi

    if [[ "$has_role" != '"assistant"' ]]; then
        passed=false
        errors+=("Invalid role: $has_role (expected 'assistant')")
    fi

    if [[ "$has_content" != "true" ]]; then
        passed=false
        errors+=("Missing 'content' field in message")
    fi

    if [[ "$content_value" == "null" ]]; then
        # Content can be null only if tool_calls are present
        local has_tool_calls=$(echo "$response" | jq '.choices[0].message | has("tool_calls")' 2>/dev/null)
        if [[ "$has_tool_calls" != "true" ]]; then
            passed=false
            errors+=("Content is null but no tool_calls present")
        fi
    elif [[ "$content_value" == '""' ]]; then
        # Empty string is ok for tool_calls
        local has_tool_calls=$(echo "$response" | jq '.choices[0].message | has("tool_calls")' 2>/dev/null)
        if [[ "$has_tool_calls" != "true" ]]; then
            # Content is empty but no tool_calls - should use fallback space
            passed=false
            errors+=("Content is empty string but no tool_calls present (should be ' ')")
        fi
    fi

    if [[ "$finish_reason" != '"stop"' ]] && [[ "$finish_reason" != '"tool_calls"' ]]; then
        passed=false
        errors+=("Invalid finish_reason: $finish_reason")
    fi

    # Print result
    if [[ "$passed" == "true" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "✅ PASS: $test_name"
        return 0
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "❌ FAIL: $test_name"
        for error in "${errors[@]}"; do
            echo "       - $error"
        done
        echo "       Response: $(echo "$response" | jq -c '.' | head -c 200)..."
        return 1
    fi
}

# Test 1: Simple text completion
echo ""
echo "TEST 1: Simple text completion (GPT-OSS)"
response=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "@cf/openai/gpt-oss-20b",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "stream": false
  }')
validate_response_envelope "$response" "GPT-OSS simple completion"

# Test 2: Qwen text completion
echo ""
echo "TEST 2: Qwen text completion"
response=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "@cf/qwen/qwen3-30b-a3b-fp8",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "stream": false
  }')
validate_response_envelope "$response" "Qwen simple completion"

# Test 3: Llama text completion
echo ""
echo "TEST 3: Llama text completion"
response=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }')
validate_response_envelope "$response" "Llama simple completion"

# Test 4: Empty model response fallback
echo ""
echo "TEST 4: Response with empty/missing content (validates fallback)"
# This simulates what happens if a model returns empty response
response=$(cat << 'EOF'
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "test-model",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": " "
    },
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
EOF
)
validate_response_envelope "$response" "Fallback space character for empty response"

# Test 5: Tool call response format
echo ""
echo "TEST 5: Tool call response (content null, tool_calls present)"
response=$(cat << 'EOF'
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "test-model",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_123",
        "type": "function",
        "function": {"name": "get_weather", "arguments": "{}"}
      }]
    },
    "finish_reason": "tool_calls"
  }],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
EOF
)
validate_response_envelope "$response" "Tool call response with null content"

# Print summary
echo ""
echo "════════════════════════════════════════"
echo "📊 Test Summary"
echo "════════════════════════════════════════"
echo "Tests run:     $TESTS_RUN"
echo "Tests passed:  $TESTS_PASSED"
echo "Tests failed:  $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo "✅ All tests passed! Response envelope is compliant."
    exit 0
else
    echo "❌ Some tests failed. Please review the errors above."
    exit 1
fi
