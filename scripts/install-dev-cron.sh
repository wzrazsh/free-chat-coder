#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
START_MARKER="# >>> free-chat-coder-dev >>>"
END_MARKER="# <<< free-chat-coder-dev <<<"

mkdir -p "$REPO_ROOT/.workbuddy"

CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"
FILTERED_CRONTAB="$(printf '%s\n' "$CURRENT_CRONTAB" | awk -v start="$START_MARKER" -v end="$END_MARKER" '
  $0 == start { skip = 1; next }
  $0 == end { skip = 0; next }
  skip != 1 { print }
')"

BLOCK="$(cat <<EOF
$START_MARKER
*/5 * * * * $REPO_ROOT/scripts/dev-autopilot.sh >> $REPO_ROOT/.workbuddy/dev-autopilot.log 2>&1
20 2 * * * $REPO_ROOT/scripts/nightly-validate.sh >> $REPO_ROOT/.workbuddy/dev-nightly.log 2>&1
$END_MARKER
EOF
)"

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT

if [ -n "$FILTERED_CRONTAB" ]; then
  printf '%s\n\n%s\n' "$FILTERED_CRONTAB" "$BLOCK" > "$TMPFILE"
else
  printf '%s\n' "$BLOCK" > "$TMPFILE"
fi

crontab "$TMPFILE"
echo "Installed free-chat-coder cron jobs:"
echo "$BLOCK"
