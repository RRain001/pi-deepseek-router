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

The package is git-installable once published:

```bash
pi install git:github.com/<owner>/pi-deepseek-router@<tag-or-commit>
```

## Behavior

- `spec`, `mixed`, `react`, and `weak` modes are derived from the first user task.
- `weak` uses model-family persona selection and ephemeral near-field guidance.
- The first request may receive a conservative core tool subset resolved from
  Pi's actual catalog.
- The first attempted or completed tool call restores the session's original
  active tool set; later requests keep the full set.
- Switching away from DeepSeek restores the original tools and disables all
  router behavior. Switching back snapshots the then-current tools again.
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

The test suite includes the gate, strict non-DeepSeek no-op, router core,
persona insertion, model switching, tool promotion, and per-session state
boundaries. Provenance and the reference-license boundary are documented in
[`docs/provenance.md`](docs/provenance.md); Pi API mapping is in
[`docs/pi-api-mapping.md`](docs/pi-api-mapping.md).

Runtime credential status for this checkout:

```text
REAL_DEEPSEEK_RUNTIME_TEST = NOT_RUN_NO_CREDENTIALS
```
