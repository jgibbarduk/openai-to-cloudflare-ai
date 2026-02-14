#!/usr/bin/env python3

"""
Image Generation Test Script
Tests the /v1/images/generations endpoint with various prompts and configurations.
"""

import requests
import json
import sys
import argparse
import os
from datetime import datetime
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(
        description="Test image generation endpoint",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 test-image-generation.py
  python3 test-image-generation.py --prompt "A sunset over the ocean"
  python3 test-image-generation.py --model dall-e-3 --format b64_json
  python3 test-image-generation.py --run-suite  # Run all test cases
        """
    )

    parser.add_argument(
        '--url',
        default=os.environ.get('API_URL', 'http://localhost:3000'),
        help='API URL (default: http://localhost:3000)'
    )
    parser.add_argument(
        '--api-key',
        default=os.environ.get('API_KEY'),
        help='API Key (or set API_KEY env var)'
    )
    parser.add_argument(
        '--model',
        default='gpt-image-1',
        help='Model name (default: gpt-image-1)'
    )
    parser.add_argument(
        '--prompt',
        default='A beautiful landscape with mountains and a clear blue sky',
        help='Image prompt'
    )
    parser.add_argument(
        '--size',
        default='1024x1024',
        choices=['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'],
        help='Image size (default: 1024x1024)'
    )
    parser.add_argument(
        '--format',
        default='url',
        choices=['url', 'b64_json'],
        help='Response format (default: url)'
    )
    parser.add_argument(
        '--output',
        default='/tmp/image_generation_response.json',
        help='Output file for response (default: /tmp/image_generation_response.json)'
    )
    parser.add_argument(
        '--run-suite',
        action='store_true',
        help='Run comprehensive test suite'
    )
    parser.add_argument(
        '--verbose',
        '-v',
        action='store_true',
        help='Verbose output'
    )

    return parser.parse_args()

def test_image_generation(url, api_key, model, prompt, size, format, output_file):
    """Test single image generation request"""

    if not api_key:
        print("❌ Error: API_KEY not set")
        return False

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }

    payload = {
        'model': model,
        'prompt': prompt,
        'n': 1,
        'size': size,
        'response_format': format,
        'quality': 'standard'
    }

    try:
        print(f"\n📤 Sending request to {url}/v1/images/generations")
        print(f"  Model: {model}")
        print(f"  Prompt: {prompt[:60]}...")
        print(f"  Format: {format}")

        response = requests.post(
            f'{url}/v1/images/generations',
            json=payload,
            headers=headers,
            timeout=60
        )

        if response.status_code != 200:
            print(f"❌ Error: HTTP {response.status_code}")
            print(f"Response: {response.text}")
            return False

        data = response.json()

        # Save response
        Path(output_file).parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)

        print(f"✅ Success!")
        print(f"  Model returned: {data.get('model', 'unknown')}")
        print(f"  Images generated: {len(data.get('data', []))}")
        print(f"  Response saved to: {output_file}")

        # Show image preview
        if format == 'url' and data.get('data'):
            url_data = data['data'][0].get('url', '')
            if url_data.startswith('data:'):
                print(f"  Image: Data URL (base64)")
            else:
                print(f"  Image URL: {url_data[:80]}...")

        return True

    except requests.exceptions.ConnectionError:
        print(f"❌ Connection error: Cannot connect to {url}")
        return False
    except requests.exceptions.Timeout:
        print(f"❌ Timeout: Request took too long")
        return False
    except json.JSONDecodeError:
        print(f"❌ Invalid JSON response")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def run_test_suite(url, api_key):
    """Run comprehensive test suite"""

    test_cases = [
        {
            'name': 'Basic image generation',
            'model': 'gpt-image-1',
            'prompt': 'A serene mountain landscape at sunrise',
            'format': 'url'
        },
        {
            'name': 'Alternative alias (dall-e-3)',
            'model': 'dall-e-3',
            'prompt': 'A futuristic city with neon lights',
            'format': 'url'
        },
        {
            'name': 'Base64 JSON format',
            'model': 'gpt-image-1',
            'prompt': 'A peaceful forest with sunlight',
            'format': 'b64_json'
        },
        {
            'name': 'Detailed prompt',
            'model': 'gpt-image-1',
            'prompt': 'A woman with flowing hair in an elegant dress, standing in a sunlit garden with roses and butterflies, cinematic lighting, oil painting style',
            'format': 'url'
        },
        {
            'name': 'Abstract concept',
            'model': 'gpt-image-1',
            'prompt': 'The concept of artificial intelligence as neural networks of light',
            'format': 'url'
        }
    ]

    passed = 0
    failed = 0

    print("\n" + "="*60)
    print("Image Generation Test Suite")
    print("="*60)

    for i, test in enumerate(test_cases, 1):
        print(f"\n[{i}/{len(test_cases)}] {test['name']}")

        if test_image_generation(
            url, api_key,
            test['model'], test['prompt'], '1024x1024', test['format'],
            f'/tmp/image_test_{i}.json'
        ):
            passed += 1
        else:
            failed += 1

    print("\n" + "="*60)
    print(f"Results: {passed} passed, {failed} failed")
    print("="*60 + "\n")

    return failed == 0

def main():
    args = parse_args()

    if args.run_suite:
        success = run_test_suite(args.url, args.api_key)
        sys.exit(0 if success else 1)
    else:
        success = test_image_generation(
            args.url, args.api_key, args.model, args.prompt,
            args.size, args.format, args.output
        )
        sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
