#!/usr/bin/env bash
set -euo pipefail

INPUT_APK="$1"
WEBSITE_URL="$2"
WEBSITE_ZIP="$3"
OUTPUT_APK="$4"

WORK_ROOT="$(dirname "$OUTPUT_APK")/workspace_$(date +%s)"
DECOMPILED_DIR="$WORK_ROOT/decompiled"
UNSIGNED_APK="$WORK_ROOT/repacked-unsigned.apk"
ALIGNED_APK="$WORK_ROOT/aligned.apk"

# Keystore config (apne environment variable ya default path se aayega)
KEYSTORE_PATH="${KEYSTORE_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/debug.keystore}"
KEY_ALIAS="${KEY_ALIAS:-androiddebugkey}"
KEY_PASS="${KEY_PASS:-android}"

mkdir -p "$WORK_ROOT"

# 1. Base APK decode karein
apktool d -f -o "$DECOMPILED_DIR" "$INPUT_APK"

# 2. Web assets / config folder taiyar karein
WEB_TARGET_DIR="$DECOMPILED_DIR/assets/web_bundle"
mkdir -p "$WEB_TARGET_DIR"

if [ -n "$WEBSITE_ZIP" ] && [ -f "$WEBSITE_ZIP" ]; then
  unzip -o "$WEBSITE_ZIP" -d "$WEB_TARGET_DIR" >/dev/null
fi

if [ -n "$WEBSITE_URL" ]; then
  cat > "$WEB_TARGET_DIR/web_config.json" <<EOF
{
  "websiteUrl": "$WEBSITE_URL",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
fi

# 3. APK ko wapas build karein
apktool b -o "$UNSIGNED_APK" "$DECOMPILED_DIR"

# 4. zipalign + apksigner se sign karein
zipalign -p -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"

apksigner sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-pass "pass:$KEY_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --ks-alias "$KEY_ALIAS" \
  --out "$OUTPUT_APK" \
  "$ALIGNED_APK"

# 5. Temp build folder saaf karein
rm -rf "$WORK_ROOT"
