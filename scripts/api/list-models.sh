#!/bin/bash
# List available models
# Usage: ./scripts/api/list-models.sh

. "$(dirname "$0")/../helpers/common.sh"

make_request GET "/v1/models" ""
