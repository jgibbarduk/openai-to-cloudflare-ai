# OpenAI to Cloudflare AI Gateway

A powerful Cloudflare Worker that acts as an **OpenAI-compatible proxy** for [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/), allowing you to use OpenAI SDKs, tools, and workflows with Cloudflare's AI models seamlessly.

## 🎯 Overview

This proxy translates OpenAI API requests into Cloudflare Workers AI format in real-time, enabling:

- **Drop-in OpenAI Replacement**: Use any OpenAI SDK or client without code changes
- **Model Aliasing**: Automatically maps `gpt-4` → Qwen, `dall-e-3` → Flux, etc.
- **Full Feature Parity**: Supports chat completions, streaming, tool calling, embeddings, and image generation
- **Cost Optimization**: Leverage Cloudflare's generous AI quotas instead of OpenAI's pricing
- **Workflow Integration**: Perfect for n8n, LangChain, AutoGen, and other AI frameworks

### Quick Start Example

```bash
# 1. Deploy the worker
pnpm install && pnpm run deploy

# 2. Generate API key
pnpm run api-key

# 3. Make your first request
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

That's it! The proxy automatically:
- Maps `gpt-4` → `@cf/qwen/qwen3-30b-a3b-fp8`
- Validates and normalizes your request
- Calls Cloudflare Workers AI
- Returns OpenAI-compatible response

## ✨ Key Features

### Core Capabilities
- ✅ **Full OpenAI API Compatibility** - Works with OpenAI SDKs (Python, Node.js, etc.)
- ✅ **Chat Completions** - Standard and streaming responses
- ✅ **Responses API** - OpenAI's structured output format with reasoning
- ✅ **Function/Tool Calling** - Native support with Qwen and GLM models
- ✅ **Text Embeddings** - Vector generation for RAG and semantic search
- ✅ **Image Generation** - DALL-E requests mapped to Flux models
- ✅ **Model Discovery** - Dynamic model listing from Cloudflare
- ✅ **Bearer Token Auth** - Secure API key protection

### Advanced Features
- 🔧 **Intelligent Model Routing** - 20+ model aliases (gpt-4, gpt-3.5-turbo, etc.)
- 🎨 **Reasoning Models Support** - o1, o3 series with thinking process
- 🛠️ **Tool Calling Workarounds** - Automatic fixes for Qwen quirks
- 📊 **Request Normalization** - Handles Onyx, Responses API, and standard formats
- 🌊 **SSE Streaming** - Server-Sent Events for real-time responses
- 📝 **Comprehensive Logging** - Detailed request/response tracking
- 🚀 **Performance Optimized** - Sub-second response times

### Supported Model Types
- **Text Generation**: Llama 3, Qwen, Mistral, GLM-4, GPT-OSS
- **Embeddings**: BGE (base and large), all CF embedding models
- **Image Generation**: Flux 2 Klein, Stable Diffusion variants
- **Reasoning Models**: GLM-4.7-Flash (mapped from gpt-5)

## 📋 OpenAI API Compatibility

### Supported vs Not Supported

| OpenAI API Endpoint | Status | Implementation Notes |
|---------------------|--------|---------------------|
| **Chat Completions** | | |
| `/v1/chat/completions` (standard) | ✅ Fully Supported | All parameters supported |
| `/v1/chat/completions` (streaming) | ✅ Fully Supported | SSE format, proper deltas |
| Function/Tool calling | ✅ Fully Supported | Qwen, GLM-4, Hermes models |
| Tool choice (`auto`, `required`) | ✅ Supported | Model-dependent |
| Reasoning models (o1, o3) | ✅ Supported | Via GLM-4.7-Flash |
| Vision/multimodal | ❌ Not Supported | Future feature |
| JSON mode | ⚠️ Partial | Via prompt engineering |
| **Responses API** | | |
| `/v1/responses` | ✅ Fully Supported | Structured output format |
| Streaming responses | ✅ Fully Supported | SSE with reasoning |
| Reasoning extraction | ✅ Supported | From GLM models |
| **Embeddings** | | |
| `/v1/embeddings` | ✅ Fully Supported | BGE models |
| Batch embeddings | ✅ Supported | Multiple inputs |
| Base64 encoding | ✅ Supported | `encoding_format` param |
| **Images** | | |
| `/v1/images/generations` | ✅ Fully Supported | Via Flux models |
| DALL-E 2/3 compatibility | ✅ Supported | Mapped to Flux |
| Custom sizes | ✅ Supported | Any WIDTHxHEIGHT |
| Image edits | ❌ Not Supported | Platform limitation |
| Image variations | ❌ Not Supported | Platform limitation |
| **Models** | | |
| `/v1/models` (list) | ✅ Fully Supported | All CF models |
| `/v1/models/{model}` (get) | ⚠️ Partial | Via list endpoint |
| **Audio** | | |
| Speech-to-text | ❌ Not Supported | Future feature |
| Text-to-speech | ❌ Not Supported | Future feature |
| **Assistants** | | |
| All `/v1/assistants/*` | ⏸️ Stub (501) | Needs state management |
| **Threads** | | |
| All `/v1/threads/*` | ⏸️ Stub (501) | Needs state management |
| **Files** | | |
| File uploads | ❌ Not Supported | N/A for Workers |
| **Fine-tuning** | | |
| All fine-tuning endpoints | ❌ Not Supported | N/A for proxy |
| **Moderation** | | |
| Content moderation | ❌ Not Supported | Future feature |
| **Batch** | | |
| Batch API | ❌ Not Supported | N/A for proxy |

### Request Parameters Compatibility

| Parameter | Chat Completions | Responses API | Notes |
|-----------|------------------|---------------|-------|
| `model` | ✅ | ✅ | With aliasing |
| `messages` | ✅ | ✅ | Also `input_items` |
| `max_tokens` | ✅ | ✅ | Clamped to model limits |
| `temperature` | ✅ | ✅ | Mapped 0.0-2.0 → 0.0-1.0 |
| `top_p` | ✅ | ✅ | Pass-through |
| `stream` | ✅ | ✅ | SSE format |
| `tools` | ✅ | ✅ | Model-dependent |
| `tool_choice` | ✅ | ✅ | `auto`, `required` |
| `n` | ⚠️ | ⚠️ | Always returns 1 |
| `stop` | ❌ | ❌ | Not supported |
| `presence_penalty` | ❌ | ❌ | Not supported |
| `frequency_penalty` | ❌ | ❌ | Not supported |
| `logit_bias` | ❌ | ❌ | Not supported |
| `user` | ❌ | ❌ | Stripped |
| `seed` | ❌ | ❌ | Not supported |
| `response_format` | ❌ | ⚠️ | Via Responses API |

## 📡 API Endpoints

### Core Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/v1/chat/completions` | POST | Chat completions (streaming & non-streaming) | ✅ |
| `/v1/responses` | POST | Responses API format (structured output) | ✅ |
| `/v1/embeddings` | POST | Generate text embeddings | ✅ |
| `/v1/images/generations` | POST | Generate images (DALL-E → Flux) | ✅ |
| `/v1/models` | GET | List available AI models | ✅ |
| `/health` | GET | Health check endpoint | ❌ |
| `/models/search` | GET | Model browser (HTML/JSON) | ❌ |

### Chat Completions API

The primary endpoint for text generation. Fully compatible with OpenAI's Chat Completions API.

**Basic Request:**
```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is Cloudflare?"}
    ]
  }'
```

**Streaming Request:**
```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

**Function Calling:**
```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "What is the weather in London?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          }
        }
      }
    }]
  }'
```

### Responses API

Structured output format with separate reasoning and response fields.

```bash
curl https://your-worker.workers.dev/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input_items": [{
      "type": "message",
      "role": "user",
      "content": [{"type": "input_text", "text": "Explain quantum computing"}]
    }],
    "max_output_tokens": 1000
  }'
```

**Response Format:**
```json
{
  "id": "resp_...",
  "output": [
    {
      "type": "reasoning",
      "reasoning": "I need to explain quantum computing clearly..."
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [{"type": "output_text", "text": "Quantum computing..."}]
    }
  ]
}
```

### Embeddings API

Generate vector embeddings for text.

```bash
curl https://your-worker.workers.dev/v1/embeddings \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-ada-002",
    "input": "Your text here",
    "encoding_format": "float"
  }'
```

**Batch Processing:**
```bash
curl https://your-worker.workers.dev/v1/embeddings \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": ["Text 1", "Text 2", "Text 3"]
  }'
```

### Image Generation API

Generate images using Cloudflare's Flux models.

```bash
curl https://your-worker.workers.dev/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A serene mountain landscape at sunset",
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

**Supported Sizes:**
- `1024x1024` (default)
- `512x512`
- `256x256`
- Custom sizes in format `WIDTHxHEIGHT`

**Response Formats:**
- `b64_json` - Base64 encoded image data
- `url` - Direct image URL (if available)

### Models API

List all available models with their capabilities.

```bash
curl https://your-worker.workers.dev/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {"id": "@cf/qwen/qwen3-30b-a3b-fp8", "object": "model"},
    {"id": "@cf/meta/llama-3-8b-instruct", "object": "model"},
    {"id": "@cf/black-forest-labs/flux-2-klein-9b", "object": "model"}
  ]
}
```

## 🔧 Model Aliasing

The proxy automatically translates OpenAI model names to optimal Cloudflare models:

### Chat Models
| OpenAI Model | Cloudflare Model | Notes |
|--------------|------------------|-------|
| `gpt-4` | `@cf/qwen/qwen3-30b-a3b-fp8` | Best for tool calling |
| `gpt-4-turbo` | `@cf/qwen/qwen3-30b-a3b-fp8` | 30B parameters |
| `gpt-4o` | `@cf/qwen/qwen3-30b-a3b-fp8` | Latest Qwen |
| `gpt-4o-mini` | `@cf/meta/llama-3-8b-instruct` | Fast, efficient |
| `gpt-5` | `@cf/zai-org/glm-4.7-flash` | Reasoning + tools |
| `gpt-3.5-turbo` | `@cf/meta/llama-3-8b-instruct` | Standard chat |
| `mistral` | `@cf/mistralai/mistral-small-3.1-24b-instruct` | 128K context |

### Embedding Models
| OpenAI Model | Cloudflare Model | Dimensions |
|--------------|------------------|------------|
| `text-embedding-ada-002` | `@cf/baai/bge-base-en-v1.5` | 768 |
| `text-embedding-3-small` | `@cf/baai/bge-base-en-v1.5` | 768 |
| `text-embedding-3-large` | `@cf/baai/bge-large-en-v1.5` | 1024 |

### Image Models
| OpenAI Model | Cloudflare Model | Quality |
|--------------|------------------|---------|
| `dall-e-3` | `@cf/black-forest-labs/flux-2-klein-9b` | High |
| `dall-e-2` | `@cf/black-forest-labs/flux-2-klein-9b` | High |
| `gpt-image-1` | `@cf/black-forest-labs/flux-2-klein-9b` | High |

You can also use Cloudflare model names directly:
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `@hf/nousresearch/hermes-2-pro-mistral-7b`
- Any model from `GET /v1/models`

## 🛠️ Advanced Features

### Tool Calling (Function Calling)

The proxy includes intelligent workarounds for tool calling quirks:

**Supported Models:**
- `@cf/qwen/qwen3-30b-a3b-fp8` ✅ Full support
- `@cf/zai-org/glm-4.7-flash` ✅ Full support
- `@hf/nousresearch/hermes-2-pro-mistral-7b` ✅ Full support

**Automatic Fixes:**
- Qwen continuation prompts after tool results
- Error recovery suggestions
- Empty tool_calls array detection
- JSON extraction from text responses

### Streaming Responses

Both Chat Completions and Responses API support Server-Sent Events (SSE) streaming:

```javascript
const response = await fetch('https://your-worker.workers.dev/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [{role: 'user', content: 'Hello'}],
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      const json = JSON.parse(data);
      console.log(json.choices[0].delta.content);
    }
  }
}
```

### Request Normalization

The proxy automatically handles multiple input formats:

**Standard OpenAI:**
```json
{"messages": [{"role": "user", "content": "Hello"}]}
```

**Responses API:**
```json
{"input_items": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hello"}]}]}
```

**Onyx Format:**
```json
{"input": "Hello"}
```

All are normalized to the same internal format for processing.

### Error Handling

Comprehensive error responses with helpful messages:

```json
{
  "error": {
    "message": "Model 'unknown-model' is not a valid embedding model",
    "type": "invalid_request_error",
    "param": "model",
    "code": "invalid_model"
  }
}
```

### Performance Logging

All requests include detailed timing logs:

```
[2026-02-15T10:30:45Z] [v2.1.0] POST /v1/chat/completions
[Chat] Using model: @cf/qwen/qwen3-30b-a3b-fp8 (requested: gpt-4)
[Chat] Tool calling supported: true
[Chat] Request completed in 1234ms
```


## 🚀 Deployment & Configuration

### Prerequisites

- [Cloudflare Account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/cli-wrangler/) installed
- Node.js 16+ or pnpm/bun

### Quick Start

**1. Clone and Install**
```bash
git clone https://github.com/your-repo/openai-to-cloudflare-ai
cd openai-to-cloudflare-ai
pnpm install
```

**2. Configure KV Namespaces**

Edit `wrangler.toml` and create KV namespaces:

```bash
wrangler kv:namespace create CACHE
wrangler kv:namespace create CACHE --preview
```

Update the `id` and `preview_id` in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "your-namespace-id"
preview_id = "your-preview-namespace-id"
```

**3. Deploy**

```bash
pnpm run deploy
```

**4. Generate API Key**

```bash
pnpm run api-key
```

This will:
- Generate a secure random API key
- Save it to `.env` file
- Upload it as a Cloudflare Worker secret

Your API key will look like: `sk-proj-xxxxxxxxxxxxxxxxxxxxx-mlt`

### Configuration Options

**Environment Variables (`wrangler.toml`):**

```toml
[vars]
DEFAULT_AI_MODEL = "@cf/meta/llama-3-8b-instruct"  # Fallback model
```

**Secrets (set via Wrangler):**

```bash
# Required: Your API key for authentication
wrangler secret put API_KEY

# Optional: For dynamic model listing
wrangler secret put CF_API_KEY      # Your Cloudflare API token
wrangler secret put CF_ACCOUNT_ID   # Your Cloudflare account ID
```

**Custom Domain (Optional):**

Add to `wrangler.toml`:
```toml
[dev]
host = "dev-worker.example.com"

routes = [
  { pattern = "api.example.com/*", zone_name = "example.com" }
]
```

### Development Mode

Run locally with hot reload:

```bash
pnpm run dev
```

This starts the worker on `http://localhost:3000` with remote AI binding.

**Test the health endpoint:**
```bash
curl http://localhost:3000/health
```

### Using with OpenAI SDKs

**Python:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://your-worker.workers.dev/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

**Node.js:**
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'https://your-worker.workers.dev/v1'
});

const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{role: 'user', content: 'Hello!'}]
});
console.log(completion.choices[0].message.content);
```

**LangChain:**
```python
from langchain.chat_models import ChatOpenAI

llm = ChatOpenAI(
    model_name="gpt-4",
    openai_api_key="YOUR_API_KEY",
    openai_api_base="https://your-worker.workers.dev/v1"
)

response = llm.predict("What is Cloudflare Workers AI?")
```

**n8n:**
1. Add an OpenAI node
2. Set credentials:
   - API Key: `YOUR_API_KEY`
   - Base URL: `https://your-worker.workers.dev/v1`
3. Select model (e.g., `gpt-4`)
4. Use as normal!

## 🧪 Testing

### Manual Testing

The `scripts/api/` directory contains test scripts for all endpoints:

```bash
# Set environment variables
export CLOUDFLARE_WORKER_URL="https://your-worker.workers.dev"
export API_KEY="your-api-key"

# Or create .env file:
echo "CLOUDFLARE_WORKER_URL=https://your-worker.workers.dev" > .env
echo "API_KEY=your-api-key" >> .env
```

**Available Test Scripts:**

```bash
# Health check (no auth required)
./scripts/api/health.sh

# List models
./scripts/api/models.sh

# Chat completion
./scripts/api/chat-completion.sh

# Streaming chat
./scripts/api/chat-completion-stream.sh

# Tool calling
./scripts/api/tool-call.sh

# Embeddings
./scripts/api/embeddings.sh

# Image generation
./scripts/api/generate-image.sh

# Responses API
./scripts/api/test-responses-api.sh

# Responses API streaming
./scripts/api/test-responses-streaming.sh
```

### Comprehensive Test Suite

Run all tests:

```bash
./scripts/tests/comprehensive-test.sh
```

Test specific features:

```bash
# Tool calling with different models
./scripts/tests/test-tool-calling.sh

# Image generation
./scripts/tests/test-image-generation.sh

# Onyx compatibility
./scripts/tests/test-onyx-compatibility.sh

# Security and authentication
./scripts/tests/test-security.sh
```



## 🏗️ Architecture

### System Design

The proxy uses a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Request                        │
│          (OpenAI SDK, curl, n8n, LangChain, etc.)           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker Edge                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            Authentication Middleware                    │ │
│  │         (Bearer Token Validation)                       │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Request Router                             │ │
│  │  /v1/chat/completions → Chat Handler                    │ │
│  │  /v1/responses → Responses Handler                      │ │
│  │  /v1/embeddings → Embeddings Handler                    │ │
│  │  /v1/images/generations → Image Handler                 │ │
│  │  /v1/models → Models Handler                            │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         Request Transformer                             │ │
│  │  • Model alias resolution (gpt-4 → Qwen)                │ │
│  │  • Format normalization (Onyx, Responses API)           │ │
│  │  • Parameter validation and clamping                    │ │
│  │  • Tool calling workarounds                             │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │        Cloudflare Workers AI Binding                    │ │
│  │            (env.AI.run)                                 │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         Response Parser & Builder                       │ │
│  │  • Extract AI response (text, tool calls)               │ │
│  │  • Build OpenAI-compatible format                       │ │
│  │  • Handle streaming (SSE)                               │ │
│  │  • Add usage stats, timestamps                          │ │
│  └────────────────────────┬───────────────────────────────┘ │
└────────────────────────────┼───────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    OpenAI-Compatible Response                │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

**Handlers** (`src/handlers/`)
- `chat.handler.ts` - Chat completions with tool calling support
- `responses.handler.ts` - Responses API with reasoning
- `responses-streaming.handler.ts` - SSE streaming for Responses API
- `embeddings.handler.ts` - Vector embedding generation
- `image.handler.ts` - Image generation via Flux
- `models.handler.ts` - Model listing and discovery
- `health.handler.ts` - Health checks

**Middleware** (`src/middleware/`)
- `auth.middleware.ts` - Bearer token authentication

**Transformers** (`src/transformers/`)
- `request.transformer.ts` - Request normalization and validation

**Parsers** (`src/parsers/`)
- `response.parser.ts` - AI response extraction and sanitization

**Builders** (`src/builders/`)
- `response.builder.ts` - OpenAI-compatible response construction

**Configuration** (`src/`)
- `constants.ts` - Model aliases, capabilities, limits
- `models.ts` - Static model definitions
- `model-helpers.ts` - Model resolution utilities

### Request Flow

1. **Authentication**: Bearer token validated against `API_KEY` secret
2. **Routing**: URL path determines which handler processes the request
3. **Validation**: Request body validated and normalized
4. **Model Resolution**: OpenAI model name → Cloudflare model ID
5. **Transformation**: Request converted to Cloudflare AI format
6. **Execution**: `env.AI.run()` invoked with model and options
7. **Parsing**: AI response extracted and sanitized
8. **Building**: OpenAI-compatible response constructed
9. **Streaming**: SSE chunks sent if `stream: true`
10. **Response**: JSON returned to client

### Special Handling

**Tool Calling Workarounds**

Qwen models have a quirk where they stop after receiving tool results. The proxy automatically:
- Detects tool messages in conversation
- Adds continuation prompts ("Based on the tool results above...")
- Provides error recovery suggestions
- Extracts JSON from plain text responses

**Request Format Normalization**

Handles three input formats:

1. **Standard OpenAI**: `{"messages": [...]}`
2. **Responses API**: `{"input_items": [...]}`
3. **Onyx**: `{"input": "..."}`

All converted to standard format internally.

**Streaming Implementation**

- Uses `TransformStream` for SSE encoding
- Handles both text and tool_calls deltas
- Proper `[DONE]` termination
- Error handling mid-stream

## 🔐 Security

### Authentication

- **Bearer Token**: All endpoints (except `/health`, `/models/search`) require `Authorization: Bearer <API_KEY>`
- **Secret Storage**: API key stored as Cloudflare Worker secret (encrypted at rest)
- **Key Format**: OpenAI-compatible format `sk-proj-xxxxx-mlt`
- **No Key Warning**: If `API_KEY` not set, worker allows all requests (dev only)

### Best Practices

1. **Never commit `.env`**: API key is in `.env` - add to `.gitignore`
2. **Rotate keys**: Generate new key with `pnpm run api-key`
3. **Use HTTPS**: Workers always serve over HTTPS in production
4. **Rate Limiting**: Consider Cloudflare rate limiting rules for production
5. **CORS**: Configure CORS headers if needed for browser access

### Logging

- **No Sensitive Data**: API keys masked in logs (first 8 chars only)
- **Request Tracking**: Each request logged with timestamp, version, endpoint
- **Performance Metrics**: Duration tracked for all operations
- **Error Details**: Full error messages in responses (development)

## 📊 Limitations & Known Issues

### Cloudflare Workers AI Limitations

1. **Tool Calling**:
   - ❌ GPT-OSS models don't support tools on Workers AI
   - ❌ Llama outputs JSON text instead of structured `tool_calls`
   - ⚠️ Qwen requires continuation prompts after tool results
   - ✅ GLM-4.7-Flash has best tool support

2. **Context Length**:
   - Most models: 2048-8192 tokens
   - Mistral Small: 128K tokens
   - Check `max_tokens` limits per model

3. **Streaming**:
   - Some models may not support streaming
   - Image generation doesn't support streaming

4. **Rate Limits**:
   - Free tier: 10,000 requests/day
   - Paid plans: Higher limits

### Proxy Limitations

1. **Assistants API**: Not implemented (returns 501)
2. **Threads API**: Not implemented (returns 501)
3. **File Uploads**: Not supported
4. **Audio/Vision**: Not implemented
5. **Fine-tuning**: Not applicable

### Workarounds Implemented

- ✅ Qwen tool calling continuation
- ✅ Empty tool_calls array detection
- ✅ Onyx format compatibility
- ✅ Responses API normalization
- ✅ Temperature mapping (0.0-2.0 → 0.0-1.0)
- ✅ GPT-OSS format conversion

## 🎯 Use Cases

### Perfect For

- **n8n Workflows**: Drop-in OpenAI node replacement
- **LangChain Apps**: Use with LangChain's ChatOpenAI
- **RAG Systems**: Embeddings + chat completions
- **Chatbots**: Streaming responses for real-time chat
- **Tool Integration**: Function calling with external APIs
- **Cost Optimization**: Free tier for development/testing
- **Edge Computing**: Low-latency AI at Cloudflare edge

### Example Workflows

**n8n AI Agent**
```
Trigger → OpenAI Chat (your-worker) → Tool Node → OpenAI Chat → Output
```

**RAG Pipeline**
```
1. Generate embeddings: POST /v1/embeddings
2. Store in vector DB
3. Query similar docs
4. Chat with context: POST /v1/chat/completions
```

**Image + Text Generation**
```
1. Generate image: POST /v1/images/generations
2. Analyze image (future feature)
3. Generate caption: POST /v1/chat/completions
```

## 🐛 Troubleshooting

### Common Issues

**401 Unauthorized**
```json
{"error": {"message": "Invalid API key", "type": "invalid_request_error"}}
```
- Check `Authorization: Bearer <API_KEY>` header
- Verify API key matches Cloudflare Worker secret
- Check key format: `sk-proj-...-mlt`

**Model Not Found**
```json
{"error": {"message": "Model 'unknown' not found", "param": "model"}}
```
- Use `GET /v1/models` to list available models
- Check model alias in `constants.ts`
- Use Cloudflare model ID directly (`@cf/...`)

**Tool Calls Not Working**
- Verify model supports tools (Qwen, GLM-4, Hermes)
- Check `tools` array format matches OpenAI spec
- Enable logging: check for "[Chat] Tool calling supported: true"
- Try GLM-4.7-Flash (`gpt-5`) for best results

**Streaming Timeout**
- Some models are slower for streaming
- Check network/proxy timeouts
- Increase client timeout settings

**Empty Response**
- Check request validation errors in logs
- Verify `messages` array not empty
- Check `max_tokens` not too low

### Debug Mode

Enable verbose logging:

```bash
# Check Cloudflare Worker logs
wrangler tail

# Local development
pnpm run dev
# Then check console output
```

### Health Check

```bash
curl https://your-worker.workers.dev/health
```

Expected response:
```json
{"status": "ok", "version": "2.1.0"}
```

## 📝 Version & Release Information

**Current Version**: 2.1.0 (2026-02-15)

### What's New in v2.1.0

- ✅ **Fixed Responses API Streaming**: Corrected `created_at` field and output array format
- ✅ **Enhanced Streaming**: Improved SSE implementation for both Chat and Responses APIs
- ✅ **Better Error Handling**: More informative error messages with recovery suggestions
- ✅ **Performance Improvements**: Optimized request processing and response building

### Key Features Summary

This proxy provides comprehensive OpenAI API compatibility with Cloudflare Workers AI:

| Feature | Status | Notes |
|---------|--------|-------|
| **Chat Completions** | ✅ Full Support | Standard and streaming |
| **Responses API** | ✅ Full Support | With reasoning support |
| **Tool/Function Calling** | ✅ Full Support | Qwen, GLM-4, Hermes models |
| **Text Embeddings** | ✅ Full Support | BGE models, batch processing |
| **Image Generation** | ✅ Full Support | Flux 2 Klein 9B |
| **Model Aliasing** | ✅ Full Support | 20+ OpenAI model mappings |
| **Streaming (SSE)** | ✅ Full Support | Chat & Responses APIs |
| **Bearer Auth** | ✅ Full Support | Secure API key validation |
| **Request Normalization** | ✅ Full Support | Onyx, Responses API, OpenAI formats |
| **Assistants API** | ⏸️ Not Implemented | Returns 501 (requires state management) |
| **Threads API** | ⏸️ Not Implemented | Returns 501 (requires state management) |
| **Audio/Vision** | ⏸️ Not Implemented | Future consideration |

### Changelog

**v2.1.0** - February 15, 2026
- FIX: Responses API streaming format (created_at field, output array)
- Enhanced Responses API compatibility with proper reasoning extraction
- Improved streaming implementation with better error handling
- Added comprehensive logging for debugging

**v2.0.0** - February 14, 2026
- MAJOR: Full Responses API support with reasoning models
- Added support for o1, o3, gpt-5 reasoning models
- Advanced tool calling workarounds for Qwen models
- Request normalization for multiple input formats

**v1.9.30** - February 13, 2026
- Image generation support via Flux models
- Enhanced model aliasing system
- Performance optimizations for request processing

**Earlier Versions**
- v1.x: Initial chat completions, embeddings, basic streaming
- v0.x: Proof of concept and initial development

## 👥 Authors & Credits
- James Gibbard <https://github.com/jgibbarduk>, 2026
- Based on the earlier work of Spas Spasov <https://github.com/pa4080>, 2025
- Based on the idea, provided by Jack Culpan <https://github.com/jackculpan>

## References

- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Cloudflare AI Models Reference](https://developers.cloudflare.com/workers-ai/models)
- [Cloudflare AI SDK](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/)
- [Cloudflare OpenAI compatible API endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/get-started/embeddings/)
- [Cloudflare Agents](https://developers.cloudflare.com/agents/)
- [DeepSeek: Helping with OpenAI to CfWorkerAI Part1](https://chat.deepseek.com/a/chat/s/71155bf0-ee66-46a4-9599-ab074c39e447)
- [DeepSeek: Helping with OpenAI to CfWorkerAI Part2](https://chat.deepseek.com/a/chat/s/38512169-41af-4a4b-8e8f-b3c1b0affa07)
- [DeepSeek: Helping with OpenAI to CfWorkerAI Part3](hhttps://chat.deepseek.com/a/chat/s/bc1f4584-b831-4364-9b5a-775f740c866d)
- [Grok: Helping with OpenAI to CfWorkerAI Part1](https://grok.com/share/bGVnYWN5_4b174cf5-98ab-41b0-902c-621dbcf6150e)

## License

MIT
