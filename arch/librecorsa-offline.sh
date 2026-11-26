#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/usr/lib/librecorsa-offline"
export LIBRECORSA_WEB_DIR="${APP_DIR}/web"

# Optional user-supplied Chromium/Electron flags (standard Arch Linux convention)
FLAGS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/librecorsa-offline-flags.conf"
USER_FLAGS=()
if [[ -f "${FLAGS_FILE}" ]]; then
  while IFS= read -r line; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    USER_FLAGS+=("${line}")
  done < "${FLAGS_FILE}"
fi

exec electron "${APP_DIR}" "${USER_FLAGS[@]}" "$@"
