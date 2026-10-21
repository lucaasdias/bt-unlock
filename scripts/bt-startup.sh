#!/bin/sh
# bt-startup.sh <enable|disable|status|bootstrap>
#   enable    Creates /var/lib/webosbrew/init.d/50-bt-unlock as a symlink
#             to startup-bt-power.sh, so the adapter is powered on at the
#             next TV boot. User-toggleable from the Status screen rather
#             than an always-on install-time step — some users may not
#             want this app touching boot behavior at all.
#   disable   Removes that symlink if present.
#   status    Reports whether the symlink currently exists, with no other
#             side effect.
#   bootstrap A superset of `status` that js/screens/status.js actually
#             calls on every mount: the human partner wants start-on-boot
#             to default to ON for a new install, rather than requiring
#             the user to find and flip the toggle themselves. The very
#             first time this ever runs (BOOTSTRAP_MARKER below doesn't
#             exist yet), it enables start-on-boot once automatically —
#             same effect as `enable` — then writes the marker so this
#             never happens again. Every call after that (marker already
#             exists) behaves identically to a plain `status` read: it
#             will NOT re-enable something the user has since deliberately
#             disabled. The marker lives under /var/lib/webosbrew/ per
#             this project's "writes what it did under /var/lib/webosbrew/"
#             convention (same directory bt-common.sh's log() already
#             writes to).
#
# Filesystem-only — no Luna call involved, unlike every other script in
# this directory. Each subcommand prints its own synthetic NDJSON line
# shaped exactly like a real luna-send reply ({"returnValue":...,...}),
# so js/luna.js's existing parseReplies()/toExecResult() parse it exactly
# like a real Luna reply — no changes needed on the JS side at all.
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/bt-common.sh"

INIT_DIR="/var/lib/webosbrew/init.d"
LINK="$INIT_DIR/50-bt-unlock"
TARGET="$SCRIPT_DIR/startup-bt-power.sh"
BOOTSTRAP_MARKER="/var/lib/webosbrew/bt-unlock-startup-bootstrapped"

# do_enable() -> void
#   Shared by `enable` and `bootstrap`'s first-run path so there's exactly
#   one place that creates the symlink.
do_enable() {
  mkdir -p "$INIT_DIR"
  # ln -sf (re)creates the link in place whether it didn't exist yet or
  # already existed pointing somewhere stale — idempotent either way, no
  # need to special-case "already correct".
  ln -sf "$TARGET" "$LINK"
}

case "$1" in
  enable)
    log "bt-startup.sh enable: linking $LINK -> $TARGET"
    do_enable
    if [ -L "$LINK" ]; then
      echo '{"returnValue":true,"enabled":true}'
    else
      log "bt-startup.sh enable: failed to create $LINK"
      echo '{"returnValue":false,"errorText":"failed to create startup symlink"}'
    fi
    ;;
  disable)
    log "bt-startup.sh disable: removing $LINK"
    rm -f "$LINK"
    if [ ! -e "$LINK" ]; then
      echo '{"returnValue":true,"enabled":false}'
    else
      log "bt-startup.sh disable: failed to remove $LINK"
      echo '{"returnValue":false,"errorText":"failed to remove startup symlink"}'
    fi
    ;;
  status)
    log "bt-startup.sh status: checking $LINK"
    if [ -L "$LINK" ]; then
      echo '{"returnValue":true,"enabled":true}'
    else
      echo '{"returnValue":true,"enabled":false}'
    fi
    ;;
  bootstrap)
    if [ ! -e "$BOOTSTRAP_MARKER" ]; then
      log "bt-startup.sh bootstrap: first run — enabling start-on-boot by default"
      do_enable
      # Write the marker regardless of whether the symlink creation above
      # actually succeeded: either way, this is the one and only moment
      # this default gets applied. If `do_enable` somehow failed, the
      # user still has the manual Enable button on the Status screen —
      # this must never retry itself on every later app launch, which
      # would override a deliberate manual `disable` right back to on.
      mkdir -p "$(dirname "$BOOTSTRAP_MARKER")"
      : > "$BOOTSTRAP_MARKER"
    else
      log "bt-startup.sh bootstrap: already bootstrapped, reporting current state"
    fi
    if [ -L "$LINK" ]; then
      echo '{"returnValue":true,"enabled":true}'
    else
      echo '{"returnValue":true,"enabled":false}'
    fi
    ;;
  *)
    log "bt-startup.sh: unknown subcommand '$1'"
    exit 1
    ;;
esac
