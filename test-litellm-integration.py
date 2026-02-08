#!/usr/bin/env python3

"""
Test how litellm would connect to our OpenAI-compatible proxy.
This simulates exactly what Onyx does internally.
"""

import os
os.environ["OPENAI_API_KEY"] = "sk-proj-c4nY8Ah0PT6OjIAYgG4gHpdyhCYrme0p4wFEViSkr0xQmljyjgxsmbdk8SjMCqhYaAd8y9dlm3Z1nwADH15JHIm3dhAO5fNLu0qDuvWKJGofriaEo3Rb9pOpqzIcFBbp5QA8Cpet34ptkIqxwcn8varl0Ans927cxzzyfDYsvKit72Q2Tfieky12WLdPkjrN7z0elG-mlt"

try:
    import litellm
    print("✓ litellm imported successfully")
except ImportError:
    print("✗ litellm not installed - install with: pip install litellm")
    print("\nShowing what the configuration should look like:")
    print("""
# Python code that Onyx should use:
import litellm

# Configure litellm to use our custom proxy
litellm.api_base = "https://ai-forwarder.james-gibbard.workers.dev/v1"

# Make a completion request
response = litellm.completion(
    model="openai/@cf/openai/gpt-oss-20b",
    messages=[{"role": "user", "content": "test"}],
    tools=[...]  # tools list
)

print(response)
""")
    exit(0)

# Configure litellm to use our custom proxy
print("\nConfiguring litellm...")
litellm.api_base = "https://ai-forwarder.james-gibbard.workers.dev/v1"
print(f"✓ Set api_base to: {litellm.api_base}")

# Test 1: Simple message without tools
print("\n" + "="*60)
print("TEST 1: Simple message (no tools)")
print("="*60)

try:
    response = litellm.completion(
        model="openai/@cf/openai/gpt-oss-20b",
        messages=[{"role": "user", "content": "Say hello!"}],
        temperature=0.7,
        stream=False
    )

    print(f"✓ Response received")
    print(f"  - Role: {response.choices[0].message.role}")
    print(f"  - Content length: {len(response.choices[0].message.content)}")
    print(f"  - Content: {response.choices[0].message.content[:100]}...")

except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()

# Test 2: Message with tools (like Onyx sends)
print("\n" + "="*60)
print("TEST 2: Message WITH tools (Onyx-like)")
print("="*60)

tools = [
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": "Search for information",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                }
            }
        }
    }
]

try:
    response = litellm.completion(
        model="openai/@cf/openai/gpt-oss-20b",
        messages=[{"role": "user", "content": "Search for info"}],
        tools=tools,
        temperature=0.7,
        stream=False
    )

    print(f"✓ Response received")
    print(f"  - Role: {response.choices[0].message.role}")
    print(f"  - Has content: {response.choices[0].message.content is not None}")
    if response.choices[0].message.content:
        print(f"  - Content length: {len(response.choices[0].message.content)}")
        print(f"  - Content: {response.choices[0].message.content[:100]}...")

    if hasattr(response.choices[0].message, 'tool_calls') and response.choices[0].message.tool_calls:
        print(f"  - Has tool_calls: {len(response.choices[0].message.tool_calls)} calls")
        for tc in response.choices[0].message.tool_calls:
            print(f"    - {tc.function.name}")
    else:
        print(f"  - No tool_calls in response")

except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("✓ Test complete!")
print("="*60)
