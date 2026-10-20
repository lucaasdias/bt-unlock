#!/bin/sh
# Symlink target for /var/lib/webosbrew/init.d/ (Task 9 creates the actual
# symlink at install time; this script only needs to exist and work when
# run by hand or by the init.d runner). Powers the adapter on at boot so
# paired accessories reconnect without the user opening the app.
SCRIPT_DIR="$(dirname "$0")"
TARGET="/media/developer/apps/usr/palm/applications/org.lucaasdias.btunlock/scripts/bt-power.sh"
[ -x "$TARGET" ] || exit 0
"$TARGET" on
