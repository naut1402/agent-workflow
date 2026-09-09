#!/bin/sh
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

NODE_EXTRA_CA_CERTS=
SSL_CERT_FILE=
REQUESTS_CA_BUNDLE=
CURL_CA_BUNDLE=

# Parse manifest as KEY=value data — never source as shell (host basenames).
is_safe_ca_basename() {
  case "$1" in
    ''|.*|*/*|*\\*|*"'"*|*'\"'*|*$'\n'*) return 1 ;;
  esac
  case "$1" in
    *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

if [ -f "$MANIFEST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key=${line%%=*}
    val=${line#*=}
    case "$key" in
      NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE) ;;
      *) continue ;;
    esac
    if ! is_safe_ca_basename "$val"; then
      echo "[corp-ca] WARNING: reject unsafe manifest value for $key: $val" >&2
      continue
    fi
    case "$key" in
      NODE_EXTRA_CA_CERTS) NODE_EXTRA_CA_CERTS=$val ;;
      SSL_CERT_FILE) SSL_CERT_FILE=$val ;;
      REQUESTS_CA_BUNDLE) REQUESTS_CA_BUNDLE=$val ;;
      CURL_CA_BUNDLE) CURL_CA_BUNDLE=$val ;;
    esac
  done < "$MANIFEST"
fi

resolve_under_corp() {
  var_name="$1"
  eval "val=\${$var_name:-}"
  [ -n "$val" ] || return 0
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
  if ! is_safe_ca_basename "$val"; then
    echo "[corp-ca] WARNING: $var_name unsafe basename: $val" >&2
    eval "$var_name="
    return 0
  fi
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

if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$NODE_EXTRA_CA_CERTS" ]; then
  printf "export NODE_EXTRA_CA_CERTS='%s'\n" "$NODE_EXTRA_CA_CERTS" >> "$ENV_SH"
  echo "[corp-ca] env NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS"
fi

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
