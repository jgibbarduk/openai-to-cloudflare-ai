# Testing Guide

## Running Tests

### Quick Start

```bash
# Start local dev server (required for tests)
npm run dev

# In another terminal, run tests
bash scripts/tests/comprehensive-test.sh
```

### Test Modes

#### 1. Local Development Testing (Default)
Tests against `localhost:8787` with no authentication required:

```bash
bash scripts/tests/comprehensive-test.sh
```

#### 2. Production Testing
Tests against deployed worker with API key:

```bash
WORKER_URL=https://your-worker.workers.dev \
API_KEY=your-api-key \
bash scripts/tests/comprehensive-test.sh
```

### Prerequisites

1. **Wrangler Dev Server**: Must be running (uses remote AI binding)
   ```bash
   npx wrangler dev --port 8787
   ```
   
2. **No Local Mode**: Do NOT use `--local` flag as it doesn't support AI binding

### Test Coverage

The comprehensive test suite covers:

- ✅ Health checks
- ✅ Model listing
- ✅ Chat completions (multiple models)
- ✅ Model aliasing (gpt-4 → Qwen)
- ✅ Message validation
- ✅ Streaming responses
- ✅ Tool calling
- ✅ Tool compatibility
- ✅ Parameter handling
- ✅ Error handling (when auth is enabled)

### Troubleshooting

#### "Binding AI needs to be run remotely"
- **Cause**: Using `--local` flag
- **Fix**: Remove `--local` flag from `wrangler dev`

#### "HTTP 401" errors in production
- **Cause**: Missing or incorrect API_KEY
- **Fix**: Set correct API_KEY environment variable

#### "Connection refused" on localhost:8787
- **Cause**: Dev server not running
- **Fix**: Start dev server with `npx wrangler dev --port 8787`

### CI/CD Integration

For automated testing in CI/CD pipelines:

```bash
# Start dev server in background
npx wrangler dev --port 8787 &
DEV_PID=$!

# Wait for server to start
sleep 5

# Run tests
bash scripts/tests/comprehensive-test.sh

# Cleanup
kill $DEV_PID
```

### Test Files

- `scripts/tests/comprehensive-test.sh` - Full test suite
- `scripts/tests/test-*.sh` - Individual test scripts
- `scripts/api/*.sh` - Manual API testing scripts

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_URL` | `http://localhost:8787` | Worker endpoint URL |
| `API_KEY` | _(empty)_ | API key for authentication (optional in dev) |

### Development Workflow

1. Make changes to code
2. Dev server auto-reloads
3. Run tests to verify
4. Repeat until all tests pass

### Current Test Status

```
╔════���═══════════════════════════════════════════════════════╗
║ Passed: 12                                              ║
║ Failed: 0                                              ║
║ Total:  12                                              ║
╚════════════════════════════════════════════════════════════╝

✓ All tests passed!
```

