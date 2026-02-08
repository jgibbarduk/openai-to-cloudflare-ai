#!/bin/bash

# Test the Onyx Tool Calling Fix
# This script tests various scenarios to ensure the proxy properly handles tool calls

set -e

API_URL="${API_URL:-https://ai-forwarder.james-gibbard.workers.dev}"
API_KEY="${API_KEY:-your-api-key-here}"

echo "Testing Onyx Tool Calling Compatibility"
echo "========================================"
echo ""

# Test 1: Simple Chat (baseline)
echo "Test 1: Simple Chat"
echo "-------------------"
curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/qwen/qwen3-30b-a3b-fp8",
    "messages": [{"role": "user", "content": "Say hello"}],
    "stream": false
  }' | jq -r '.choices[0].message.content' || echo "FAILED"
echo ""

# Test 2: Chat with Tool Definition
echo "Test 2: Chat with Tool Definition"
echo "----------------------------------"
RESPONSE=$(curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/qwen/qwen3-30b-a3b-fp8",
    "messages": [
      {"role": "user", "content": "What is the weather in Paris?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }],
    "stream": false
  }')

echo "$RESPONSE" | jq -r 'if .choices[0].message.tool_calls then "✅ Tool call detected: " + .choices[0].message.tool_calls[0].function.name else "Message: " + .choices[0].message.content end'
echo ""

# Test 3: Multi-turn with Tool Call History (CRITICAL TEST)
echo "Test 3: Multi-turn with Tool Call History (Onyx Scenario)"
echo "----------------------------------------------------------"
RESPONSE=$(curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/qwen/qwen3-30b-a3b-fp8",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the weather in London?"},
      {
        "role": "assistant",
        "content": "",
        "tool_calls": [{
          "id": "call_weather_123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"location\":\"London\"}"
          }
        }]
      },
      {
        "role": "tool",
        "tool_call_id": "call_weather_123",
        "content": "The weather in London is sunny, 18°C"
      },
      {"role": "user", "content": "Great! What about Paris?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }],
    "stream": false
  }')

if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "❌ FAILED - Error response:"
  echo "$RESPONSE" | jq '.error'
else
  echo "✅ SUCCESS - Response received:"
  echo "$RESPONSE" | jq -r '.choices[0].message | if .tool_calls then "Tool call: " + .tool_calls[0].function.name else "Content: " + .content[:100] end'
fi
echo ""

# Test 4: Streaming (verify no JSON errors)
echo "Test 4: Streaming Response"
echo "--------------------------"
curl -s -X POST "$API_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/qwen/qwen3-30b-a3b-fp8",
    "messages": [{"role": "user", "content": "Count from 1 to 5"}],
    "stream": true
  }' | head -20 | grep -c "data:" && echo "✅ Streaming chunks received" || echo "❌ Streaming failed"
echo ""

echo "========================================"
echo "Test Suite Complete"
echo ""
echo "If all tests show ✅, the proxy is working correctly with Onyx!"
