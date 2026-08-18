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
| first-turn tool routing | `input` hook | 在 agent turn 启动前完成 gate → 真实用户输入 → classify → snapshot → `setActiveTools()`。 |

## Verified event ordering (0.84.2)

`AgentSession.prompt()` 的真实时序（源码级确认，见
`dist/core/agent-session.js`）：

```text
prompt(text, { source })
  ├─ 扩展命令 (/cmd) 立即执行（无 agent turn、无 input hook）
  ├─ emitInput(text, images, source ?? "interactive", streamingBehavior)   ← input hook
  ├─ skill / prompt template 展开
  ├─ streaming 队列（steer/followUp）或认证检查
  ├─ emitBeforeAgentStart(expandedText, images, baseSystemPrompt, ...)     ← before_agent_start
  └─ _runAgentPrompt(messages) → agent loop → streamFn → 第一个 LLM request
        (llmContext = { systemPrompt, messages, tools: agent.state.tools })
```

`setActiveToolsByName()` 的官方语义（`dist/core/agent-session.js`）：

> "Changes take effect on the next agent turn. Also rebuilds the system prompt
> to reflect the new tool set."

因此只要在 `input` hook 内调用 `setActiveTools()`，本次 prompt 的 agent turn
就是“下一个 turn”——第一个 LLM request 必然拿到缩减后的 tools，且
`before_agent_start` 收到并转发给 LLM 的 system prompt 已经重建为 core tool
列表（persona 追加在 core-tool prompt 之上，二者一致）。

## `input` hook 与 source handling

`InputEvent` 的官方 `source` 类型只有三种（`dist/core/extensions/types.d.ts`）：

```ts
export type InputSource = "interactive" | "rpc" | "extension";
```

- `interactive`：TUI / print-mode / 一次性 `-p` 输入；`session.prompt()` 默认值。
- `rpc`：SDK/RPC 的 `prompt` 命令（`dist/modes/rpc/rpc-mode.js`）。
- `extension`：扩展调用 `pi.sendUserMessage()`（`dist/core/agent-session.js`）。

覆盖边界：

| 启动路径 | 走 input hook？ | 说明 |
| --- | --- | --- |
| interactive TUI 输入、`-p` 一次性输入 | 是 (`interactive`) | 主路径 |
| RPC/SDK `prompt` 命令 | 是 (`rpc`) | `rpc-mode.js` 显式传 `source: "rpc"` |
| 扩展 `sendUserMessage` | 是 (`extension`) | 不参与任务分类 |
| 直接 `session.steer()` / `followUp()`（RPC steer/follow_up 命令、compaction 重放） | 否 | 只在已有 turn 进行中发生，不可能成为 session 首输入；其 LLM request 继承 input hook 建立的工具状态 |

本扩展按 source 分流：

- `interactive` / `rpc` 是真实用户输入：仅 session 的**第一个**真实用户任务固定
  自动 mode（`classifyTask`，override 优先），并执行 first-turn core subset
  缩减；后续用户输入只刷新 `currentTask`，并在首轮未发生 tool call 时恢复完整
  工具，防止缩减漂移到第二个任务。
- `extension` 输入严格不分类、不缩减；仅触发“首轮无 tool call 后的恢复”。
- `before_agent_start` 只做 gate、persona 注入与状态兜底（兜底仅在 input hook
  已标记为真实用户输入却未分类时生效），不再承担首次工具缩减。

## Actual hooks used

- `input`: first-turn routing（DeepSeek gate → 真实用户输入 → session state →
  classifyTask（仅首任务）→ snapshot original tools → `setActiveTools(core)`）。
- `session_start`: 恢复 session 时从首个 user message 推导 mode/persona；不缩减工具。
- `model_select`: DeepSeek 启用（snapshot 当前工具）、DeepSeek 间切换（保留
  override）、离开 DeepSeek 时恢复工具。
- `session_shutdown`: reload/session replacement 前恢复原始工具并清理当前 session 状态。
- `before_agent_start`: DeepSeek-only persona section 注入 + 状态兜底。
- `context`: DeepSeek weak mode 的 ephemeral guidance。
- `tool_call` / `tool_result`: 首次尝试或完成工具调用后恢复原始完整工具面
  （按 next-agent-turn 语义，对后续 LLM request 生效）。

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

发布到 Git 后可使用 Pi 的标准形式（当前发布版 v0.1.0）：

```bash
pi install git:github.com/RRain001/pi-deepseek-router@v0.1.0
```

或使用任意 tag / commit：

```bash
pi install git:github.com/RRain001/pi-deepseek-router@main
```
