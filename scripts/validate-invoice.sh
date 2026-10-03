#!/usr/bin/env bash
# Validate a ZUGFeRD / Factur-X PDF or an XRechnung XML with the Mustang validator
# (EN16931 schematron, XSD, PDF/A-3 via veraPDF). Downloads a portable Java runtime
# and the Mustang CLI into ~/.cache/hoteloftware-validator on first use; nothing is installed system-wide.
# Usage: scripts/validate-invoice.sh invoice.pdf|invoice.xml
set -euo pipefail
FILE="${1:?usage: scripts/validate-invoice.sh <invoice.pdf|invoice.xml>}"
CACHE="${HOME}/.cache/hoteloftware-validator"
MUSTANG_VERSION="2.26.0"
mkdir -p "$CACHE"
if [ ! -f "$CACHE/mustang.jar" ]; then
  curl -sSL -o "$CACHE/mustang.jar" "https://github.com/ZUGFeRD/mustangproject/releases/download/core-${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar"
fi
JAVA="$(command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1 && command -v java || true)"
if [ -z "$JAVA" ]; then
  JAVA="$(find "$CACHE" -path '*/bin/java' -type f 2>/dev/null | head -1)"
  if [ -z "$JAVA" ]; then
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) OS=mac; ARCH=aarch64 ;;
      Darwin-x86_64) OS=mac; ARCH=x64 ;;
      Linux-x86_64) OS=linux; ARCH=x64 ;;
      Linux-aarch64) OS=linux; ARCH=aarch64 ;;
      *) echo "No Java found and no portable runtime for $(uname -sm)" >&2; exit 2 ;;
    esac
    URL="$(curl -sSL "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${ARCH}&image_type=jre&os=${OS}" | grep -o '"link": "[^"]*\.tar\.gz"' | head -1 | cut -d'"' -f4)"
    curl -sSL "$URL" | tar xz -C "$CACHE"
    JAVA="$(find "$CACHE" -path '*/bin/java' -type f | head -1)"
  fi
fi
OUT="$("$JAVA" -jar "$CACHE/mustang.jar" --action validate --source "$FILE" --no-notices 2>/dev/null)"
echo "$OUT" | grep -E '<error|<warning|summary status' || true
if echo "$OUT" | grep -q 'status="invalid"'; then echo "INVALID: $FILE"; exit 1; fi
echo "VALID: $FILE"
