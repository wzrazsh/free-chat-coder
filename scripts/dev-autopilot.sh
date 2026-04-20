#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-supervisor}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="${FREE_CHAT_CODER_AUTOPILOT_STATE_DIR:-$REPO_ROOT/.workbuddy}"
STATE_FILE="$STATE_DIR/autopilot-state.json"
LAST_MESSAGE_FILE="$STATE_DIR/autopilot-last-message.md"
LAST_SUPERVISOR_LOG="$STATE_DIR/dev-autopilot.log"
BASE_PROMPT_FILE="$SCRIPT_DIR/dev-autopilot-prompt.md"
LOCK_FILE="$STATE_DIR/dev-autopilot.lock"
STALL_TIMEOUT_SECONDS=1200
MAX_RUNTIME_SECONDS=3600
WATCHDOG_POLL_SECONDS="${FREE_CHAT_CODER_AUTOPILOT_WATCHDOG_POLL_SECONDS:-5}"
FOLLOWUP_DELAY_SECONDS="${FREE_CHAT_CODER_AUTOPILOT_FOLLOWUP_DELAY_SECONDS:-15}"

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
    echo "## Session handling"
    echo
    if [ "$mode" = "recovery" ]; then
      echo "- This run is recovery-oriented. You may reuse the recovery context, previous logs, and the previous Codex message to repair or continue the interrupted task."
      echo "- Keep the scope anchored to the failure or blocked task before switching to a new backlog item."
    else
      echo "- This run must be treated as a fresh session."
      echo "- Rebuild context only from the repository files and the prompt sections included here."
      echo "- Do not assume any earlier conversation state unless the current prompt explicitly includes it."
    fi
    echo
    echo "## Required execution steps"
    echo
    echo "1. Read the required context files."
    echo "2. Identify the single best current task with goal, files, acceptance, and verification."
    echo "3. Complete one validated unit of progress."
    echo "4. Commit verified changes or leave a concrete blocker with evidence."
    echo "5. State the next best task for the following fresh session."
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

run_autopilot_command() {
  local prompt_file="$1"

  if [ -n "${FREE_CHAT_CODER_AUTOPILOT_EXEC:-}" ]; then
    FREE_CHAT_CODER_AUTOPILOT_REPO_ROOT="$REPO_ROOT" \
      FREE_CHAT_CODER_AUTOPILOT_PROMPT_FILE="$prompt_file" \
      FREE_CHAT_CODER_AUTOPILOT_LAST_MESSAGE_FILE="$LAST_MESSAGE_FILE" \
      bash -lc "$FREE_CHAT_CODER_AUTOPILOT_EXEC" < "$prompt_file"
    return
  fi

  codex exec -C "$REPO_ROOT" -s danger-full-access -o "$LAST_MESSAGE_FILE" < "$prompt_file"
}

spawn_watchdog() {
  local run_id="$1"
  local worker_pid="$2"
  local chain_budget="${3:-}"

  echo "[autopilot] spawning watchdog for pid=$worker_pid run_id=$run_id chain_budget=${chain_budget:-unlimited}" >> "$LAST_SUPERVISOR_LOG"

  if [ -n "$chain_budget" ]; then
    nohup "$0" --watch "$run_id" "$worker_pid" "$chain_budget" 9>&- >/dev/null 2>&1 &
    return
  fi

  nohup "$0" --watch "$run_id" "$worker_pid" 9>&- >/dev/null 2>&1 &
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
  run_autopilot_command "$prompt_file"
  local exit_code=$?
  set -e

  node scripts/dev-status-report.js || true
  state_set_finish "$exit_code" "$mode" "$run_log"

  echo "[autopilot] worker finished at $(timestamp), exit=$exit_code"
  exit "$exit_code"
}

run_watchdog() {
  local watched_run_id="${1:?missing run id}"
  local watched_pid="${2:?missing worker pid}"
  local chain_budget="${3:-}"
  local attempts=0

  ensure_state_file
  echo "[autopilot] watchdog waiting for pid=$watched_pid run_id=$watched_run_id chain_budget=${chain_budget:-unlimited}" >> "$LAST_SUPERVISOR_LOG"

  while process_alive "$watched_pid"; do
    sleep "$WATCHDOG_POLL_SECONDS"
  done

  while [ "$attempts" -lt 10 ]; do
    local status
    status="$(state_get '.status // "idle"')"
    local current_run_id
    current_run_id="$(state_get '.currentRunId // empty')"

    if [ "$status" != "running" ] || [ "$current_run_id" != "$watched_run_id" ]; then
      break
    fi

    attempts=$((attempts + 1))
    sleep 1
  done

  sleep "$FOLLOWUP_DELAY_SECONDS"

  local current_pid
  current_pid="$(state_get '.pid // 0')"
  local current_run_id
  current_run_id="$(state_get '.currentRunId // empty')"
  local status
  status="$(state_get '.status // "idle"')"

  if [ "$status" = "running" ] && [ "$current_run_id" != "$watched_run_id" ] && process_alive "$current_pid"; then
    echo "[autopilot] watchdog observed a newer active run; skipping continuation for run_id=$watched_run_id" >> "$LAST_SUPERVISOR_LOG"
    exit 0
  fi

  if [ -n "$chain_budget" ]; then
    if [ "$chain_budget" -le 0 ]; then
      echo "[autopilot] watchdog reached chain budget limit for run_id=$watched_run_id" >> "$LAST_SUPERVISOR_LOG"
      exit 0
    fi

    echo "[autopilot] watchdog continuing run_id=$watched_run_id with remaining_budget=$((chain_budget - 1))" >> "$LAST_SUPERVISOR_LOG"
    FREE_CHAT_CODER_AUTOPILOT_CHAIN_BUDGET="$((chain_budget - 1))" "$0" supervisor >> "$LAST_SUPERVISOR_LOG" 2>&1
    exit 0
  fi

  echo "[autopilot] watchdog continuing run_id=$watched_run_id without budget limit" >> "$LAST_SUPERVISOR_LOG"
  "$0" supervisor >> "$LAST_SUPERVISOR_LOG" 2>&1
}

run_supervisor_locked() {
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

  nohup "$0" --worker "$mode" "$run_log" "$prompt_file" 9>&- >/dev/null 2>&1 &
  local worker_pid=$!
  state_set_start "$worker_pid" "$mode" "$run_log" "$prompt_file" "$run_id"
  spawn_watchdog "$run_id" "$worker_pid" "${FREE_CHAT_CODER_AUTOPILOT_CHAIN_BUDGET:-}"
  echo "[autopilot] launched worker pid=$worker_pid mode=$mode run_id=$run_id" >> "$LAST_SUPERVISOR_LOG"
}

run_supervisor() {
  ensure_state_dir
  echo "[autopilot] supervisor check started at $(timestamp)" >> "$LAST_SUPERVISOR_LOG"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "[autopilot] supervisor skipped because another supervisor holds the lock" >> "$LAST_SUPERVISOR_LOG"
    exit 0
  fi

  run_supervisor_locked
}

case "$MODE" in
  supervisor)
    run_supervisor
    ;;
  --worker)
    run_worker "${2:-normal}" "${3:?missing run log}" "${4:?missing prompt file}"
    ;;
  --watch)
    run_watchdog "${2:?missing run id}" "${3:?missing worker pid}" "${4:-}"
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac
