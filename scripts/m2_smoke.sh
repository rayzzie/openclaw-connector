#!/usr/bin/env bash
set -euo pipefail

STEP=0
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$(cd "$ROOT_DIR/../uniagent_runtime" && pwd)"
LOG_DIR="$ROOT_DIR/.smoke"
GATEWAY_PORT="${UAG_SMOKE_PORT:-18080}"
GATEWAY_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}"
ADMIN_TOKEN="${UAG_SMOKE_ADMIN_TOKEN:-smoke-admin}"
INTERNAL_TOKEN="${UAG_SMOKE_INTERNAL_TOKEN:-smoke-internal}"
AGENT_ID="${UAG_AGENT_ID:-agent_001}"
PHONE_NUMBER="${UAG_SMOKE_PHONE_NUMBER:-+8613800138000}"
CONNECTOR_PID=""

fail() {
  echo "M2 SMOKE FAILED at step ${STEP}: $*" >&2
  exit 1
}

step() {
  STEP=$((STEP + 1))
  echo "[$STEP] $*"
}

cleanup() {
  if [[ -n "${CONNECTOR_PID}" ]] && kill -0 "${CONNECTOR_PID}" 2>/dev/null; then
    kill "${CONNECTOR_PID}" 2>/dev/null || true
    wait "${CONNECTOR_PID}" 2>/dev/null || true
  fi
  (
    cd "$RUNTIME_DIR"
    UAG_PORT="$GATEWAY_PORT" docker compose down >/dev/null 2>&1 || true
  )
}
trap cleanup EXIT

json_get() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(eval(sys.argv[1], {}, {"data": data}))' "$1"
}

wait_for_health() {
  for _ in $(seq 1 60); do
    if curl -fsS "$GATEWAY_BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_online() {
  for _ in $(seq 1 60); do
    local body
    body="$(curl -fsS "$GATEWAY_BASE_URL/v1/admin/agents" -H "X-Admin-Token: $ADMIN_TOKEN")" || true
    if BODY="$body" python3 - "$AGENT_ID" <<'PY'
import json, os, sys
agent_id = sys.argv[1]
try:
    data = json.loads(os.environ["BODY"])
except Exception:
    sys.exit(1)
for agent in data.get("agents", []):
    if agent.get("agent_id") == agent_id and agent.get("status") == "online":
        sys.exit(0)
sys.exit(1)
PY
    then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_connector_accepted() {
  local log_file="$1"
  for _ in $(seq 1 60); do
    if [[ -n "${CONNECTOR_PID}" ]] && ! kill -0 "${CONNECTOR_PID}" 2>/dev/null; then
      return 1
    fi
    if grep -q '"msg":"websocket accepted"' "$log_file"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_completed() {
  local request_id="$1"
  for _ in $(seq 1 80); do
    local body
    body="$(curl -fsS "$GATEWAY_BASE_URL/v1/internal/agents/$AGENT_ID/events?request_id=$request_id" -H "X-Internal-Token: $INTERNAL_TOKEN")" || true
    if BODY="$body" python3 - <<'PY'
import json, os, sys
try:
    data = json.loads(os.environ["BODY"])
except Exception:
    sys.exit(1)
events = data.get("events", [])
if any(event.get("payload", {}).get("type") == "response.completed" for event in events):
    sys.exit(0)
sys.exit(1)
PY
    then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_connector() {
  local mode="$1"
  local log_file="$2"
  (
    cd "$ROOT_DIR"
    UAG_GATEWAY_BASE_URL="$GATEWAY_BASE_URL" \
    UAG_AGENT_ID="$AGENT_ID" \
    UAG_AGENT_SK="$AGENT_SK" \
    UAG_PROTOCOL_VERSION="uag.agent.v1" \
    UAG_ACK_DEADLINE_MS=100 \
    UAG_ACK_MAX_RETRIES=1 \
    UAG_CONNECT_RETRY_MIN_MS=200 \
    UAG_CONNECT_RETRY_MAX_MS=1000 \
    MOCK_MODE="$mode" \
    LOG_LEVEL=debug \
    npm run dev >"$log_file" 2>&1
  ) &
  CONNECTOR_PID="$!"
}

dispatch_request() {
  local request_id="$1"
  curl -fsS -X POST "$GATEWAY_BASE_URL/v1/internal/agents/$AGENT_ID/requests" \
    -H "X-Internal-Token: $INTERNAL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"sess_smoke\",\"turn_id\":\"turn_smoke\",\"request_id\":\"$request_id\",\"trace_id\":\"trace_$request_id\",\"payload\":{\"text\":\"hello\"}}"
}

mkdir -p "$LOG_DIR"

step "build connector"
cd "$ROOT_DIR"
npm run build >/dev/null || fail "connector build failed"

step "start uniagent_runtime"
rm -f "$RUNTIME_DIR/data/m2_smoke.db"
(
  cd "$RUNTIME_DIR"
  UAG_PORT="$GATEWAY_PORT" \
  UAG_ADMIN_TOKEN="$ADMIN_TOKEN" \
  UAG_INTERNAL_TOKEN="$INTERNAL_TOKEN" \
  UAG_DATABASE_URL="sqlite:////data/m2_smoke.db" \
  UAG_ACK_DEADLINE_MS=300 \
  UAG_ACK_MAX_RETRIES=1 \
  docker compose up -d --build
) >/dev/null || fail "gateway docker compose up failed"
wait_for_health || fail "gateway health endpoint not ready"

step "create agent"
CREATE_RESPONSE="$(curl -fsS -X POST "$GATEWAY_BASE_URL/v1/admin/agents" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_ID\",\"name\":\"OpenClaw Smoke Agent\",\"phone_number\":\"$PHONE_NUMBER\",\"agent_runtime\":\"openclaw\",\"metadata\":{\"smoke\":true}}")" || fail "create agent failed"
AGENT_SK="$(printf '%s' "$CREATE_RESPONSE" | json_get 'data["sk"]')"

step "start connector happy mode"
start_connector "happy" "$LOG_DIR/connector-happy.log"
wait_for_connector_accepted "$LOG_DIR/connector-happy.log" || fail "happy connector did not reach websocket accepted"
wait_for_online || fail "agent did not become online"

step "dispatch happy request"
HAPPY_RESPONSE="$(dispatch_request "req_smoke_happy")" || fail "happy dispatch failed"
[[ "$(printf '%s' "$HAPPY_RESPONSE" | json_get 'data["ok"]')" == "True" ]] || fail "happy dispatch did not ack"
wait_for_completed "req_smoke_happy" || fail "happy response.completed not observed"

step "restart connector in ack_drop mode"
kill "$CONNECTOR_PID" 2>/dev/null || true
wait "$CONNECTOR_PID" 2>/dev/null || true
CONNECTOR_PID=""
start_connector "ack_drop" "$LOG_DIR/connector-ack-drop.log"
wait_for_connector_accepted "$LOG_DIR/connector-ack-drop.log" || fail "ack_drop connector did not reach websocket accepted"
wait_for_online || fail "ack_drop agent did not become online"

step "dispatch ack_drop request"
ACK_DROP_RESPONSE="$(dispatch_request "req_smoke_ack_drop")" || fail "ack_drop dispatch request failed"
[[ "$(printf '%s' "$ACK_DROP_RESPONSE" | json_get 'data["ok"]')" == "False" ]] || fail "ack_drop dispatch unexpectedly acked"
for _ in $(seq 1 40); do
  if grep -q '"code":4001' "$LOG_DIR/connector-ack-drop.log"; then
    echo "M2 SMOKE OK"
    exit 0
  fi
  sleep 0.25
done
fail "connector did not observe 4001 close"
