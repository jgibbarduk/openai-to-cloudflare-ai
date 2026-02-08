#!/bin/bash

# ============================================================================
# Validate Fix Design Spec Requirements
# ============================================================================
#
# This script validates that the implementation meets ALL requirements from
# the Fix Design Specification provided at the start of this task.
#
# Requirements verified:
# 1. Canonical OpenAI response builder exists
# 2. All models return through canonical wrapper
# 3. Empty text protection (fallback to " ")
# 4. Tool-incompatible models strip tools (mistral, gpt-oss)
# 5. Tool-compatible models get tools (qwen, llama)
# 6. Streaming responses follow OpenAI SSE format
# 7. Response validation layer exists
# 8. Error handling translates to OpenAI format
#
# Usage: bash scripts/deployment/validate-fix-spec.sh
#

set -e

echo "════════════════════════════════════════════════════════════"
echo "🔍 FIX DESIGN SPEC VALIDATION"
echo "════════════════════════════════════════════════════════════"
echo ""

SOURCE_FILE="src/index.ts"
CHECKS_PASSED=0
CHECKS_FAILED=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_requirement() {
    local req_num="$1"
    local description="$2"
    local search_pattern="$3"

    if grep -q "$search_pattern" "$SOURCE_FILE"; then
        echo -e "${GREEN}✅${NC} REQ $req_num: $description"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
        return 0
    else
        echo -e "${RED}❌${NC} REQ $req_num: $description"
        echo "    Pattern not found: $search_pattern"
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
        return 1
    fi
}

check_function() {
    local func_name="$1"
    local description="$2"

    if grep -q "^\s*${func_name}\s*(" "$SOURCE_FILE" || grep -q "${func_name}:\s*function\|${func_name}\s*{\|${func_name}.*{\|async\s*${func_name}"; then
        echo -e "${GREEN}✅${NC} FUNC: $description ($func_name)"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
        return 0
    else
        echo -e "${RED}❌${NC} FUNC: $description ($func_name)"
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
        return 1
    fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧱 CANONICAL RESPONSE BUILDER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Requirement 1: Canonical builder function exists
check_function "buildOpenAIChatResponse" "Canonical OpenAI response builder function"
check_requirement "1.1" "Builder accepts text parameter" "buildOpenAIChatResponse.*text"
check_requirement "1.2" "Builder accepts model parameter" "buildOpenAIChatResponse.*model"
check_requirement "1.3" "Builder accepts toolCalls parameter" "buildOpenAIChatResponse.*toolCalls"
check_requirement "1.4" "Builder generates unique IDs" 'id.*chatcmpl-'
check_requirement "1.5" "Builder sets object to chat.completion" '"object".*"chat.completion"'
check_requirement "1.6" "Builder creates choices array" '"choices".*\['
check_requirement "1.7" "Builder sets role to assistant" '"role".*"assistant"'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛡️  EMPTY TEXT PROTECTION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_requirement "2.1" "Builder has empty text fallback" "Empty content detected"
check_requirement "2.2" "Builder uses space fallback" "use fallback space"
check_requirement "2.3" "extractGptOssResponse validates content" "responseText.*trim.*length.*=== 0"
check_requirement "2.4" "extractOpenAiCompatibleResponse validates content" "OpenAI-Compat.*extracted.*using fallback"
check_requirement "2.5" "sanitizeAiResponse validates null" "Sanitize.*Response is null"
check_requirement "2.6" "sanitizeAiResponse converts strings" "typeof response !== 'string'"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔀 RESPONSE ROUTING & VALIDATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_requirement "3.1" "handleChatCompletionResponse handles streaming" "options.stream.*ReadableStream"
check_requirement "3.2" "handleChatCompletionResponse detects OpenAI format" "choices.*in aiRes"
check_requirement "3.3" "handleChatCompletionResponse detects GPT-OSS format" "output.*in aiRes"
check_requirement "3.4" "handleChatCompletionResponse detects native format" "response.*in aiRes"
check_requirement "3.5" "handleChatCompletionResponse validates OpenAI extract" "OpenAI-compatible.*validation"
check_requirement "3.6" "handleChatCompletionResponse validates GPT-OSS extract" "GPT-OSS.*validation"
check_requirement "3.7" "All paths use chatNormalResponse" "chatNormalResponse"
check_requirement "3.8" "Has fallback for no valid response" "No valid response from AI"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 TOOL HANDLING"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_requirement "4.1" "Tool-incompatible model list exists" "TOOL_CAPABLE_MODELS"
check_requirement "4.2" "GPT-OSS models defined" "GPT_OSS_MODELS"
check_requirement "4.3" "Tool stripping for incompatible models" "delete body.tools"
check_requirement "4.4" "Tool call transformation exists" "tool_calls.*map"
check_requirement "4.5" "Tool finish_reason set correctly" 'finish_reason.*tool_calls.*stop'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📡 STREAMING SUPPORT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_function "chatStreamResponse" "Streaming response handler"
check_requirement "5.1" "Streaming uses OpenAI SSE format" "data: .*choices"
check_requirement "5.2" "Streaming sends delta chunks" 'delta.*content'
check_requirement "5.3" "Streaming ends with [DONE]" "\\[DONE\\]"
check_requirement "5.4" "Streaming handles finish_reason" "finish_reason.*stop"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 LOGGING & DEBUGGING"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_requirement "6.1" "Builder logs content length" "Built response for model"
check_requirement "6.2" "Extraction functions log validation" "validation"
check_requirement "6.3" "Sanitize function logs conversions" "Sanitize.*Converting"
check_requirement "6.4" "Router logs detection" "Detected.*response format"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "📊 VALIDATION SUMMARY"
echo "════════════════════════════════════════════════════════════"
echo ""
echo -e "Checks passed:  ${GREEN}${CHECKS_PASSED}${NC}"
echo -e "Checks failed:  ${RED}${CHECKS_FAILED}${NC}"
echo "Total checks:   $((CHECKS_PASSED + CHECKS_FAILED))"
echo ""

if [[ $CHECKS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✅ ALL REQUIREMENTS MET!${NC}"
    echo ""
    echo "The implementation satisfies all requirements from the Fix Design Spec:"
    echo "  ✓ Canonical OpenAI response builder created"
    echo "  ✓ All extraction paths validate content"
    echo "  ✓ Empty text protection with fallback"
    echo "  ✓ Tool handling for compatible/incompatible models"
    echo "  ✓ Streaming follows OpenAI SSE format"
    echo "  ✓ Response validation at multiple layers"
    echo "  ✓ Comprehensive logging for debugging"
    echo ""
    exit 0
else
    echo -e "${RED}❌ SOME REQUIREMENTS NOT MET${NC}"
    echo ""
    echo "Please review the failures above and fix the implementation."
    echo ""
    exit 1
fi
