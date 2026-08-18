# pi-deepseek-router

<p align="center">
  <strong>Task-aware routing for DeepSeek models in Pi</strong>
</p>

<p align="center">
  A lightweight Pi extension that adapts persona, first-turn tools, and
  near-field guidance for <code>deepseek*</code> models — while leaving every
  other model untouched.
</p>

<p align="center">
  <a href="https://github.com/RRain001/pi-deepseek-router/releases">
    <img src="https://img.shields.io/github/v/release/RRain001/pi-deepseek-router?display_name=tag" alt="Release">
  </a>
  <a href="https://github.com/RRain001/pi-deepseek-router/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/RRain001/pi-deepseek-router" alt="License">
  </a>
  <a href="https://github.com/RRain001/pi-deepseek-router">
    <img src="https://img.shields.io/badge/Pi-extension-blue" alt="Pi extension">
  </a>
  <img src="https://img.shields.io/badge/DeepSeek-only-4c8bf5" alt="DeepSeek only">
</p>

---

## What is this?

`pi-deepseek-router` is a task-aware routing extension for
[Pi](https://github.com/earendil-works/pi).

It activates **only** when the current model ID starts with:

```ts
deepseek
```

The exact gate is:

```ts
model.id.toLowerCase().startsWith("deepseek")
```

Examples:

| Model ID | Router |
| --- | --- |
| `deepseek-v4-flash` | ✅ Runtime verified |
| `gpt-*` | ❌ No-op |
| `claude-*` | ❌ No-op |
| `gemini-*` | ❌ No-op |
| `qwen-*` | ❌ No-op |
| `kimi-*` | ❌ No-op |

The router activates based on the model ID prefix rule
`model.id.toLowerCase().startsWith("deepseek")`. However, only
`deepseek-v4-flash` is currently listed as runtime-verified. Other DeepSeek
model IDs may match the routing rule but are not claimed as tested or
supported here.

Provider names are intentionally ignored.

That means a model such as:

```text
opencode-go/deepseek-v4-flash
```

is supported because its **model ID** is `deepseek-v4-flash`.

---

## Why?

Different coding tasks benefit from different interaction styles.

This extension classifies the first real user task and exposes three
user-level controls:

| Control | Typical task | Behavior |
| --- | --- | --- |
| `Auto` (recommended) | any | automatic classification: build → react, fix → spec, ambiguous → internal weak band |
| `Spec` | debugging, fixing, reviewing | inspect-first, conservative |
| `React` | building, creating, implementing | hands-on production |

> `weak` is the **internal routing band** `Auto` uses for ambiguous tasks; it is
> not a user-level mode. `mixed` is an upstream-marked experimental band
> (explicit opt-in). Both, plus numeric modes (`0-100` / `0.0-1.0`), are only
> settable through the legacy `/deepseek-router-mode` alias and are not shown in
> the normal UI.

The router can then adjust:

- the DeepSeek-specific persona;
- the first-turn tool surface;
- ephemeral near-field guidance;
- tool promotion after the first real tool call.

It does **not** replace Pi's base system prompt.

---

## Install

Published as a Pi package on npm. The recommended way is via npm:

```bash
pi install npm:pi-deepseek-router
```

Alternatively, install a pinned release directly from GitHub:

```bash
pi install git:github.com/RRain001/pi-deepseek-router@v0.1.2
```

Or track the latest `main` branch:

```bash
pi install git:github.com/RRain001/pi-deepseek-router@main
```

For local development:

```bash
git clone https://github.com/RRain001/pi-deepseek-router.git
cd pi-deepseek-router
npm install
pi install .
```

For a one-run local test:

```bash
pi -e ./src/index.ts
```

---

## How it works

For a DeepSeek model, the first real user input follows approximately:

```text
user input
   │
   ▼
DeepSeek model gate
   │
   ▼
task classification (Auto) or explicit control (Spec / React)
   │
   ├── spec
   ├── react
   └── weak (Auto's internal ambiguous band)
   │
   ▼
first-turn core tools
   │
   ▼
DeepSeek persona
   │
   ▼
LLM request
   │
   ▼
first real tool call
   │
   ▼
restore original full tool set
```

For every non-DeepSeek model:

```text
input
  │
  ▼
model.id startsWith("deepseek")?
  │
  └── no ──► strict no-op
```

---

## First-turn tool routing

The first LLM request of the first real DeepSeek task receives a conservative
tool subset appropriate for the selected mode.

For example, a build task routed to `react` may begin with:

```text
read
edit
write
```

instead of exposing the complete tool catalog immediately.

After the first actual tool call, the extension restores the original tool set.

If the first turn does not call a tool, the reduced tool set is restored before
the second real user task begins.

This prevents first-turn routing state from leaking into later tasks.

---

## Ephemeral guidance

When automatic classification (or a legacy setting) lands in the `weak` band,
the router can inject a small near-field guidance message into the current LLM
request.

The message is:

- request-local;
- hidden from the normal conversation UI;
- not inserted as a real user message;
- not persisted into the user's conversation history.

---

## Model switching

Model switching is handled explicitly.

```text
non-DeepSeek → DeepSeek
```

The router activates on the next real user input and snapshots the current tool
set.

```text
DeepSeek → non-DeepSeek
```

The original tool set is restored and router behavior is disabled.

```text
DeepSeek → DeepSeek
```

Router state is preserved where appropriate, including an explicit mode
override.

---

## Commands

Normal users only need to remember one command:

```text
/router
```

### No arguments: mode selector

```text
/router
```

Opens a mode selector with exactly three user-level modes:

```text
DeepSeek Router · deepseek-v4-flash
Current: Auto → React

Auto — Automatic routing (recommended)
Spec — Debug / review / maintenance
React — Build / implement / modify
```

The title shows the current state: the configured control (`Auto` / `Spec` /
`React`) and the actual band. Under `Auto` it shows `Auto → <actual band>`.

### With arguments

```text
/router auto
/router spec
/router react
/router status
```

Typing `/router <Tab>` (or editor completion) shows:

```text
auto   Automatic routing (recommended)
spec   Debug / review / maintenance
react  Build / implement / modify
status Show router status
```

### `/router status`

Normal output shows only user-level fields:

```text
enabled=true model=deepseek-v4-flash control=auto activeBand=react complexity=simple tools=core
```

- `control`: `auto` / `spec` / `react`;
- `activeBand`: `spec` / `weak` / `react`;
- `tools`: `core` (first-turn core surface) or `full` (restored).

Internal debug fields (such as `firstTurnApplied`) are not shown in normal
status output.

### Non-DeepSeek models

On non-DeepSeek models `/router` does **not** open a mutable selector; it only
displays:

```text
DeepSeek Router
Disabled
Current model ID does not start with "deepseek".
```

The strict no-op semantics are unchanged.

### Legacy aliases (backwards-compatible, retained)

The old commands remain as backwards-compatible aliases but are no longer
promoted in the main documentation; they may be removed in a future
major/minor version:

- `/deepseek-router-status` — detailed debug status (includes internal fields
  such as `firstTurnApplied`, `toolsPromoted`, `override`);
- `/deepseek-router-mode` — full mode parsing, still accepting `auto`, `spec`,
  `weak`, `mixed`, `react`, and numeric modes `0-100` / `0.0-1.0`.

For non-DeepSeek models these commands do not modify agent behavior.

---

## Strict non-DeepSeek no-op

A core design requirement of this project is:

> Models whose ID does not begin with `deepseek` must remain untouched.

The test suite verifies that for non-DeepSeek models the extension does not
modify:

- system prompts;
- request messages;
- active tools;
- router state;
- near-field guidance.

Switching from DeepSeek to another model also restores the original tool set.

---

## Troubleshooting

### Commands appear with `:1` / `:2` suffixes

If the command list shows `deepseek-router-status:1`, `deepseek-router-mode:1`
and the matching `:2` variants, the **same extension is loaded more than
once**. Pi keeps all duplicate command names and assigns numeric invocation
suffixes in load order instead of failing — so this is not the extension itself
calling `registerCommand` twice (each command is registered exactly once).

The duplication comes from having several installation sources of the same
extension active at the same time: npm, git, and local-path installs are
treated as distinct packages and are not deduplicated against each other. To
locate the duplicates:

```bash
pi list        # list installed packages and their sources (user / project)
pi config      # inspect which resources each package actually enables; Tab switches global / project
```

Then keep only one installation: edit `packages` in
`~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project) to retain
a single source (for example keep `npm:pi-deepseek-router` and remove the git
or local-path install), and restart Pi.

---

## Verified with real DeepSeek runtimes

The extension has been tested both with Pi lifecycle tests and real model
endpoints.

### Real runtime smoke

```text
REAL_DEEPSEEK_RUNTIME_TEST = PASS
```

Verified on August 18, 2026 with:

```text
deepseek/deepseek-v4-flash
opencode-go/deepseek-v4-flash
```

The instrumented real-runtime smoke verified:

1. the first request received the reduced core tool set;
2. the actual system prompt contained the DeepSeek router persona and only the
   corresponding core tools;
3. the real model executed a tool call;
4. the following request received the restored full tool set;
5. weak-mode guidance reached the real request context;
6. switching to `opencode-go/qwen3.7-plus` produced a strict no-op.

Run the credentialed smoke locally with:

```bash
npm run smoke:real
```

See:

```text
scripts/runtime-smoke.spec.mts
```

The real-endpoint smoke is intentionally excluded from ordinary `npm test`.

---

## Tests

Run the normal test suite:

```bash
npm test
```

Type checking:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

The test suite includes real Pi `AgentSession` lifecycle coverage using the
official Pi SDK and a scripted `ModelRuntime`.

It verifies:

- first-turn routing timing;
- first LLM request tool context;
- system-prompt/tool consistency;
- first-tool promotion;
- no-tool-call recovery;
- interactive and RPC inputs;
- extension-generated input handling;
- session resume behavior;
- model switching;
- session isolation;
- weak-mode guidance;
- strict non-DeepSeek no-op behavior.

---

## Real-runtime smoke configuration

By default the smoke test reads Pi configuration from:

```text
~/.pi/agent
```

You can override the Pi agent directory:

```bash
PI_AGENT_DIR=/path/to/pi/agent npm run smoke:real
```

Or override individual files:

```bash
PI_AUTH_PATH=/path/to/auth.json \
PI_MODELS_PATH=/path/to/models.json \
npm run smoke:real
```

Credentials are never included in this repository.

---

## Design boundaries

This project intentionally does not:

- modify Pi core;
- patch provider payloads;
- use undocumented/private Pi APIs;
- persist router guidance into user conversation history;
- adapt models that do not begin with `deepseek`;
- implement the original DSH `dev_mode_subagent`.

The extension uses Pi's public extension API.

---

## Project structure

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
├── NOTICE
└── LICENSE
```

---

## Provenance

This project is an independent Pi port/adaptation of routing concepts and
selected logic from:

- [`yjh051108/dsh-router-standard`](https://github.com/yjh051108/dsh-router-standard)

Referenced concepts include:

- task keyword classification;
- `spec` / `mixed` / `react` / `weak` behavior bands;
- persona selection;
- near-field guidance semantics.

The original project is MIT licensed.

The relevant upstream copyright and license notice is retained in
[`NOTICE`](NOTICE).

See [`docs/provenance.md`](docs/provenance.md) for details.

---

## License

MIT.

See [`LICENSE`](LICENSE).

---

## Disclaimer

DeepSeek is a trademark of its respective owner.

This project is an independent community extension and is not affiliated with
or endorsed by DeepSeek or the Pi project.
