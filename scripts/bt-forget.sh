#!/bin/sh
# bt-forget.sh <address> [profile]
#   Forgets (unpairs) the device at <address>. If <profile> (hid|a2dp) is
#   given, disconnects over that profile first, then always unpairs
#   regardless of whether that disconnect succeeded — a device the user
#   asks to forget is very often already disconnected (e.g. forgotten
#   straight from the paired list without reconnecting first), and a
#   "wasn't connected" disconnect error must not block the unpair itself.
#   The disconnect reply is logged, not echoed to stdout, so it can never
#   make run_luna's combined NDJSON output look like an overall failure
#   to js/luna.js's toExecResult() (which treats any returnValue:false
#   reply in stdout as a failure) — only the final adapter/unpair reply
#   is emitted for the caller to parse.
#
#   CORRECTION vs. the original plan: `device/setState {"trusted":false}`
#   was verified live (Task 5, see task-5-report.md) to NOT actually
#   unpair a device — device/getStatus still showed paired:true
#   afterward. The real working call is `adapter/unpair {"address":...}`.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

address="$1"
profile="$2"

if [ -z "$address" ]; then
  log "bt-forget.sh: missing address argument"
  exit 1
fi

case "$profile" in
  hid|a2dp)
    log "bt-forget.sh: disconnecting $address over $profile before forgetting"
    disconnect_reply=$(run_luna "luna://com.webos.service.bluetooth2/$profile/disconnect" 1 '{"address":"'"$address"'"}')
    log "bt-forget.sh: disconnect reply (ignored if it failed): $disconnect_reply"
    ;;
  "")
    log "bt-forget.sh: no profile given for $address, skipping disconnect"
    ;;
  *)
    log "bt-forget.sh: unsupported profile '$profile', skipping disconnect"
    ;;
esac

log "bt-forget.sh: unpairing $address"
run_luna luna://com.webos.service.bluetooth2/adapter/unpair 1 '{"address":"'"$address"'"}'
