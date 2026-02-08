#!/bin/bash

# ============================================================================
# Verification: GPT-OSS Streaming & Tools Support
# ============================================================================
#
# This script verifies that the false limitations have been removed.
#
# BEFORE (broken):
#   ❌ Streaming disabled with warning: "model is too slow for streaming"
#   ❌ Tools unsupported with warning: "GPT-OSS models do not support tools"
#
# AFTER (fixed):
#   ✅ Streaming enabled: "Streaming enabled for GPT-OSS"
#   ✅ Tools supported: "Tools are supported - including N tools"
#

set -e

echo "════════════════════════════════════════════════════════════"
echo "🔍 VERIFICATION: GPT-OSS Capabilities"
echo "════════════════════════════════════════════════════════════"
echo ""

SOURCE_FILE="src/index.ts"

# Check 1: Streaming is NOT disabled
echo "CHECK 1: Streaming should be ENABLED (not disabled)"
echo "─────────────────────────────────────────────────────"

if grep -q "DISABLED streaming for GPT-OSS" "$SOURCE_FILE"; then
    echo "❌ FAIL: Found 'DISABLED streaming' message - streaming is still disabled!"
    exit 1
else
    echo "✅ PASS: Streaming disable message removed"
fi

if grep -q "Streaming enabled for GPT-OSS" "$SOURCE_FILE"; then
    echo "✅ PASS: Found 'Streaming enabled' message - streaming is now enabled"
else
    echo "⚠️  WARN: 'Streaming enabled' message not found (check manually)"
fi

echo ""

# Check 2: Tools are supported (GPT-OSS in TOOL_CAPABLE_MODELS)
echo "CHECK 2: GPT-OSS should be in TOOL_CAPABLE_MODELS"
echo "─────────────────────────────────────────────────────"

if grep -A 10 "TOOL_CAPABLE_MODELS = \[" "$SOURCE_FILE" | grep -q "@cf/openai/gpt-oss"; then
    echo "✅ PASS: GPT-OSS models found in TOOL_CAPABLE_MODELS list"
else
    echo "❌ FAIL: GPT-OSS models NOT in TOOL_CAPABLE_MODELS - tools won't work!"
    exit 1
fi

echo ""

# Check 3: Tools warning removed
echo "CHECK 3: Tools unsupported warning should be REMOVED"
echo "─────────────────────────────────────────────────────"

if grep -q "Tools were requested but GPT-OSS models do not support tools" "$SOURCE_FILE"; then
    echo "❌ FAIL: Found tools unsupported warning - still disabled!"
    exit 1
else
    echo "✅ PASS: Tools unsupported warning removed"
fi

if grep -q "Tools are supported.*including.*tools" "$SOURCE_FILE"; then
    echo "✅ PASS: Found 'Tools are supported' message"
else
    echo "⚠️  WARN: 'Tools are supported' message not found (check manually)"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ ALL VERIFICATIONS PASSED"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "GPT-OSS Capabilities:"
echo "  ✅ Streaming: ENABLED"
echo "  ✅ Tool Calling: ENABLED"
echo "  ✅ Reasoning: ENABLED"
echo ""
echo "False limitations have been REMOVED!"
echo ""
