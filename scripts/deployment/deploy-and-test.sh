#!/bin/bash
# Deploy and run regression tests
# Usage: ./scripts/deployment/deploy-and-test.sh

set -euo pipefail

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Deploying to Cloudflare Workers...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Deploy
npx wrangler deploy

echo ""
echo -e "${GREEN}✓ Deployment complete${NC}"
echo ""

# Wait a moment for deployment to propagate
echo "Waiting 5 seconds for deployment to propagate..."
sleep 5

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Running Regression Test Suite...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Run tests
./scripts/tests/test-regression.sh --verbose

exit $?
