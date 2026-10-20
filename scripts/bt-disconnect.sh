#!/bin/sh
# bt-disconnect.sh <address> <profile>
#   Disconnects an already-connected device at <address> over <profile>
#   (hid|a2dp — the two profiles classify() in js/devices.js ever returns).
#   Mirrors bt-connect.sh.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

address="$1"
profile="$2"

case "$profile" in
  hid|a2dp)
    ;;
  *)
    log "bt-disconnect.sh: unsupported profile '$profile'"
    exit 1
    ;;
esac

if [ -z "$address" ]; then
  log "bt-disconnect.sh: missing address argument"
  exit 1
fi

log "bt-disconnect.sh: disconnecting $address over $profile"
run_luna "luna://com.webos.service.bluetooth2/$profile/disconnect" 1 '{"address":"'"$address"'"}'
