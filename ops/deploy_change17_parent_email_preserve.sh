#!/usr/bin/env bash
set -euo pipefail

# Compatibility shim retained for historical callers only.
# The shared production Worker must always deploy through the canonical composed
# entrypoint and binding-preservation script. In particular, do not deploy the
# Phase 23 wrapper directly: doing so removes the Admin/Quiz outer composition
# and omits READ_MODELS_KV, which breaks lesson-release reconciliation.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/deploy_current_worker_preserve.sh"
