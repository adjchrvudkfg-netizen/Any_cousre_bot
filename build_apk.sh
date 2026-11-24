name: Build Updated APK

on:
  workflow_dispatch:
    inputs:
      apk_url:
        description: "Direct download URL for base .apk (up to 1 GB)"
        required: true
        type: string
      website_url:
        description: "Website URL (optional)"
        required: false
        type: string
      website_zip_url:
        description: "Direct download URL for website .zip (optional)"
        required: false
        type: string
      tag_name:
        description: "Release tag name"
        required: true
        type: string

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Install Android build tools
        run: |
          sudo apt-get update
          sudo apt-get install -y apktool zipalign apksigner unzip curl openjdk-17-jdk-headless

      - name: Prepare keystore
        run: |
          if [ -n "${{ secrets.KEYSTORE_BASE64 }}" ]; then
            echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > release.keystore
          else
            keytool -genkeypair -v -keystore release.keystore -alias androiddebugkey \
              -keyalg RSA -keysize 2048 -validity 10000 \
              -storepass android -keypass android \
              -dname "CN=Builder, OU=Dev, O=GitHub, L=City, S=State, C=IN"
          fi

      - name: Download inputs (up to 1 GB each) and build APK
        env:
          KEYSTORE_PATH: ${{ github.workspace }}/release.keystore
          KEY_ALIAS: ${{ secrets.KEY_ALIAS || 'androiddebugkey' }}
          KEY_PASS: ${{ secrets.KEY_PASS || 'android' }}
          MAX_BYTES: "1073741824"
        run: |
          mkdir -p work out

          curl -fSL --max-filesize "$MAX_BYTES" "${{ inputs.apk_url }}" -o work/input.apk

          ZIP_PATH=""
          if [ -n "${{ inputs.website_zip_url }}" ]; then
            curl -fSL --max-filesize "$MAX_BYTES" "${{ inputs.website_zip_url }}" -o work/website.zip
            ZIP_PATH="work/website.zip"
          fi

          chmod +x build_apk.sh
          ./build_apk.sh "work/input.apk" "${{ inputs.website_url }}" "$ZIP_PATH" "out/updated-app.apk"

      - name: Publish to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ inputs.tag_name }}
          files: out/updated-app.apk
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
