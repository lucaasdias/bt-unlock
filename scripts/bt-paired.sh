#!/bin/sh
# bt-paired.sh
#   Returns a single device/getStatus snapshot — the same reply shape
#   bt-discover.sh's `start` subcommand's second call returns
#   ({devices:[{name, address, classOfDevice, paired, connectedProfiles,
#   ...}]}, confirmed live against the real TV, see task-5-report.md) —
#   but without calling adapter/startDiscovery first. The paired-devices
#   screen (js/screens/paired.js) only needs the already-known device
#   list, not a scan, so it uses this dedicated script instead of
#   bt-discover.sh.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

log "bt-paired.sh: snapshotting device list"
run_luna luna://com.webos.service.bluetooth2/device/getStatus 1 '{}'
