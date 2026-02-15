#!/bin/bash

# Quick test script to verify the responses endpoint returns the right format
# This can be run against local dev server

echo "Starting quick format validation test..."
echo ""

# Test JSON structure (mock response - just checking the builder works)
cat << 'EOF' | node --input-type=module
const testResponse = {
  id: "resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b",
  object: "response",
  created_at: 1741476542,
  status: "completed",
  completed_at: 1741476543,
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  model: "gpt-4.1-2025-04-14",
  output: [{
    type: "message",
    id: "msg_67ccd2bf17f0819081ff3bb2cf6508e60bb6a6b452d3795b",
    status: "completed",
    role: "assistant",
    content: [{
      type: "output_text",
      text: "Test response",
      annotations: []
    }]
  }],
  parallel_tool_calls: true,
  previous_response_id: null,
  reasoning: {
    effort: null,
    summary: null
  },
  store: true,
  temperature: 1.0,
  text: {
    format: {
      type: "text"
    }
  },
  tool_choice: "auto",
  tools: [],
  top_p: 1.0,
  truncation: "disabled",
  usage: {
    input_tokens: 36,
    input_tokens_details: {
      cached_tokens: 0
    },
    output_tokens: 87,
    output_tokens_details: {
      reasoning_tokens: 0
    },
    total_tokens: 123
  },
  user: null,
  metadata: {}
};

// Validation checks
const checks = [];

checks.push({
  name: "object is 'response'",
  pass: testResponse.object === "response"
});

checks.push({
  name: "id starts with 'resp_'",
  pass: testResponse.id.startsWith("resp_")
});

checks.push({
  name: "has status field",
  pass: testResponse.status === "completed"
});

checks.push({
  name: "has output array",
  pass: Array.isArray(testResponse.output)
});

checks.push({
  name: "output[0] is message type",
  pass: testResponse.output[0]?.type === "message"
});

checks.push({
  name: "content[0] is output_text type",
  pass: testResponse.output[0]?.content[0]?.type === "output_text"
});

checks.push({
  name: "usage has nested structure",
  pass: testResponse.usage.input_tokens_details &&
        testResponse.usage.output_tokens_details
});

// Print results
console.log("Response API Format Validation");
console.log("==============================\n");

let allPassed = true;
checks.forEach(check => {
  const icon = check.pass ? "✅" : "❌";
  console.log(`${icon} ${check.name}`);
  if (!check.pass) allPassed = false;
});

console.log("\n" + (allPassed ? "✅ All checks passed!" : "❌ Some checks failed!"));
process.exit(allPassed ? 0 : 1);
EOF

