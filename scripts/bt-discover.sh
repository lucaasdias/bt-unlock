#!/bin/sh
# bt-discover.sh <start|stop>
#   start   Kicks off discovery and returns a single device-list snapshot.
#           Not a subscription: `exec` is a single blocking call, so the
#           JS side (js/screens/discover.js) calls this on a ~2s timer to
#           poll instead, per the architecture's polling decision. Each
#           tick re-issues adapter/startDiscovery, which is harmless to
#           call again while already discovering (it just keeps the scan
#           going / resets the adapter's own discoveryTimeout), rather
#           than trying to track discovery state client-side.
#   stop    Cancels discovery on the radio side (Task 9 round 3 bounded-
#           search feature). `adapter/cancelDiscovery` is a documented
#           method of this service's `adapter` category (confirmed
#           against the webOS OSE Luna Service API reference for
#           com.webos.service.bluetooth2 — this app already calls
#           `adapter/startDiscovery` from the very same category/doc
#           successfully on the real TV, so cancelDiscovery is expected
#           to work the same way). Called once when the JS side's search
#           window ends — either the user pressing Stop or the bounded
#           ~35s window elapsing — rather than leaving discovery running
#           client-polling-less until the adapter's own ~20s
#           discoveryTimeout eventually kicks in on its own. NOT verified
#           live against the real TV for this round: `luna-send` returned
#           no output/replies at all (even for long-known-working calls
#           like adapter/getStatus and systemservice/clock/getTime) when
#           invoked over a plain SSH session on this specific TV, a
#           reproducible environment quirk distinct from the app's own
#           exec() path — see task-9-report.md's "Bounded search window"
#           section for the full writeup. If this call turns out not to
#           work as expected on-device, the fallback (the adapter's own
#           discoveryTimeout eventually stopping the radio on its own) is
#           still in effect either way.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

case "$1" in
  start)
    log "bt-discover.sh start: starting discovery and snapshotting device list"
    run_luna luna://com.webos.service.bluetooth2/adapter/startDiscovery 1 '{}'
    run_luna luna://com.webos.service.bluetooth2/device/getStatus 1 '{}'
    ;;
  stop)
    log "bt-discover.sh stop: cancelling discovery"
    run_luna luna://com.webos.service.bluetooth2/adapter/cancelDiscovery 1 '{}'
    ;;
  *)
    log "bt-discover.sh: unknown subcommand '$1'"
    exit 1
    ;;
esac
