#!/bin/sh
# Shared helpers sourced by every script in scripts/.
#
# run_luna <uri> [count] <json>
#   Calls luna-send against <uri> with payload <json>, requesting <count>
#   replies (default 1). Each reply is printed on its own line with no
#   extra framing, so stdout is NDJSON: one JSON object per line, directly
#   parseable by js/luna.js's parseReplies() without a custom protocol.
#
#   NOTE: this intentionally omits luna-send's `-f` ("format JSON
#   responses usefully") flag. On this TV's luna-send, `-f` pretty-prints
#   each reply across multiple indented lines, which breaks the
#   one-reply-per-line NDJSON contract parseReplies() depends on —
#   verified live against the real device while implementing this script
#   (see task-2-report.md). Without `-f`, each reply comes out as compact
#   single-line JSON, which is what we need.
run_luna() {
  uri="$1"
  count="${2:-1}"
  json="$3"
  luna-send -n "$count" "$uri" "$json"
}

# log <message>
#   Appends a single line to the shared log file, prefixed with an
#   ISO-8601 timestamp.
log() {
  message="$1"
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$timestamp $message" >> /var/lib/webosbrew/bt-unlock.log
}
