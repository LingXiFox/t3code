#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path-to-.app-or-.dmg>" >&2
  exit 1
fi

TARGET_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIRE_NOTARIZED="${LINGXI_REQUIRE_NOTARIZED:-1}"
REQUIRE_DMG_NOTARIZED="${LINGXI_REQUIRE_DMG_NOTARIZED:-0}"
EXPECTED_BUNDLE_ID="${LINGXI_EXPECTED_BUNDLE_ID:-com.lingxifox.lingxit3}"

if [[ ! -e "$TARGET_PATH" ]]; then
  echo "Target not found: $TARGET_PATH" >&2
  exit 1
fi

MOUNT_POINT=""
cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
}
trap cleanup EXIT

APP_PATH=""
if [[ "$TARGET_PATH" == *.dmg ]]; then
  echo "[verify-macos-signing] Mounting DMG to inspect signed app bundle: $TARGET_PATH"
  if [[ "$REQUIRE_DMG_NOTARIZED" == "1" ]]; then
    codesign --verify --verbose=2 "$TARGET_PATH"
    xcrun stapler validate "$TARGET_PATH"
    spctl --assess --type open --context context:primary-signature --verbose=4 "$TARGET_PATH"
  fi
  MOUNT_POINT="$(mktemp -d)"
  hdiutil attach "$TARGET_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT" -quiet
  APP_PATH="$(find "$MOUNT_POINT" -maxdepth 2 -name "*.app" -print -quit)"
  if [[ -z "$APP_PATH" ]]; then
    echo "No .app bundle found inside DMG: $TARGET_PATH" >&2
    exit 1
  fi
else
  APP_PATH="$TARGET_PATH"
fi

echo "[verify-macos-signing] Inspecting app bundle: $APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

CODESIGN_INFO="$(codesign -dvv "$APP_PATH" 2>&1)"
if ! grep -q "Authority=Developer ID Application:" <<<"$CODESIGN_INFO"; then
  echo "App bundle is not signed with a Developer ID Application certificate:" >&2
  echo "$CODESIGN_INFO" >&2
  exit 1
fi
if ! grep -Eq 'flags=0x[0-9a-fA-F]+\([^)]*runtime[^)]*\)' <<<"$CODESIGN_INFO"; then
  echo "App bundle does not have Hardened Runtime enabled:" >&2
  echo "$CODESIGN_INFO" >&2
  exit 1
fi
echo "[verify-macos-signing] Developer ID Application + Hardened Runtime OK"

INFO_PLIST="$APP_PATH/Contents/Info.plist"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST")"
if [[ "$BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]]; then
  echo "Unexpected CFBundleIdentifier: expected '$EXPECTED_BUNDLE_ID', got '$BUNDLE_ID'" >&2
  exit 1
fi
echo "[verify-macos-signing] CFBundleIdentifier OK: $BUNDLE_ID"

RESOURCES_DIR="$APP_PATH/Contents/Resources"
APP_UPDATE_YML="$RESOURCES_DIR/app-update.yml"
if [[ ! -f "$APP_UPDATE_YML" ]]; then
  echo "Missing app-update.yml at $APP_UPDATE_YML" >&2
  exit 1
fi
if ! grep -q "owner: LingXiFox" "$APP_UPDATE_YML" || ! grep -q "repo: t3code" "$APP_UPDATE_YML"; then
  echo "app-update.yml does not point to LingXiFox/t3code:" >&2
  cat "$APP_UPDATE_YML" >&2
  exit 1
fi
echo "[verify-macos-signing] app-update.yml OK"

APP_ASAR="$RESOURCES_DIR/app.asar"
if [[ ! -f "$APP_ASAR" ]]; then
  echo "Missing app.asar at $APP_ASAR" >&2
  exit 1
fi
node "$SCRIPT_DIR/verify-macos-asar-manifest.ts" \
  "$APP_ASAR" \
  --unpacked-package-json "$RESOURCES_DIR/app.asar.unpacked/package.json"

if [[ "$REQUIRE_NOTARIZED" == "1" ]]; then
  echo "[verify-macos-signing] Checking Gatekeeper & stapled notarization ticket..."
  spctl --assess --type execute --verbose=4 "$APP_PATH"
  xcrun stapler validate "$APP_PATH"
fi

echo "[verify-macos-signing] All macOS signing checks passed for $TARGET_PATH"
