#!/bin/sh
# Symlink target for /var/lib/webosbrew/init.d/50-bt-unlock. The symlink
# itself is created/removed by scripts/bt-startup.sh's enable/disable
# subcommands, driven by a user-facing toggle on the Status screen (not
# an always-on install-time step — some users may not want this app
# touching boot behavior at all). This script only needs to exist and
# work when actually run by the init.d runner at boot, or by hand. Powers
# the adapter on at boot so paired accessories reconnect without the
# user opening the app.
SCRIPT_DIR="$(dirname "$0")"
TARGET="/media/developer/apps/usr/palm/applications/org.lucaasdias.btunlock/scripts/bt-power.sh"
[ -x "$TARGET" ] || exit 0
"$TARGET" on
