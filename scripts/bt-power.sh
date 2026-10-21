#!/bin/sh
# bt-power.sh <on|off|status>
#   on      Powers the Bluetooth adapter on.
#   off     Powers the Bluetooth adapter off (adapter/setState the exact
#           inverse of `on`). Added per the human partner's explicit,
#           confirmed go-ahead despite this likely also disabling the LG
#           Magic Remote's pointer/motion feature (same radio) — see
#           js/screens/status.js's confirmation step and warning text
#           before this is ever called. Uses the same, already-proven
#           com.webos.service.bluetooth2 Luna mechanism this app uses
#           everywhere else, not the heavier systemd/upstart-unit-stop
#           approach some other community tools use.
#   status  Reports the adapter's current status (includes "powered").
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

case "$1" in
  on)
    log "bt-power.sh on: powering adapter on"
    run_luna luna://com.webos.service.bluetooth2/adapter/setState 1 '{"powered":true}'
    ;;
  off)
    log "bt-power.sh off: powering adapter off"
    run_luna luna://com.webos.service.bluetooth2/adapter/setState 1 '{"powered":false}'
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
