#!/bin/sh
# bt-pair.sh <address>
#   Pairs with the device at <address>. Blocks for 2 replies via
#   `luna-send -n 2`: the {subscribed:true} ack, then one more message —
#   either the final pairing result (Just Works devices — this is the
#   common case) or a `request:enterPasskey`-style event (devices that
#   need PIN entry — this script has no way to supply a passkey back,
#   known deferred gap, see js/screens/discover.js and task-5-report.md).
#
#   The brief originally specified `-n 3` here (ack, then "either the
#   passkey-request event or the final pairing result", implying a
#   possible 3rd reply after a passkey event). Verified live against two
#   real devices (a DualShock 4 and an Xbox Wireless Controller) that
#   this was wrong for the common Just-Works case: only 2 replies are
#   ever sent when no PIN is needed — the device successfully becomes
#   paired (confirmed via adapter/device getStatus) within a couple of
#   seconds, but `luna-send -n 3` sat blocked indefinitely (confirmed
#   past 90s, repeatedly) waiting for a 3rd reply that is simply never
#   sent. `-n 2` returns promptly for both cases: a successful pair, or
#   (for a PIN-needing device) the passkey-request event as the 2nd
#   reply, which the caller can't act on yet but at least gets back
#   quickly instead of hanging.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

address="$1"
if [ -z "$address" ]; then
  log "bt-pair.sh: missing address argument"
  exit 1
fi

log "bt-pair.sh: pairing with $address"
run_luna luna://com.webos.service.bluetooth2/adapter/pair 2 '{"address":"'"$address"'","subscribe":true}'
