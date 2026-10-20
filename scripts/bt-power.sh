#!/bin/sh
# bt-power.sh <on|status>
#   on      Powers the Bluetooth adapter on.
#   status  Reports the adapter's current status (includes "powered").
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

case "$1" in
  on)
    log "bt-power.sh on: powering adapter on"
    run_luna luna://com.webos.service.bluetooth2/adapter/setState 1 '{"powered":true}'
    ;;
  status)
    log "bt-power.sh status: querying adapter status"
    run_luna luna://com.webos.service.bluetooth2/adapter/getStatus 1 '{}'
    ;;
  *)
    log "bt-power.sh: unknown subcommand '$1'"
    exit 1
    ;;
esac
