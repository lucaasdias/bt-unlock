#!/bin/sh
# bt-connect.sh <address> <profile>
#   Connects an already-paired device at <address> over <profile>
#   (hid|a2dp — the two profiles classify() in js/devices.js ever returns).
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

address="$1"
profile="$2"

case "$profile" in
  hid|a2dp)
    ;;
  *)
    log "bt-connect.sh: unsupported profile '$profile'"
    exit 1
    ;;
esac

if [ -z "$address" ]; then
  log "bt-connect.sh: missing address argument"
  exit 1
fi

log "bt-connect.sh: connecting $address over $profile"
run_luna "luna://com.webos.service.bluetooth2/$profile/connect" 1 '{"address":"'"$address"'"}'
