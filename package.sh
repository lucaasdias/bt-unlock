#!/bin/sh
set -e
# Stage only git-tracked app runtime files (via `git ls-files`), not a
# working-directory exclude list — a stray untracked directory sitting
# next to this repo (editor state, an unrelated project, anything else)
# can never leak into the IPK this way, unlike the old rsync-with-
# exclude-list approach, which silently bundled 73MB of such content
# into a real build (confirmed live: `.claude/` and an unrelated
# `tailscale-tv/` project both ended up inside usr/palm/applications/
# until this fix). docs/, test/, package.sh, README.md, LICENSE, and
# .gitignore are tracked but repo-only, not app runtime, so they're
# excluded via git's own pathspec syntax.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
git ls-files -z -- . ':!docs' ':!test' ':!package.sh' ':!README.md' ':!LICENSE' ':!.gitignore' \
  | rsync -a --files-from=- --from0 ./ "$STAGE"/
ares-package "$STAGE" -o dist/
