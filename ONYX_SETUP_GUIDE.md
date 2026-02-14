# Onyx Configuration Guide for Cloudflare Workers AI

## Prerequisites
- Your Cloudflare Worker is deployed at: `https://ai-forwarder.james-gibbard.workers.dev`
- You have an API_KEY configured as a secret in Cloudflare (starts with `sk-proj-...`)

## Step 1: Configure LLM Provider in Onyx

1. Go to Onyx Admin → **Configuration** → **LLM Providers**
2. Add/Edit OpenAI provider with these settings:
   - **Provider Type**: OpenAI
   - **API Base URL**: `https://ai-forwarder.james-gibbard.workers.dev/v1`
   - **API Key**: `sk-proj-...` (your actual Cloudflare API_KEY secret)
   - **Model**: Use one of:
     - `@cf/qwen/qwen3-30b-a3b-fp8` (best for tool calling)
     - `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
     - `@cf/zai-org/glm-4.7-flash`
     - Or use aliases: `gpt-4`, `gpt-3.5-turbo` (will map to CF models)

## Step 2: Configure Image Generation in Onyx

⚠️ **IMPORTANT**: Image generation is configured separately from LLM providers. You MUST configure it in the Onyx Admin UI, not just the .env file.

1. Go to Onyx Admin → **Configuration** → **Image Generation**
2. Click **"Add Provider"** or **"Edit"** if one already exists
3. Configure with these settings:
   - **Provider**: OpenAI (select from dropdown)
   - **API Base URL**: `https://ai-forwarder.james-gibbard.workers.dev/v1` (no trailing slash after /v1)
   - **API Key**: Your full `sk-proj-...` key (must match the Cloudflare secret exactly)
   - **Model**: Use one of:
     - `dall-e-3` (recommended - alias for Flux)
     - `gpt-image-1` (also works - alias for Flux)
     - `@cf/black-forest-labs/flux-2-klein-9b` (actual Cloudflare model name)
4. Click **"Save"** or **"Update"**
5. Click **"Test"** to verify the connection works

**Troubleshooting**: If you see "Authorization header present: false" in Cloudflare logs:
- Make sure you filled in the API Key field in the UI (not just the .env file)
- Try deleting and re-adding the provider
- Restart Onyx containers after making changes

## Step 3: Test the Connection

### Test Chat Completions
```bash
curl -X POST https://ai-forwarder.james-gibbard.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-proj-YOUR_KEY_HERE" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
```

### Test Image Generation
```bash
curl -X POST https://ai-forwarder.james-gibbard.workers.dev/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-proj-YOUR_KEY_HERE" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A beautiful sunset over mountains",
    "n": 1,
    "size": "1024x1024"
  }'
```

## Troubleshooting

### 401 Authentication Error
**Symptom**: `Invalid authentication credentials`

**Solutions**:
1. Verify API key matches exactly between Onyx and Cloudflare
2. Check that Onyx is sending the `Authorization: Bearer YOUR_KEY` header
3. View Cloudflare logs to see what headers Onyx is actually sending

### No Logs in Cloudflare
**Symptom**: Requests from Onyx don't appear in Cloudflare logs

**Solutions**:
1. Verify the Base URL in Onyx is exactly: `https://ai-forwarder.james-gibbard.workers.dev/v1`
2. Check if Onyx is routing requests through a proxy
3. Test with curl to verify the endpoint works

### Image Generation Fails
**Symptom**: `Image generation test failed: AuthenticationError`

**Solutions**:
1. Same as 401 error above
2. Verify the image generation model is specified correctly
3. Check Cloudflare logs with: `npx wrangler tail`

## Viewing Logs

### Real-time logs:
```bash
cd /Users/jamesgibbard/Development/openai-to-cloudflare-ai
npx wrangler tail --format pretty
```

### Look for these log patterns:
- `[Auth] Request to /v1/...` - Shows which endpoint was called
- `[Auth] Authorization header present: true/false` - Shows if API key was sent
- `[Auth] All request headers:` - Shows all headers Onyx sent
- `[Auth] Authentication successful` - Auth worked!
- `[Auth] Authentication failed` - Auth failed

## Common Onyx Configuration Issues

### Issue 0: Environment Variables Don't Apply to Image Generation ⚠️
**Symptom**: `Authorization header present: false` in Cloudflare logs

**Root Cause**: The `.env` file's `OPENAI_API_BASE` and `OPENAI_API_KEY` variables are used for chat/LLM functionality, but **image generation requires separate configuration in the Admin UI**.

**Solution**:
1. Don't rely on `.env` file for image generation
2. Configure image generation directly in Onyx Admin UI → Configuration → Image Generation
3. Enter the API key in the UI form field
4. Click "Test" to verify it works before saving

### Issue 1: Onyx Using Default OpenAI URL
If Onyx ignores your custom base URL and still uses `api.openai.com`, you may need to:
1. Completely remove/disable the default OpenAI provider
2. Add a NEW provider with your Cloudflare URL
3. Restart Onyx backend containers

### Issue 2: API Key Not Being Sent
Some Onyx versions/configurations don't send the API key properly. Check:
1. Is the API key field filled in Onyx admin?
2. Is Onyx using environment variables that override the UI config?
3. Check Onyx logs to see if it's even attempting to authenticate

### Issue 3: Model Names Not Recognized
Onyx may not recognize Cloudflare model names. Use aliases:
- Instead of `@cf/qwen/qwen3-30b-a3b-fp8`, use `gpt-4`
- Instead of `@cf/black-forest-labs/flux-2-klein-9b`, use `dall-e-3`

## API Key Security

⚠️ **Important**: Never commit your API key to git!

The API_KEY should be set as a Cloudflare secret:
```bash
# Set/update the API key
npx wrangler secret put API_KEY
# Then paste your key when prompted
```

## Available Models

### Chat Models (via /v1/chat/completions):
- `@cf/qwen/qwen3-30b-a3b-fp8` - Best for tool calling
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` - Fast and capable
- `@cf/zai-org/glm-4.7-flash` - Supports function calling, 131K context
- `@cf/mistralai/mistral-small-3.1-24b-instruct` - 128K context
- `@hf/nousresearch/hermes-2-pro-mistral-7b` - Tool calling support
- `@cf/openai/gpt-oss-20b` - GPT-style model (no tools)

### Image Generation Models (via /v1/images/generations):
- `@cf/black-forest-labs/flux-2-klein-9b` - Main image model
- Aliases: `dall-e-3`, `gpt-image-1`

### Embeddings Models (via /v1/embeddings):
- `@cf/baai/bge-base-en-v1.5`
- `@cf/baai/bge-large-en-v1.5`
- Aliases: `text-embedding-ada-002`, `text-embedding-3-small`, `text-embedding-3-large`

## Support

If you're still having issues:
1. Check the Cloudflare logs: `npx wrangler tail`
2. Test with curl to isolate if it's an Onyx issue
3. Check Onyx logs for authentication/connection errors
4. Verify network connectivity between Onyx and Cloudflare



