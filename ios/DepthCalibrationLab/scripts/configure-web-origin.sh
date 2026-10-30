#!/usr/bin/env bash
set -euo pipefail

# Only an owner-approved origin may be supplied. No network, build or upload.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"${BASIRA_PYTHON_BIN:-python3}" "$script_dir/configure_web_origin.py" "$@"
