# uniAgentGate OpenClaw Channel 管理员文档

本文面向 uniAgentGate 管理员，用于给 OpenClaw channel 用户签发 Agent 凭据并绑定手机号。

管理员掌握：

| 密钥 | 用途 | 是否下发给用户 |
|---|---|---|
| `ADMIN_TOKEN` | 创建 / 查看 Agent | 否 |
| `INTERNAL_TOKEN` | 内部 Runtime / 绑定查询 | 否 |
| `agentSk` | 单个 Agent 注册 Gateway | 是，只给对应用户 |

用户只需要拿到 `gatewayUrl`、`agentId`、`agentSk`。

## 1. 设置管理员环境变量

示例：

```bash
export BASE="http://106.74.40.193:18080"
export ADMIN_TOKEN="你的_admin_token"
export INTERNAL_TOKEN="你的_internal_token"
```

检查 Gateway 是否可用：

```bash
curl --noproxy '*' "$BASE/health"
```

检查管理员鉴权：

```bash
curl --noproxy '*' "$BASE/v1/admin/agents" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

## 2. 创建 Agent 并绑定手机号

手机号和 Agent 是 1:1 绑定。同一个手机号不能绑定多个 Agent。

```bash
export AGENT_ID="agent_18501206838"
export PHONE_NUMBER="+8618501206838"

CREATE_RESPONSE=$(curl --noproxy '*' -sS -X POST "$BASE/v1/admin/agents" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"agent_id\":\"$AGENT_ID\",
    \"name\":\"OpenClaw Agent 18501206838\",
    \"phone_number\":\"$PHONE_NUMBER\",
    \"agent_runtime\":\"openclaw\",
    \"metadata\":{\"channel\":\"uniagentgate\"}
  }")

echo "$CREATE_RESPONSE"
```

响应中会返回明文 `sk`：

```json
{
  "agent_id": "agent_18501206838",
  "phone_number": "+8618501206838",
  "sk": "uag_sk_xxx",
  "created_at": "2026-05-27T10:00:00Z"
}
```

重要规则：

- `sk` 只在创建时返回一次。
- Gateway 只保存 bcrypt 哈希，不保存明文。
- 请立即把 `sk` 安全保存，并只发给对应用户。
- 不要把 `ADMIN_TOKEN` 或 `INTERNAL_TOKEN` 发给用户。

提取 `agentSk`：

```bash
export AGENT_SK=$(printf '%s' "$CREATE_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sk"])')
echo "$AGENT_SK"
```

## 3. 下发给用户的信息

给用户发送下面三项：

```text
gatewayUrl: http://106.74.40.193:18080
agentId: agent_18501206838
agentSk: uag_sk_xxx
```

建议同时发送用户安装文档：`docs/USER_CHANNEL_INSTALL.md`。

## 4. 确认 Agent 在线

用户安装并重启 OpenClaw 后，查看状态：

```bash
curl --noproxy '*' "$BASE/v1/admin/agents" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

状态含义：

| status | 含义 |
|---|---|
| `online` | 最近 30 秒内有心跳 |
| `degraded` | 30-90 秒内有心跳 |
| `unhealthy` | 超过 90 秒无心跳 |
| `unknown` | 从未注册或心跳 |

## 5. 检查手机号绑定解析

供管理员排查 RCS / SIP Video 路由：

```bash
curl --noproxy '*' "$BASE/v1/bindings/phone/$PHONE_NUMBER" \
  -H "X-Internal-Token: $INTERNAL_TOKEN"
```

期望：

```json
{
  "phone_number": "+8618501206838",
  "agent_id": "agent_18501206838",
  "status": "online",
  "endpoint_url": "...",
  "agent_runtime": "openclaw"
}
```

如果返回 `404 not_found`，说明手机号没有绑定。

如果返回 `unhealthy`，说明绑定存在，但用户的 connector 不在线。

## 6. RCS 冒烟测试

用绑定手机号模拟一条 RCS 上行：

```bash
curl --noproxy '*' -sS -X POST "$BASE/v1/channel-runtimes/rcs/webhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"context\":\"你好\",
    \"decryptPhone\":\"$PHONE_NUMBER\",
    \"file_url\":null,
    \"signature\":null,
    \"timestamp\":null,
    \"nonce\":null,
    \"appId\":null
  }"
```

如果 Agent 在线，Gateway 会把消息投递给对应 OpenClaw connector，并返回下行文本。

## 7. SIP Video 排查

SIP Video 依赖手机号绑定。先确认来电号码能解析：

```bash
curl --noproxy '*' "$BASE/v1/bindings/phone/$PHONE_NUMBER" \
  -H "X-Internal-Token: $INTERNAL_TOKEN"
```

电话接通但 Agent 没回复时看 Gateway 日志：

```bash
curl --noproxy '*' "$BASE/v1/admin/logs?lines=300" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

重点搜索：

```text
channel.session.started
agent.request
visual.frame
BridgeCallSession transcript
connection.accepted
```

## 8. 凭据丢失

当前阶段没有公开的 SK 轮转 / 撤销接口。

如果用户丢失 `agentSk` 或怀疑泄露，请联系平台维护者处理。不要把管理员 token 下发给用户，也不要让用户自行修改数据库。
