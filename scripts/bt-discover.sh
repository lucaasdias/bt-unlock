#!/bin/sh
# bt-discover.sh <start>
#   start   Kicks off discovery and returns a single device-list snapshot.
#           Not a subscription: `exec` is a single blocking call, so the
#           JS side (js/screens/discover.js) calls this on a ~2s timer to
#           poll instead, per the architecture's polling decision.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

case "$1" in
  start)
    log "bt-discover.sh start: starting discovery and snapshotting device list"
    run_luna luna://com.webos.service.bluetooth2/adapter/startDiscovery 1 '{}'
    run_luna luna://com.webos.service.bluetooth2/device/getStatus 1 '{}'
    ;;
  *)
    log "bt-discover.sh: unknown subcommand '$1'"
    exit 1
    ;;
esac
