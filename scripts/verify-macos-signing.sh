#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path-to-.app-or-.dmg>" >&2
  exit 1
fi

TARGET_PATH="$1"
REQUIRE_NOTARIZED="${LINGXI_REQUIRE_NOTARIZED:-1}"
EXPECTED_BUNDLE_ID="${LINGXI_EXPECTED_BUNDLE_ID:-dev.lingxifox.t3code}"

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
  echo "[verify-macos-signing] Verifying DMG container: $TARGET_PATH"
  codesign --verify --verbose=2 "$TARGET_PATH"
  if [[ "$REQUIRE_NOTARIZED" == "1" ]]; then
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
if ! grep -q "owner: LingXiFox" "$APP_UPDATE_YML"; then
  echo "app-update.yml does not point to LingXiFox:" >&2
  cat "$APP_UPDATE_YML" >&2
  exit 1
fi
echo "[verify-macos-signing] app-update.yml OK"

STAGED_PKG_JSON="$RESOURCES_DIR/app.asar.unpacked/package.json"
if [[ ! -f "$STAGED_PKG_JSON" ]]; then
  # electron-builder may keep package.json inside app.asar; check asar or unpacked if present
  echo "[verify-macos-signing] Checking app.asar for lingxiUnsignedMacBuild marker..."
  if grep -qa "lingxiUnsignedMacBuild" "$RESOURCES_DIR/app.asar"; then
    echo "Signed build must not contain lingxiUnsignedMacBuild=true" >&2
    exit 1
  fi
elif grep -q '"lingxiUnsignedMacBuild": true' "$STAGED_PKG_JSON"; then
  echo "Signed build must not contain lingxiUnsignedMacBuild=true" >&2
  exit 1
fi

if [[ "$REQUIRE_NOTARIZED" == "1" ]]; then
  echo "[verify-macos-signing] Checking Gatekeeper & stapled notarization ticket..."
  spctl --assess --type execute --verbose=4 "$APP_PATH"
  xcrun stapler validate "$APP_PATH"
fi

echo "[verify-macos-signing] All macOS signing checks passed for $TARGET_PATH"
