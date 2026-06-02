#!/usr/bin/env bash
set -euo pipefail

PROFILE=/tmp/browser-harness-chromium-profile
PORT=${BROWSER_HARNESS_CHROMIUM_PORT:-9222}
mkdir -p "$PROFILE"

if python3 - <<PY >/dev/null 2>&1
import urllib.request
urllib.request.urlopen('http://127.0.0.1:${PORT}/json/version', timeout=1).read()
PY
then
  echo "local Chromium CDP already listening on 127.0.0.1:${PORT}"
  exit 0
fi

nohup chromium-browser \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  about:blank \
  > /tmp/browser-harness-chromium.log 2>&1 &

for _ in $(seq 1 40); do
  if python3 - <<PY >/dev/null 2>&1
import urllib.request
urllib.request.urlopen('http://127.0.0.1:${PORT}/json/version', timeout=1).read()
PY
  then
    echo "started local Chromium CDP on 127.0.0.1:${PORT} with profile $PROFILE"
    exit 0
  fi
  sleep 0.25
done

echo "failed to start local Chromium CDP; see /tmp/browser-harness-chromium.log" >&2
exit 1
