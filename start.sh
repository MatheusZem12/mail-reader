#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/source"

# Makes sure Electron doesn't run in "Node.js only" mode.
export ELECTRON_RUN_AS_NODE=

npm start
