# pi-deepseek-router

An independent Pi extension that applies task-aware routing only when the active
model ID matches:

```ts
model.id.toLowerCase().startsWith("deepseek")
```

Every other model is intentionally untouched. The extension does not inspect
provider names and does not use a deny-list.

## Install

For a local checkout:

```bash
pi install ./pi-deepseek-router
```

For a one-run smoke test:

```bash
pi -e ./pi-deepseek-router/src/index.ts
```

The current release (v0.1.0) can be installed directly from Git:

```bash
pi install git:github.com/RRain001/pi-deepseek-router@v0.1.0
```

Or from the main branch:

```bash
pi install git:github.com/RRain001/pi-deepseek-router@main
```

## Behavior

- `spec`, `mixed`, `react`, and `weak` modes are derived from the first real
  user task (interactive or RPC input). Extension-generated input never
  classifies a task.
- `weak` uses model-family persona selection and ephemeral near-field guidance.
- The first LLM request of the first user task receives a conservative core
  tool subset, resolved from Pi's actual catalog. Routing happens in the public
  `input` hook — strictly before `before_agent_start` and before the agent turn
  starts — so the reduction reaches the first request (verified by real
  AgentSession lifecycle tests, not just unit tests).
- The first attempted or completed tool call restores the session's original
  active tool set; later requests keep the full set.
- If the first turn makes no tool call, the reduction is undone before the
  second user task starts; it never drifts into a second task.
- Switching away from DeepSeek restores the original tools and disables all
  router behavior. Switching back snapshots the then-current tools again and
  routes the next real user input.
- The original Pi system prompt remains intact; the extension appends one
  marked `## DeepSeek Router` section per request.

Commands:

```text
/deepseek-router-status
/deepseek-router-mode auto|spec|weak|mixed|react|0-100|0.0-1.0
```

Commands are visible for all models, but they are strict no-ops for non-DeepSeek
models and report:

```text
reason=model-id-does-not-start-with-deepseek
```

## Scope exclusions

This first version does not implement `dev_mode_subagent`. Pi has no public
equivalent of DSH `ctx.llm.stream` for an isolated mode-specific LLM context,
so the extension does not call undocumented/private APIs.

The extension also does not modify Pi core, provider payloads, session history,
or user messages.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

The test suite covers the gate, strict non-DeepSeek no-op, router core, persona
insertion, model switching, tool promotion, per-session state boundaries, and
source handling — plus a real-lifecycle suite that drives an actual Pi
`AgentSession` (official SDK `createAgentSession` + inline extension factory)
with a scripted model runtime and asserts on the LLM request contexts the model
would receive (`input` → `before_agent_start` → first LLM request ordering,
first tool call promotion, second-user-task behavior, model switches, session
isolation). Provenance and the reference-license boundary are documented in
[`docs/provenance.md`](docs/provenance.md); Pi API mapping and the verified
first-turn event ordering are in [`docs/pi-api-mapping.md`](docs/pi-api-mapping.md).

Runtime credential status for this checkout:

```text
REAL_DEEPSEEK_RUNTIME_TEST = NOT_RUN_NO_CREDENTIALS
```
