#!/bin/bash
# Common helper functions for API scripts
# Sourced by all API test scripts

# Load environment
if [[ -f ".env" ]]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Configuration
WORKER_URL="${CLOUDFLARE_WORKER_URL:-https://ai-forwarder.james-gibbard.workers.dev}"
API_KEY="${API_KEY:?Error: API_KEY not set}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

##############################################################################
# Request Functions
##############################################################################

make_request() {
  local method="$1"
  local endpoint="$2"
  local data="$3"

  if [[ "$method" == "POST" || "$method" == "PUT" ]]; then
    curl -s -X "$method" \
      "${WORKER_URL}${endpoint}" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$data" | jq .
  else
    curl -s -X "$method" \
      "${WORKER_URL}${endpoint}" \
      -H "Authorization: Bearer $API_KEY" | jq .
  fi
}

make_request_stream() {
  local method="$1"
  local endpoint="$2"
  local data="$3"

  echo -e "${BLUE}[Streaming Response]${NC}"
  echo ""

  curl -s -X "$method" \
    "${WORKER_URL}${endpoint}" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$data"

  echo ""
  echo -e "${BLUE}[End of Stream]${NC}"
}

##############################################################################
# Logging Functions
##############################################################################

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_header() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo ""
}
