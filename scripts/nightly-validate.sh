#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$REPO_ROOT/.workbuddy/auto-nightly-validation.md"

mkdir -p "$REPO_ROOT/.workbuddy"

TOTAL=0
FAILED=0
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

REPORT="# Auto Nightly Validation\n\n"
REPORT+="更新时间：$(date -Iseconds)\n\n"
REPORT+="## 检查结果\n\n"

run_check() {
  local label="$1"
  shift
  TOTAL=$((TOTAL + 1))
  local log_file="$TMPDIR/check-$TOTAL.log"

  if ( cd "$REPO_ROOT" && "$@" ) >"$log_file" 2>&1; then
    REPORT+="- PASS: ${label}\n"
  else
    FAILED=$((FAILED + 1))
    REPORT+="- FAIL: ${label}\n"
    REPORT+="\n\`\`\`text\n$(sed -n '1,80p' "$log_file")\n\`\`\`\n\n"
  fi
}

skip_check() {
  local label="$1"
  local reason="$2"
  REPORT+="- SKIP: ${label} (${reason})\n"
}

run_check "validate-environment" node validate-environment.js
run_check "queue-server syntax" node -c queue-server/index.js
run_check "background syntax" node -c chromevideo/background.js
run_check "offscreen syntax" node -c chromevideo/offscreen.js
run_check "sidepanel syntax" node -c chromevideo/sidepanel.js
run_check "native host syntax" node -c chromevideo/host/host.js
run_check "status report generation" node scripts/dev-status-report.js

if [ -d "$REPO_ROOT/web-console/node_modules" ]; then
  run_check "web-console build" bash -lc "cd \"$REPO_ROOT/web-console\" && npm run build"
  run_check "web-console lint" bash -lc "cd \"$REPO_ROOT/web-console\" && npm run lint"
else
  skip_check "web-console build" "missing web-console/node_modules"
  skip_check "web-console lint" "missing web-console/node_modules"
fi

REPORT+="\n## 汇总\n\n"
REPORT+="- 总检查数：${TOTAL}\n"
REPORT+="- 失败数：${FAILED}\n"

printf '%b' "$REPORT" > "$OUTPUT"
echo "Wrote $OUTPUT"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
