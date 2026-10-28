#!/bin/bash
set -euo pipefail

EXPECTED_BUNDLE_ID="sa.nasjalufuq.basira"
if [[ "${BASIRA_BUNDLE_ID:?Codemagic must set BASIRA_BUNDLE_ID}" != "$EXPECTED_BUNDLE_ID" ]]; then
  echo "Codemagic Bundle ID does not match the registered App ID" >&2
  exit 1
fi
IPA_DIR="${CM_BUILD_DIR:?}/build/ios/ipa"
IPA_PATH="$(find "$IPA_DIR" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
if [[ -z "$IPA_PATH" ]]; then
  echo "No signed IPA was produced in $IPA_DIR" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
unzip -q "$IPA_PATH" -d "$TEMP_DIR"
APP_DIR="$(find "$TEMP_DIR/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$APP_DIR" || ! -f "$APP_DIR/embedded.mobileprovision" ]]; then
  echo "IPA is missing its app bundle or embedded provisioning profile" >&2
  exit 1
fi

ACTUAL_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_DIR/Info.plist")"
if [[ "$ACTUAL_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]]; then
  echo "IPA Bundle ID mismatch: $ACTUAL_BUNDLE_ID" >&2
  exit 1
fi

codesign --verify --deep --strict "$APP_DIR"
PROFILE_PLIST="$TEMP_DIR/profile.plist"
security cms -D -i "$APP_DIR/embedded.mobileprovision" > "$PROFILE_PLIST"
PROFILE_TEAM="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$PROFILE_PLIST")"
PROFILE_APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$PROFILE_PLIST")"
SIGNED_TEAM="$(codesign -dv --verbose=4 "$APP_DIR" 2>&1 | awk -F= '$1 == "TeamIdentifier" { print $2; exit }')"
if [[ -z "$PROFILE_TEAM" || "$SIGNED_TEAM" != "$PROFILE_TEAM" || "$PROFILE_APP_ID" != "$PROFILE_TEAM.$EXPECTED_BUNDLE_ID" ]]; then
  echo "IPA signing team or provisioning profile does not match the registered App ID" >&2
  exit 1
fi

echo "Verified signed IPA for $EXPECTED_BUNDLE_ID with matching Apple team and profile."
