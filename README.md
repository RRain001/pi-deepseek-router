# pi-deepseek-router

<div align="center">

<h2 align="center">为 Pi 中的 DeepSeek 模型提供任务感知路由</h2>

<p align="center">
  一个轻量级 Pi 扩展：为 <code>deepseek*</code> 模型适配 persona、首轮工具面与近场 guidance——同时保证<strong>其他所有模型完全不受影响</strong>。
</p>

[English](README.en.md) | 简体中文

[![Release](https://img.shields.io/github/v/release/RRain001/pi-deepseek-router?display_name=tag)](https://github.com/RRain001/pi-deepseek-router/releases)
[![License](https://img.shields.io/github/license/RRain001/pi-deepseek-router)](https://github.com/RRain001/pi-deepseek-router/blob/main/LICENSE)
![Pi extension](https://img.shields.io/badge/Pi-extension-blue)
![DeepSeek only](https://img.shields.io/badge/DeepSeek-only-4c8bf5)

</div>

---

## 这是什么？

`pi-deepseek-router` 是 [Pi](https://github.com/earendil-works/pi) 的任务感知路由扩展。

它**仅**在当前模型 ID 以 `deepseek` 开头时激活，精确匹配规则为：

```ts
model.id.toLowerCase().startsWith("deepseek")
```

模型匹配示例：

| 模型 ID | 路由 |
| --- | --- |
| `deepseek-v4-flash` | ✅ 已完成真实运行验证 |
| `gpt-*` | ❌ No-op |
| `claude-*` | ❌ No-op |
| `gemini-*` | ❌ No-op |
| `qwen-*` | ❌ No-op |
| `kimi-*` | ❌ No-op |

路由按模型 ID 前缀规则 `model.id.toLowerCase().startsWith("deepseek")` 激活。
但当前**只有 `deepseek-v4-flash` 被列为完成了真实运行验证**。其他 DeepSeek
型号可能命中该前缀规则，但本项目不宣称它们已经过测试或受支持。

Provider 名称被有意忽略。这意味着例如：

```text
opencode-go/deepseek-v4-flash
```

会被支持，因为其 **模型 ID** 是 `deepseek-v4-flash`。

---

## 为什么？

不同类型的编码任务适合不同的交互风格。

本扩展对第一个真实用户任务做分类，并提供三种用户级控制：

| 控制 | 典型任务 | 行为 |
| --- | --- | --- |
| `Auto`（推荐） | 任意 | 自动分类：构建类 → react，修复类 → spec，模糊类 → 内部 weak 带 |
| `Spec` | 调试、修复、审查 | 先探查后行动，保守 |
| `React` | 构建、创建、实现 | 直接产出 |

> `weak` 是 `Auto` 在任务类型模糊时的**内部路由带**，不作为用户级模式展示；
> `mixed` 是上游明确标记的实验带（explicit opt-in experimental band）。两者以及
> 数值模式（0-100 / 0.0-1.0）只能通过 legacy 命令 `/deepseek-router-mode`
> 显式设置，普通 UI 不展示。

路由器可以调整：

- DeepSeek 专属 persona；
- 首轮工具面；
- 临时的近场 guidance；
- 首次真实工具调用后的工具恢复。

它**不会**替换 Pi 的基础 system prompt。

---

## 安装

已作为 Pi package 发布到 npm（published as a Pi package on npm）。推荐通过 npm 安装：

```bash
pi install npm:pi-deepseek-router
```

备用方式 —— 直接从 GitHub 安装固定发布版：

```bash
pi install git:github.com/RRain001/pi-deepseek-router@v0.1.2
```

或跟踪最新 `main` 分支：

```bash
pi install git:github.com/RRain001/pi-deepseek-router@main
```

本地开发：

```bash
git clone https://github.com/RRain001/pi-deepseek-router.git
cd pi-deepseek-router
npm install
pi install .
```

一次性本地试运行：

```bash
pi -e ./src/index.ts
```

---

## 工作原理

对于 DeepSeek 模型，第一个真实用户输入的处理大致如下：

```text
用户输入
   │
   ▼
DeepSeek 模型门控
   │
   ▼
任务分类（Auto）或显式控制（Spec / React）
   │
   ├── spec
   ├── react
   └── weak（Auto 的内部模糊带）
   │
   ▼
首轮核心工具
   │
   ▼
DeepSeek persona
   │
   ▼
LLM 请求
   │
   ▼
首次真实工具调用
   │
   ▼
恢复原始完整工具面
```

对于每个非 DeepSeek 模型：

```text
输入
  │
  ▼
model.id 以 "deepseek" 开头？
  │
  └── 否 ──► 严格 no-op
```

---

## 首轮工具路由

第一个真实 DeepSeek 任务的首次 LLM 请求会收到与该模式匹配的保守工具子集。

例如，被路由到 `react` 的构建任务可能从以下工具开始：

```text
read
edit
write
```

而不是立刻暴露完整工具目录。

在首次真实工具调用之后，扩展会恢复原始工具面。

如果首轮没有调用任何工具，缩减后的工具面会在第二个真实用户任务开始前恢复。

这样可以防止首轮路由状态泄漏到后续任务。

---

## 近场 guidance

当自动分类或 legacy 设置落入 `weak` 带时，可以向当前 LLM 请求注入一条小型近场
guidance 消息。

该消息：

- 仅在当前请求内有效；
- 对普通对话界面隐藏；
- 不会作为真实用户消息插入；
- 不会持久化到用户的对话历史。

---

## 模型切换

模型切换被显式处理。

```text
非 DeepSeek → DeepSeek
```

路由器在下一个真实用户输入时激活，并快照当前工具面。

```text
DeepSeek → 非 DeepSeek
```

恢复原始工具面并禁用全部路由行为。

```text
DeepSeek → DeepSeek
```

路由状态（包括显式模式覆盖）在适当情况下保留。

---

## 命令

普通用户只需要记住一个命令：

```text
/router
```

### 无参数：模式选择器

```text
/router
```

弹出模式选择器，只展示三个用户级模式：

```text
DeepSeek Router · deepseek-v4-flash
Current: Auto → React

Auto — Automatic routing (recommended)
Spec — Debug / review / maintenance
React — Build / implement / modify
```

标题显示当前状态：配置控制（`Auto` / `Spec` / `React`）以及实际落到的 band。
如果当前是 `Auto`，会显示 `Auto → <实际 band>`。

### 带参数

```text
/router auto
/router spec
/router react
/router status
```

输入 `/router <Tab>` 或使用编辑器补全即可看到参数提示：

```text
auto   Automatic routing (recommended)
spec   Debug / review / maintenance
react  Build / implement / modify
status Show router status
```

### `/router status`

普通输出只显示用户级字段：

```text
enabled=true model=deepseek-v4-flash control=auto activeBand=react complexity=simple tools=core
```

- `control`：`auto` / `spec` / `react`；
- `activeBand`：`spec` / `weak` / `react`；
- `tools`：`core`（首轮核心工具面）或 `full`（已恢复完整工具面）。

内部调试字段（如 `firstTurnApplied`）不会出现在普通状态输出中。

### 非 DeepSeek 模型

`/router` 在非 DeepSeek 模型下**不会**打开可修改的选择器，只显示：

```text
DeepSeek Router
Disabled
Current model ID does not start with "deepseek".
```

严格 no-op 语义保持不变。

### Legacy aliases（向后兼容，已保留）

旧命令作为 backwards-compatible aliases 保留，主文档不再宣传；未来 major/minor
版本可能移除：

- `/deepseek-router-status` — 详细 debug 状态（含 `firstTurnApplied`、
  `toolsPromoted`、`override` 等内部字段）；
- `/deepseek-router-mode` — 完整模式解析，仍支持 `auto`、`spec`、`weak`、
  `mixed`、`react` 以及数值模式 `0-100` / `0.0-1.0`。

对非 DeepSeek 模型，这些命令不会改变任何代理行为。

---

## 严格非 DeepSeek no-op

本项目的核心设计要求：

> ID 不以 `deepseek` 开头的模型必须完全不受影响。

测试套件验证了：对非 DeepSeek 模型，扩展不会修改：

- system prompt；
- 请求消息；
- 活动工具；
- 路由状态；
- 近场 guidance。

从 DeepSeek 切换到其他模型时，也会恢复原始工具面。

## Troubleshooting

### 命令出现 `:1` / `:2` 后缀

如果命令列表里出现 `deepseek-router-status:1`、`deepseek-router-mode:1` 以及
对应的 `:2` 版本，说明**同一个扩展被加载了不止一次**。Pi 对重复命令名的处理是
保留全部并追加数字后缀（load order），而不是报错——因此这不是插件自身重复
`registerCommand`，本扩展每个命令只注册一次。

重复来自同一扩展的多个安装源同时存在：npm、git 与本地路径安装彼此视为不同包，
不会互相去重。检查方式：

```bash
pi list        # 列出已安装包及其来源（user / project）
pi config      # 查看每个包实际启用的资源，Tab 切换 global / project
```

找到重复条目后，在 `~/.pi/agent/settings.json`（全局）或 `.pi/settings.json`
（项目）的 `packages` 中只保留一份安装（例如保留 `npm:pi-deepseek-router`，
移除 git 或本地路径安装），然后重启 Pi。

---

## 已通过真实 DeepSeek 运行验证

本扩展既通过了 Pi 生命周期测试，也通过了真实模型端点测试。

### 真实运行 smoke

```text
REAL_DEEPSEEK_RUNTIME_TEST = PASS
```

验证于 2026-08-18，使用：

```text
deepseek/deepseek-v4-flash
opencode-go/deepseek-v4-flash
```

带探针的真实运行 smoke 验证了：

1. 首个请求收到了缩减后的核心工具面；
2. 实际 system prompt 包含 DeepSeek 路由 persona，且只列出对应的核心工具；
3. 真实模型执行了一次工具调用；
4. 随后的请求收到了恢复后的完整工具面；
5. weak 模式 guidance 到达了真实请求上下文；
6. 切换到 `opencode-go/qwen3.7-plus` 后产生严格 no-op。

在本地运行需要凭据的 smoke：

```bash
npm run smoke:real
```

见：

```text
scripts/runtime-smoke.spec.mts
```

真实端点 smoke 有意排除在常规 `npm test` 之外。

---

## 测试

运行常规测试套件：

```bash
npm test
```

类型检查：

```bash
npm run typecheck
```

构建：

```bash
npm run build
```

测试套件包含使用官方 Pi SDK 与脚本化 `ModelRuntime` 的**真实 Pi `AgentSession` 生命周期覆盖**。

它验证了：

- 首轮路由时序；
- 首个 LLM 请求的工具上下文；
- system prompt / 工具一致性；
- 首次工具调用后的恢复（promotion）；
- 无工具调用时的恢复；
- 交互式与 RPC 输入；
- 扩展生成的输入处理；
- 会话恢复行为；
- 模型切换；
- 会话隔离；
- weak 模式 guidance；
- 严格非 DeepSeek no-op 行为。

---

## 真实运行 smoke 配置

默认情况下，smoke 测试从以下位置读取 Pi 配置：

```text
~/.pi/agent
```

你可以覆盖 Pi 代理目录：

```bash
PI_AGENT_DIR=/path/to/pi/agent npm run smoke:real
```

或覆盖单个文件：

```bash
PI_AUTH_PATH=/path/to/auth.json \
PI_MODELS_PATH=/path/to/models.json \
npm run smoke:real
```

本仓库**绝不包含任何凭据**。

---

## 设计边界

本项目有意**不**做以下事情：

- 修改 Pi core；
- 修改 provider 载荷；
- 使用未公开/私有的 Pi API；
- 将路由 guidance 持久化到用户对话历史；
- 适配不以 `deepseek` 开头的模型；
- 实现原始 DSH `dev_mode_subagent`。

扩展只使用 Pi 的公开扩展 API。

---

## 项目结构

```text
pi-deepseek-router/
├── src/
│   ├── index.ts
│   ├── deepseek-gate.ts
│   ├── router-core.ts
│   ├── router-state.ts
│   └── guidance.ts
├── test/
│   └── lifecycle-real.test.ts
├── scripts/
│   └── runtime-smoke.spec.mts
├── docs/
│   ├── pi-api-mapping.md
│   └── provenance.md
├── README.md
├── README.en.md
├── NOTICE
└── LICENSE
```

---

## Provenance（来源与归属）

本项目是以下项目路由概念与部分逻辑的独立 Pi 移植/改编：

- [`yjh051108/dsh-router-standard`](https://github.com/yjh051108/dsh-router-standard)

参考的概念包括：

- 任务关键词分类；
- `spec` / `mixed` / `react` / `weak` 行为带；
- persona 选择；
- 近场 guidance 语义。

原项目为 MIT 许可。

上游相关的版权与许可声明保留在 [`NOTICE`](NOTICE) 中。

详见 [`docs/provenance.md`](docs/provenance.md)。

---

## 许可证

MIT。

见 [`LICENSE`](LICENSE)。

---

## 免责声明

DeepSeek 是其各自所有者的商标。

本项目是一个独立的社区扩展，与 DeepSeek 或 Pi 项目无关联，也未获其背书。
