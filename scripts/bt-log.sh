#!/bin/sh
# bt-log.sh <tail>
#   tail   Prints the last 50 lines of /var/lib/webosbrew/bt-unlock.log
#          (bt-common.sh's `log()` target — every script call in this app
#          logs a timestamped line there) as a synthetic JSON line,
#          same filesystem-only pattern as bt-startup.sh (no Luna call
#          involved). Gracefully handles the log file not existing yet
#          (empty output, not an error — a fresh install with no script
#          calls yet is a normal state, not a failure).
#
# JSON-escaping note: log lines are app-authored (timestamps + script
# names + Luna errorText strings), not raw user input, but are escaped
# properly anyway rather than assumed safe — handles backslashes, double
# quotes, and embedded newlines (the three things that would otherwise
# break the single JSON string this emits). Control characters other
# than newline are not separately escaped; this app's own log lines
# never contain any.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

LOG_FILE="/var/lib/webosbrew/bt-unlock.log"

# json_escape_lines() -> reads lines on stdin, emits one JSON-string-safe
#   line on stdout with each input line's own trailing newline replaced
#   by a literal two-character "\n" escape sequence (not a real newline),
#   so every input line survives as one continuous JSON string value.
json_escape_lines() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{printf "%s\\n", $0}'
}

case "$1" in
  tail)
    log "bt-log.sh tail: reading last 50 lines of $LOG_FILE"
    if [ -f "$LOG_FILE" ]; then
      CONTENT=$(tail -n 50 "$LOG_FILE" | json_escape_lines)
    else
      CONTENT=""
    fi
    # printf, NOT echo: verified live (and reproduced locally) that this
    # shell's `echo` reinterprets backslash escapes in its argument —
    # "\\" collapses back to "\" and the literal two-character "\n" this
    # function deliberately produces turns into a REAL newline, silently
    # corrupting the JSON (a multi-line log tail would otherwise come out
    # as several bare JSON objects concatenated, not one valid one).
    # printf's %s substitution does not reinterpret the value's own
    # backslashes, only `printf`'s own format string is escape-processed.
    printf '{"returnValue":true,"lines":"%s"}\n' "$CONTENT"
    ;;
  *)
    log "bt-log.sh: unknown subcommand '$1'"
    exit 1
    ;;
esac
