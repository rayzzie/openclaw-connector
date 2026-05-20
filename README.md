# OpenClaw Connector

TypeScript runtime for connecting an OpenClaw-compatible Agent process to uniAgentGate.

Current M2 scope:

- register with `uniagent_runtime`
- keep the Agent session alive
- connect to the Gateway WebSocket transport
- handle envelope ack/dedupe
- run a mock Agent stream for M2 validation

This package is an independent process. It does not contain channel logic, media handling, or real OpenClaw SDK integration yet.

## Local

```bash
npm install
npm run build
npm test
npm run dev
```

## Mock Modes

Set `MOCK_MODE` before starting the connector:

- `happy`: ack request and emit `response.started`, two `output.delta` events, then `response.completed`
- `ack_drop`: do not ack the incoming `agent.request`; Gateway should close with `4001`
- `sequence_gap`: emit sequence `1`, `3`, `4`
- `slow`: emit the happy stream with slow deltas
- `crash_after_started`: emit `response.started`, then close the WS

```bash
MOCK_MODE=happy npm run dev
MOCK_MODE=ack_drop npm run dev
```

## Docker

```bash
docker compose build
UAG_AGENT_SK=<sk> docker compose up
```

By default the connector container reaches the Gateway at `http://host.docker.internal:8080`.

## M2 Smoke

The smoke script starts `uniagent_runtime`, creates an Agent, starts this connector in `happy` and `ack_drop` modes, dispatches mock Agent requests through the Gateway internal smoke endpoint, and validates `response.completed` plus Gateway `4001` timeout behavior.

```bash
./scripts/m2_smoke.sh
```

Expected final line:

```text
M2 SMOKE OK
```
