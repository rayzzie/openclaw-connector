# OpenClaw Connector

TypeScript runtime for connecting an OpenClaw-compatible Agent process to uniAgentGate.

Current M2 scope:

- register with `uniagent_runtime`
- keep the Agent session alive
- connect to the Gateway WebSocket transport

This package is an independent process. It does not contain channel logic, media handling, or real OpenClaw SDK integration yet.
