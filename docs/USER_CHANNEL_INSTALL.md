# uniAgentGate OpenClaw Channel 用户安装文档

本文面向安装 OpenClaw channel 的使用者。你只需要从管理员处拿到 3 个信息：

| 配置项 | 示例 | 说明 |
|---|---|---|
| `gatewayUrl` | `http://106.74.40.193:18080` | uniAgentGate 服务地址 |
| `agentId` | `agent_18501206838` | 管理员为你创建的 Agent ID |
| `agentSk` | `uag_sk_xxx` | Agent secret key，只用于连接 Gateway |

不要向任何人索要 `ADMIN_TOKEN` 或 `INTERNAL_TOKEN`；那是平台管理员使用的密钥。

## 1. 环境要求

- 已安装 OpenClaw
- 已安装 Node.js 20+
- 已安装 npm
- 已安装 python3
- 能访问管理员提供的 `gatewayUrl`

检查命令：

```bash
node -v
npm -v
python3 --version
openclaw --version
```

如果 `openclaw` 命令不在 `PATH`，安装脚本运行时可以用 `OPENCLAW_BIN=/path/to/openclaw` 指定。

## 2. 解压或进入 connector 目录

假设你拿到的目录名是 `openclaw_connector`：

```bash
cd /path/to/openclaw_connector
```

目录里应至少包含：

```text
openclaw.plugin.json
package.json
scripts/reinstall_openclaw_connector.sh
src/
```

## 3. 安装并写入 OpenClaw 配置

把管理员给你的三项配置填入下面命令：

```bash
export UAG_GATEWAY_BASE_URL="http://106.74.40.193:18080"
export UAG_AGENT_ID="你的_agent_id"
export UAG_AGENT_SK="你的_uag_sk"

./scripts/reinstall_openclaw_connector.sh
```

脚本会做这些事：

1. 安装 npm 依赖
2. 构建 connector
3. 备份 OpenClaw 配置文件
4. 把当前 connector 路径写入 OpenClaw plugin 加载路径
5. 写入 `channels.uniagentgate.gatewayUrl / agentId / agentSk`

默认配置文件位置：

```text
~/.openclaw/openclaw.json
```

如果你的 OpenClaw 配置文件不在默认位置：

```bash
export OPENCLAW_CONFIG_PATH="/path/to/openclaw.json"
./scripts/reinstall_openclaw_connector.sh
```

如果要禁用 OpenClaw 里的其它 channel，只保留 uniAgentGate：

```bash
export UAG_DISABLE_OTHER_CHANNELS=1
./scripts/reinstall_openclaw_connector.sh
```

## 4. 重启 OpenClaw

安装完成后，重启 OpenClaw 应用或 OpenClaw Gateway 进程，让插件重新加载。

启动后 connector 会自动：

1. 使用 `agentSk` 向 uniAgentGate 注册
2. 建立 WebSocket 长连接
3. 持续心跳
4. 接收 RCS / SIP Video 请求
5. 把 OpenClaw 回复转成 Gateway 事件

## 5. 验证是否在线

让管理员在 Gateway 上查看你的 Agent 状态。如果状态是 `online`，说明安装成功。

你本地也可以查看 OpenClaw 日志，搜索这些关键词：

```text
uniAgentGate
connection.accepted
registered
heartbeat
channel.session.started
visual.frame
```

## 6. SIP Video 屏幕画面权限

如果此版本启用了桌面截图下行，首次运行可能需要给 OpenClaw 或启动它的终端授予屏幕录制权限。

macOS 路径：

```text
系统设置 → 隐私与安全性 → 屏幕录制
```

如果没有权限，connector 可能会降级为测试画面或没有下行画面。

## 7. 常见问题

### `openclaw CLI not found`

设置 OpenClaw CLI 路径：

```bash
export OPENCLAW_BIN="/path/to/openclaw"
./scripts/reinstall_openclaw_connector.sh
```

### Agent 一直不是 online

检查：

- `UAG_GATEWAY_BASE_URL` 是否能访问
- `UAG_AGENT_ID` 是否和管理员创建的一致
- `UAG_AGENT_SK` 是否复制完整
- OpenClaw 是否已重启
- 本机网络是否能访问 Gateway 端口

### 更换 Agent 或手机号

不要自己改手机号绑定。联系管理员重新签发 Agent 配置。
