#!/usr/bin/env bash
set -euo pipefail

# An iOS archive must point to the owner's VERIFIED HTTPS production/staging
# Basira origin. Never guess a URL from older preview documentation.
origin="${BASIRA_IOS_WEB_ORIGIN:-}"
require="${BASIRA_REQUIRE_WEB_ORIGIN:-false}"
plist="ios/DepthCalibrationLab/DepthCalibrationLab/Info.plist"

if [[ -z "$origin" ]]; then
  if [[ "$require" == "true" ]]; then
    echo "ERROR: BASIRA_IOS_WEB_ORIGIN must be set to the owner-verified HTTPS Basira origin for unified TestFlight." >&2
    exit 1
  fi
  echo "Basira web modules disabled for this simulator/signing-only build (no verified HTTPS origin)."
  exit 0
fi

# URL must be an origin only. Do not allow tokens, fragments, paths, ports or
# local/example domains. The same rule is checked by BasiraWebOrigin in Swift.
python3 - "$origin" <<'PY'
import sys
from urllib.parse import urlsplit
value = sys.argv[1]
p = urlsplit(value)
host = (p.hostname or "").lower()
if (
    value.strip() != value
    or any(c.isspace() for c in value)
    or p.scheme.lower() != "https"
    or not host
    or p.username is not None
    or p.password is not None
    or p.port is not None
    or p.path not in ("", "/")
    or p.query or p.fragment
    or host == "localhost"
    or host.endswith((".example", ".local"))
):
    raise SystemExit("ERROR: BASIRA_IOS_WEB_ORIGIN must be an HTTPS origin without path, port, credentials or query.")
PY

test -f "$plist" || { echo "ERROR: Basira Info.plist not found" >&2; exit 1; }
/usr/libexec/PlistBuddy -c "Set :BasiraWebBaseURL $origin" "$plist"
echo "Configured Basira public web origin for native iOS feature hub."
