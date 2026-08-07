#!/bin/sh
# Install staged corporate CA files into the system trust store + write env.sh.
# Expects certs at /etc/ssl/corp-ca/ (placeholders like .gitkeep ignored).
# Optional manifest.env maps env var → basename only (no absolute /etc paths —
# those get mangled by Git Bash/MSYS when passed as Docker build-args).
#   NODE_EXTRA_CA_CERTS=Fortinet_RV1_CA_SSL.cer
#   SSL_CERT_FILE=python-custom-ca-bundle.pem
set -eu

CORP_DIR="${CORP_CA_DIR:-/etc/ssl/corp-ca}"
MAX_SYSTEM_CA_BYTES="${CORP_CA_SYSTEM_MAX_BYTES:-65536}"
MANIFEST="$CORP_DIR/manifest.env"

mkdir -p "$CORP_DIR" /usr/local/share/ca-certificates
rm -f "$CORP_DIR/.gitkeep"

found=0
for f in "$CORP_DIR"/*; do
  [ -e "$f" ] || continue
  [ -f "$f" ] || continue
  base=$(basename "$f")
  case "$base" in
    .gitkeep|README|README.*|manifest.env|build-args.env|env.sh|runtime-*.pem) continue ;;
  esac

  size=$(wc -c < "$f" | tr -d ' ')
  # Skip huge bundles for system store (wired via SSL_CERT_FILE instead).
  if [ "$size" -gt "$MAX_SYSTEM_CA_BYTES" ]; then
    echo "[corp-ca] skip system-store (bundle ${size}B): $base"
    found=1
    continue
  fi

  dest="/usr/local/share/ca-certificates/corp-${base%.*}.crt"
  if grep -q "BEGIN CERTIFICATE" "$f" 2>/dev/null; then
    cp "$f" "$dest"
  elif command -v openssl >/dev/null 2>&1; then
    openssl x509 -inform DER -in "$f" -out "$dest"
  else
    echo "[corp-ca] WARNING: cannot convert DER $base (no openssl)" >&2
    continue
  fi
  echo "[corp-ca] system-store += $base"
  found=1
done

if [ "$found" = "1" ]; then
  update-ca-certificates
  echo "[corp-ca] update-ca-certificates done"
else
  echo "[corp-ca] no corporate CA staged — skip"
fi

# Resolve manifest basenames → absolute paths under CORP_DIR.
NODE_EXTRA_CA_CERTS=
SSL_CERT_FILE=
REQUESTS_CA_BUNDLE=
CURL_CA_BUNDLE=
if [ -f "$MANIFEST" ]; then
  # shellcheck disable=SC1090
  . "$MANIFEST"
fi

resolve_under_corp() {
  var_name="$1"
  eval "val=\${$var_name:-}"
  [ -n "$val" ] || return 0
  # Basename only (preferred). Absolute path accepted only if it exists in-image
  # (never trust Windows/MSYS-mangled C:/Program Files/Git/etc/... paths).
  case "$val" in
    /*)
      if [ -f "$val" ]; then
        return 0
      fi
      val=$(basename "$val")
      ;;
    [A-Za-z]:/*|[A-Za-z]:\\*)
      val=$(basename "$val" | tr '\\' '/')
      val=$(basename "$val")
      ;;
  esac
  if [ -f "$CORP_DIR/$val" ]; then
    eval "$var_name=\"\$CORP_DIR/\$val\""
  else
    echo "[corp-ca] WARNING: $var_name file missing: $val" >&2
    eval "$var_name="
  fi
}

resolve_under_corp NODE_EXTRA_CA_CERTS
resolve_under_corp SSL_CERT_FILE
resolve_under_corp REQUESTS_CA_BUNDLE
resolve_under_corp CURL_CA_BUNDLE

ENV_SH="$CORP_DIR/env.sh"
: > "$ENV_SH"

# NODE_EXTRA_CA_CERTS → file as-is (Node appends to its default store).
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$NODE_EXTRA_CA_CERTS" ]; then
  printf "export NODE_EXTRA_CA_CERTS='%s'\n" "$NODE_EXTRA_CA_CERTS" >> "$ENV_SH"
  echo "[corp-ca] env NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS"
fi

# SSL_CERT_FILE / REQUESTS_CA_BUNDLE / CURL_CA_BUNDLE must include corp MITM CA.
# Host bundles (e.g. certifi) often omit Fortinet — prepend NODE_EXTRA when present.
prepend_extra_if_needed() {
  var_name="$1"
  eval "src=\${$var_name:-}"
  [ -n "$src" ] && [ -f "$src" ] || return 0

  out="$CORP_DIR/runtime-${var_name}.pem"
  extra="${NODE_EXTRA_CA_CERTS:-}"
  if [ -n "$extra" ] && [ -f "$extra" ] && [ "$src" != "$extra" ]; then
    cat "$extra" "$src" > "$out"
  else
    cp "$src" "$out"
  fi
  printf "export %s='%s'\n" "$var_name" "$out" >> "$ENV_SH"
  echo "[corp-ca] env $var_name=$out"
}

prepend_extra_if_needed SSL_CERT_FILE
prepend_extra_if_needed REQUESTS_CA_BUNDLE
prepend_extra_if_needed CURL_CA_BUNDLE

# If only NODE_EXTRA is set, point OpenSSL/curl at the updated system bundle.
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$NODE_EXTRA_CA_CERTS" ]; then
  if ! grep -q '^export SSL_CERT_FILE=' "$ENV_SH" 2>/dev/null; then
    printf "export SSL_CERT_FILE='%s'\n" "/etc/ssl/certs/ca-certificates.crt" >> "$ENV_SH"
    echo "[corp-ca] env SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt (system)"
  fi
  if ! grep -q '^export CURL_CA_BUNDLE=' "$ENV_SH" 2>/dev/null; then
    printf "export CURL_CA_BUNDLE='%s'\n" "/etc/ssl/certs/ca-certificates.crt" >> "$ENV_SH"
    echo "[corp-ca] env CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt (system)"
  fi
fi

if [ ! -s "$ENV_SH" ]; then
  echo "[corp-ca] env.sh empty (no host CA env)"
fi
