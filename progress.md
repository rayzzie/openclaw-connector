# Progress

| commit | 时间 | 模块 | 修改文件 | 验证方式 |
|---|---|---|---|---|
| 5392e4a | 2026-05-19 | connector scaffold | package.json, tsconfig.json, src/config.ts 等 | npm run typecheck |
| 8e90733 | 2026-05-19 | connector HTTP | src/gatewayClient.ts, src/index.ts | npm run typecheck |
| 93ab7d4 | 2026-05-19 | connector WS | src/wsTransport.ts, src/index.ts | npm run build |
| b2940a6 | 2026-05-19 | DoD 修补: protocol | src/protocol.ts | npm run build |
| 05d41cd | 2026-05-19 | DoD 修补: logger | src/logger.ts, src/config.ts, src/index.ts, src/wsTransport.ts | npm run build |
| 47814a7 | 2026-05-19 | DoD 修补: ws transport | src/ws-client.ts, src/index.ts | npm run build |
| 921dec6 | 2026-05-19 | DoD 修补: reconnect | src/reconnect.ts | npm run build |
| 095a947 | 2026-05-19 | DoD 修补: runtime | src/runtime.ts, src/cli.ts, src/gateway-http-client.ts, package.json | npm run build |
| 8615ed6 | 2026-05-19 | DoD 修补: tests | tests/*.test.ts, src/runtime.ts | npm run build && npm test |
| 8ca67cd | 2026-05-19 | connector ack | src/ack-tracker.ts, src/dedupe-cache.ts, src/envelope-router.ts, tests/*ack* 等 | npm run build && npm test |
| ef9c9db | 2026-05-19 | connector mock agent | src/mock-agent.ts, src/stream-emitter.ts, src/sequence-generator.ts | npm run build && npm test |
| TBD | 2026-05-20 | connector docker smoke | Dockerfile, docker-compose.yml, scripts/m2_smoke.sh, README.md | npm run build && npm test && docker compose config; ./scripts/m2_smoke.sh blocked: Docker daemon unavailable |
