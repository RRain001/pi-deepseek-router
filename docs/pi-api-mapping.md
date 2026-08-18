# Pi API mapping

调查基线：本机 `@earendil-works/pi-coding-agent` 0.84.2，安装路径为
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`。对应官方仓库为
[`earendil-works/pi`](https://github.com/earendil-works/pi)，本实现只使用公开 extension API。

| DSH/Cordis 概念 | Pi 对应 | 本扩展边界 |
| --- | --- | --- |
| `system-prompt/assemble` | `before_agent_start` | 保留 Pi 已组装的 system prompt，仅追加带 marker 的 `## DeepSeek Router` section；不重建或删除 Pi prompt。 |
| `session/event` | `session_start`、`model_select`、`tool_call`、`tool_result` | 不依赖 DSH durable event shape；每个 Pi session 由 `sessionManager` 对象作为 `WeakMap` key。 |
| `ctx.tools` | `pi.getAllTools()`、`pi.getActiveTools()`、`pi.setActiveTools()` | 从实际 Pi tool catalog 解析 `read/edit/write/search` 别名；不存在的工具忽略。 |
| near-field inbox guidance | `context` | 修改每次 LLM request 的消息副本，追加隐藏 custom message；不调用 `sendUserMessage()`，不写入永久会话历史。 |
| `agent.options.model` | `ctx.model` / `model_select` 的 `event.model` | gate 只检查 `model.id`，不检查 provider。 |
| `ctx.llm.stream` | 无公开一一对应接口 | `dev_mode_subagent` / 独立 subagent 不实现，不使用 undocumented/private API。 |

## Actual hooks used

- `session_start`: DeepSeek session 的初始工具快照；恢复 session 时从首个 user message 推导模式。
- `model_select`: DeepSeek 启用、DeepSeek 间切换、离开 DeepSeek 时恢复工具。
- `session_shutdown`: reload/session replacement 前恢复原始工具并清理当前 session 状态。
- `before_agent_start`: DeepSeek-only persona section。
- `context`: DeepSeek weak mode 的 ephemeral guidance。
- `tool_call` / `tool_result`: 首次尝试或完成工具调用后恢复原始完整工具面。

## Package/install contract

Pi package 使用 `package.json` 的 `pi.extensions` 指向 `./src/index.ts`。Pi 官方文档说明
TypeScript extension 会由 jiti 加载；运行时依赖不引入额外框架，Pi core 作为 peer dependency。

本地试运行：

```bash
pi -e ./src/index.ts
```

本地 package 安装：

```bash
pi install ./pi-deepseek-router
```

发布到 Git 后可使用 Pi 的标准形式：

```bash
pi install git:github.com/<owner>/pi-deepseek-router@<tag-or-commit>
```
