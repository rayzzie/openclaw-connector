#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECTOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"
CHANNEL_ID="uniagentgate"

log() {
  printf '[uniagentgate-install] %s\n' "$*"
}

fail() {
  printf '[uniagentgate-install] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v "$OPENCLAW_BIN" >/dev/null 2>&1 || fail "openclaw CLI not found. Set OPENCLAW_BIN=/path/to/openclaw if needed."
command -v npm >/dev/null 2>&1 || fail "npm not found"
command -v python3 >/dev/null 2>&1 || fail "python3 not found"

mkdir -p "$(dirname "$CONFIG_PATH")"
if [[ ! -f "$CONFIG_PATH" ]]; then
  log "creating empty OpenClaw config at $CONFIG_PATH"
  printf '{}\n' >"$CONFIG_PATH"
fi

BACKUP_PATH="${CONFIG_PATH}.bak.uniagentgate.$(date +%Y%m%d-%H%M%S)"
cp "$CONFIG_PATH" "$BACKUP_PATH"
log "backed up OpenClaw config: $BACKUP_PATH"

log "installing connector dependencies"
(
  cd "$CONNECTOR_DIR"
  npm install
)

log "building connector"
(
  cd "$CONNECTOR_DIR"
  npm run build
)

if [[ "${UAG_USE_OPENCLAW_INSTALL:-0}" == "1" ]]; then
  log "link-installing OpenClaw plugin from $CONNECTOR_DIR"
  if ! UAG_OPENCLAW_INSTALL_ONLY=1 "$OPENCLAW_BIN" plugins install --link --dangerously-force-unsafe-install "$CONNECTOR_DIR"; then
    log "OpenClaw CLI install was blocked; continuing with direct config update"
  fi
else
  log "skipping OpenClaw CLI install; using direct path config update"
fi

log "updating OpenClaw config: plugins.load.paths + channels.uniagentgate"
CONNECTOR_DIR="$CONNECTOR_DIR" \
CONFIG_PATH="$CONFIG_PATH" \
CHANNEL_ID="$CHANNEL_ID" \
UAG_GATEWAY_BASE_URL="${UAG_GATEWAY_BASE_URL:-}" \
UAG_AGENT_ID="${UAG_AGENT_ID:-}" \
UAG_AGENT_SK="${UAG_AGENT_SK:-}" \
UAG_DISABLE_OTHER_CHANNELS="${UAG_DISABLE_OTHER_CHANNELS:-0}" \
python3 - <<'PY'
import json
import os
from pathlib import Path

config_path = Path(os.environ["CONFIG_PATH"]).expanduser()
connector_dir = str(Path(os.environ["CONNECTOR_DIR"]).resolve())
channel_id = os.environ["CHANNEL_ID"]

try:
    cfg = json.loads(config_path.read_text())
except json.JSONDecodeError as exc:
    raise SystemExit(f"OpenClaw config is not valid JSON: {exc}") from exc

if not isinstance(cfg, dict):
    raise SystemExit("OpenClaw config root must be a JSON object")

channels = cfg.setdefault("channels", {})
if not isinstance(channels, dict):
    raise SystemExit("OpenClaw config field 'channels' must be an object")

plugins = cfg.setdefault("plugins", {})
if not isinstance(plugins, dict):
    raise SystemExit("OpenClaw config field 'plugins' must be an object")

entries = plugins.setdefault("entries", {})
if not isinstance(entries, dict):
    raise SystemExit("OpenClaw config field 'plugins.entries' must be an object")

load = plugins.setdefault("load", {})
if not isinstance(load, dict):
    raise SystemExit("OpenClaw config field 'plugins.load' must be an object")

paths = load.setdefault("paths", [])
if not isinstance(paths, list):
    raise SystemExit("OpenClaw config field 'plugins.load.paths' must be an array")

channel_cfg = channels.get(channel_id)
if not isinstance(channel_cfg, dict):
    channel_cfg = {}

entry_cfg = entries.get(channel_id)
if not isinstance(entry_cfg, dict):
    entry_cfg = {}
entry_config = entry_cfg.get("config")
if not isinstance(entry_config, dict):
    entry_config = {}

gateway_url = (
    os.environ.get("UAG_GATEWAY_BASE_URL")
    or channel_cfg.get("gatewayUrl")
    or entry_config.get("gatewayUrl")
)
agent_id = (
    os.environ.get("UAG_AGENT_ID")
    or channel_cfg.get("agentId")
    or entry_config.get("agentId")
)
agent_sk = (
    os.environ.get("UAG_AGENT_SK")
    or channel_cfg.get("agentSk")
    or entry_config.get("agentSk")
)

missing = [
    name
    for name, value in (
        ("UAG_GATEWAY_BASE_URL / channels.uniagentgate.gatewayUrl", gateway_url),
        ("UAG_AGENT_ID / channels.uniagentgate.agentId", agent_id),
        ("UAG_AGENT_SK / channels.uniagentgate.agentSk", agent_sk),
    )
    if not isinstance(value, str) or not value
]
if missing:
    raise SystemExit("Missing required uniAgentGate config: " + ", ".join(missing))

if os.environ.get("UAG_DISABLE_OTHER_CHANNELS") == "1":
    for key, value in list(channels.items()):
        if key != channel_id and isinstance(value, dict):
            value["enabled"] = False

channels[channel_id] = {
    **channel_cfg,
    "enabled": True,
    "gatewayUrl": gateway_url.rstrip("/"),
    "agentId": agent_id,
    "agentSk": agent_sk,
}

entries[channel_id] = {
    **entry_cfg,
    "enabled": True,
    "config": {
        **entry_config,
        "gatewayUrl": gateway_url.rstrip("/"),
        "agentId": agent_id,
        "agentSk": agent_sk,
    },
}

plugins["enabled"] = True
allow = plugins.get("allow")
if isinstance(allow, list) and channel_id not in allow:
    allow.append(channel_id)

paths[:] = [p for p in paths if p != connector_dir]
paths.insert(0, connector_dir)

installs = plugins.setdefault("installs", {})
if isinstance(installs, dict):
    install = installs.get(channel_id)
    if not isinstance(install, dict):
        install = {}
    install.update(
        {
            "source": "path",
            "sourcePath": connector_dir,
            "installPath": connector_dir,
            "version": "1.0.0",
        }
    )
    installs[channel_id] = install

config_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")

print(f"channels.{channel_id}.enabled = true")
print(f"channels.{channel_id}.gatewayUrl = {gateway_url.rstrip('/')}")
print(f"channels.{channel_id}.agentId = {agent_id}")
print(f"plugins.load.paths[0] = {connector_dir}")
PY

log "verified config. Restart OpenClaw gateway/app so the linked plugin reloads."
