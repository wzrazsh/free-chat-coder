#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-supervisor}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="$REPO_ROOT/.workbuddy"
STATE_FILE="$STATE_DIR/autopilot-state.json"
LAST_MESSAGE_FILE="$STATE_DIR/autopilot-last-message.md"
LAST_SUPERVISOR_LOG="$STATE_DIR/dev-autopilot.log"
BASE_PROMPT_FILE="$SCRIPT_DIR/dev-autopilot-prompt.md"
STALL_TIMEOUT_SECONDS=1200
MAX_RUNTIME_SECONDS=3600

timestamp() {
  date -Iseconds
}

epoch_now() {
  date +%s
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

ensure_state_file() {
  ensure_state_dir
  if [ ! -f "$STATE_FILE" ]; then
    cat > "$STATE_FILE" <<'EOF'
{
  "status": "idle",
  "recoveryRequired": false,
  "runCount": 0,
  "pid": 0
}
EOF
  fi
}

state_get() {
  local filter="$1"
  jq -r "$filter" "$STATE_FILE"
}

state_set_start() {
  local pid="$1"
  local mode="$2"
  local run_log="$3"
  local prompt_file="$4"
  local run_id="$5"
  local now_iso
  now_iso="$(timestamp)"

  local tmp
  tmp="$(mktemp)"
  jq \
    --arg pid "$pid" \
    --arg mode "$mode" \
    --arg runLog "$run_log" \
    --arg promptFile "$prompt_file" \
    --arg runId "$run_id" \
    --arg now "$now_iso" \
    '
      .pid = ($pid | tonumber)
      | .status = "running"
      | .currentMode = $mode
      | .currentLog = $runLog
      | .currentPrompt = $promptFile
      | .currentRunId = $runId
      | .startedAt = $now
      | .updatedAt = $now
      | .lastSupervisorCheck = $now
      | .recoveryRequired = false
      | .lastIssue = null
      | .runCount = ((.runCount // 0) + 1)
    ' "$STATE_FILE" > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

state_set_note() {
  local status="$1"
  local message="$2"
  local now_iso
  now_iso="$(timestamp)"

  local tmp
  tmp="$(mktemp)"
  jq \
    --arg status "$status" \
    --arg message "$message" \
    --arg now "$now_iso" \
    '
      .status = $status
      | .updatedAt = $now
      | .lastSupervisorCheck = $now
      | .lastIssue = $message
    ' "$STATE_FILE" > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

state_set_finish() {
  local exit_code="$1"
  local mode="$2"
  local run_log="$3"
  local now_iso
  now_iso="$(timestamp)"

  local next_status="idle"
  local next_recovery="false"
  if [ "$exit_code" -ne 0 ]; then
    next_status="failed"
    next_recovery="true"
  fi

  local tmp
  tmp="$(mktemp)"
  jq \
    --arg exitCode "$exit_code" \
    --arg mode "$mode" \
    --arg runLog "$run_log" \
    --arg now "$now_iso" \
    --arg status "$next_status" \
    --argjson recovery "$next_recovery" \
    '
      .pid = 0
      | .status = $status
      | .lastExitCode = ($exitCode | tonumber)
      | .lastMode = $mode
      | .lastLog = $runLog
      | .finishedAt = $now
      | .updatedAt = $now
      | .lastSupervisorCheck = $now
      | .recoveryRequired = $recovery
      | .currentMode = null
      | .currentLog = null
      | .currentPrompt = null
      | .currentRunId = null
    ' "$STATE_FILE" > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

process_alive() {
  local pid="$1"
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

kill_process_tree() {
  local pid="$1"
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then
    return 0
  fi

  kill -- -"$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
}

build_prompt_file() {
  local mode="$1"
  local prompt_file="$2"
  local now_iso
  now_iso="$(timestamp)"
  local branch
  branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  local last_commit
  last_commit="$(git -C "$REPO_ROOT" log -1 --pretty=format:%h\ %s 2>/dev/null || echo unknown)"
  local status_summary
  status_summary="$(git -C "$REPO_ROOT" status --short 2>/dev/null || true)"
  local last_log
  last_log="$(state_get '.lastLog // empty' 2>/dev/null || true)"

  cp "$BASE_PROMPT_FILE" "$prompt_file"

  {
    echo
    echo "## Runtime context"
    echo
    echo "- Mode: $mode"
    echo "- Timestamp: $now_iso"
    echo "- Branch: $branch"
    echo "- Last commit: $last_commit"
    echo
    echo "## Current git status"
    echo
    if [ -n "$status_summary" ]; then
      printf '```text\n%s\n```\n' "$status_summary"
    else
      echo "```text"
      echo "(clean working tree)"
      echo "```"
    fi
  } >> "$prompt_file"

  if [ "$mode" = "recovery" ]; then
    {
      echo
      echo "## Recovery context"
      echo
      echo "- Previous run was marked for recovery."
      if [ -n "$last_log" ] && [ -f "$last_log" ]; then
        echo
        echo "### Tail of previous run log"
        echo
        echo '```text'
        tail -n 120 "$last_log"
        echo '```'
      fi
      if [ -f "$LAST_MESSAGE_FILE" ]; then
        echo
        echo "### Last Codex message"
        echo
        echo '```text'
        tail -n 120 "$LAST_MESSAGE_FILE"
        echo '```'
      fi
    } >> "$prompt_file"
  fi
}

run_worker() {
  local mode="$1"
  local run_log="$2"
  local prompt_file="$3"

  ensure_state_file

  exec >> "$run_log" 2>&1
  echo "[autopilot] worker started at $(timestamp), mode=$mode"

  cd "$REPO_ROOT"
  node scripts/dev-status-report.js || true

  set +e
  codex exec -C "$REPO_ROOT" -s danger-full-access -o "$LAST_MESSAGE_FILE" < "$prompt_file"
  local exit_code=$?
  set -e

  node scripts/dev-status-report.js || true
  state_set_finish "$exit_code" "$mode" "$run_log"

  echo "[autopilot] worker finished at $(timestamp), exit=$exit_code"
  exit "$exit_code"
}

run_supervisor() {
  ensure_state_file
  cd "$REPO_ROOT"

  node scripts/dev-status-report.js >/dev/null 2>&1 || true

  local pid
  pid="$(state_get '.pid // 0')"
  local status
  status="$(state_get '.status // "idle"')"
  local current_log
  current_log="$(state_get '.currentLog // empty')"
  local started_at
  started_at="$(state_get '.startedAt // empty')"
  local now_epoch
  now_epoch="$(epoch_now)"

  if process_alive "$pid"; then
    local log_mtime
    if [ -n "$current_log" ] && [ -f "$current_log" ]; then
      log_mtime="$(stat -c %Y "$current_log" 2>/dev/null || echo "$now_epoch")"
    else
      log_mtime="$now_epoch"
    fi

    local started_epoch
    started_epoch="$(date -d "$started_at" +%s 2>/dev/null || echo "$now_epoch")"
    local runtime_seconds=$((now_epoch - started_epoch))
    local stale_seconds=$((now_epoch - log_mtime))

    if [ "$runtime_seconds" -le "$MAX_RUNTIME_SECONDS" ] && [ "$stale_seconds" -le "$STALL_TIMEOUT_SECONDS" ]; then
      state_set_note "running" "worker healthy: pid=$pid runtime=${runtime_seconds}s stale=${stale_seconds}s"
      exit 0
    fi

    local reason="worker considered stalled: pid=$pid runtime=${runtime_seconds}s stale=${stale_seconds}s"
    echo "[autopilot] $reason" >> "$LAST_SUPERVISOR_LOG"
    kill_process_tree "$pid"
    sleep 2
    state_set_note "hung" "$reason"

    local tmp
    tmp="$(mktemp)"
    jq '.pid = 0 | .recoveryRequired = true' "$STATE_FILE" > "$tmp"
    mv "$tmp" "$STATE_FILE"
  elif [ "$status" = "running" ]; then
    state_set_note "stopped" "worker exited unexpectedly before supervisor check"
    local tmp
    tmp="$(mktemp)"
    jq '.pid = 0 | .recoveryRequired = true' "$STATE_FILE" > "$tmp"
    mv "$tmp" "$STATE_FILE"
  fi

  local mode="normal"
  if [ "$(state_get '.recoveryRequired // false')" = "true" ]; then
    mode="recovery"
  fi

  local run_id
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  local prompt_file="$STATE_DIR/autopilot-$run_id.prompt.md"
  local run_log="$STATE_DIR/autopilot-$run_id.log"

  if [ -n "${FREE_CHAT_CODER_AUTOPILOT_PROMPT_FILE:-}" ]; then
    cp "$FREE_CHAT_CODER_AUTOPILOT_PROMPT_FILE" "$prompt_file"
  else
    build_prompt_file "$mode" "$prompt_file"
  fi

  nohup "$0" --worker "$mode" "$run_log" "$prompt_file" >/dev/null 2>&1 &
  local worker_pid=$!
  state_set_start "$worker_pid" "$mode" "$run_log" "$prompt_file" "$run_id"
  echo "[autopilot] launched worker pid=$worker_pid mode=$mode run_id=$run_id" >> "$LAST_SUPERVISOR_LOG"
}

case "$MODE" in
  supervisor)
    run_supervisor
    ;;
  --worker)
    run_worker "${2:-normal}" "${3:?missing run log}" "${4:?missing prompt file}"
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac
