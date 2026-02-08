#!/bin/bash
# Health check endpoint
# Usage: ./scripts/api/health.sh

. "$(dirname "$0")/../helpers/common.sh"

make_request GET "/health" ""
