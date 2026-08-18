import { describe, expect, it } from "vitest";

import { FakePi, inputEvent, makeContext } from "./test-harness.js";

const REACT_CORE = ["read", "edit", "write"];
const SPEC_CORE = ["read", "edit", "grep", "find", "ls"];

const SELECTOR_OPTIONS = [
	"Auto — Automatic routing (recommended)",
	"Spec — Debug / review / maintenance",
	"React — Build / implement / modify",
];

function setup(selectQueue: Array<string | undefined> = []) {
	const pi = new FakePi();
	pi.install();
	pi.selectQueue = [...selectQueue];
	const manager = { getBranch: () => [] };
	const model = { id: "deepseek-v4-flash", provider: "custom" };
	const ctx = makeContext(model, manager, pi.makeUi());
	return { pi, ctx, model, manager };
}

describe("/router command", () => {
	it("no-arg opens a selector with the three user modes and a stateful title", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router");
		expect(router).toBeDefined();

		// First real task classifies react; the selector title must reflect it.
		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		await router?.("", ctx);
		expect(pi.selectCalls).toHaveLength(1);
		expect(pi.selectCalls[0]!.title).toContain("DeepSeek Router · deepseek-v4-flash");
		expect(pi.selectCalls[0]!.title).toContain("Current: Auto → React");
		expect(pi.selectCalls[0]!.options).toEqual(SELECTOR_OPTIONS);
	});

	it("selector -> auto clears the override and keeps automatic routing", async () => {
		const { pi, ctx } = setup(["Auto — Automatic routing (recommended)"]);
		const router = pi.commands.get("router")!;

		// A react task becomes the session's first real task.
		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		// Force a spec override first, then switch back to auto via the selector.
		const legacy = pi.commands.get("deepseek-router-mode")!;
		await legacy("spec", ctx);
		expect(pi.getActiveTools()).toEqual(SPEC_CORE);

		await router("", ctx);
		expect(pi.selectCalls).toHaveLength(1);
		// The previous task still classifies react, so auto routes it back to react.
		expect(pi.notifications.at(-1)).toContain("mode=react");
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		// No override left: control is auto again. The session band stays fixed by
		// the first real task (react), and the first-turn reduction never drifts
		// into a second user task (tools restore).
		await pi.emit("input", inputEvent("fix the parser crash"), ctx);
		expect(pi.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
		await router("status", ctx);
		expect(pi.notifications.at(-1)).toContain("control=auto");
		expect(pi.notifications.at(-1)).toContain("activeBand=react");
	});

	it("selector -> spec applies the spec control", async () => {
		const { pi, ctx } = setup(["Spec — Debug / review / maintenance"]);
		const router = pi.commands.get("router")!;
		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		await router("", ctx);
		expect(pi.selectCalls).toHaveLength(1);
		expect(pi.notifications.at(-1)).toContain("mode=spec");
		expect(pi.getActiveTools()).toEqual(SPEC_CORE);
	});

	it("selector -> react applies the react control", async () => {
		const { pi, ctx } = setup(["React — Build / implement / modify"]);
		const router = pi.commands.get("router")!;
		await pi.emit("input", inputEvent("fix the parser crash"), ctx);
		expect(pi.getActiveTools()).toEqual(SPEC_CORE);

		await router("", ctx);
		expect(pi.selectCalls).toHaveLength(1);
		expect(pi.notifications.at(-1)).toContain("mode=react");
		expect(pi.getActiveTools()).toEqual(REACT_CORE);
	});

	it("selector cancel leaves router state untouched", async () => {
		const { pi, ctx } = setup([undefined]);
		const router = pi.commands.get("router")!;
		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);

		await router("", ctx);
		expect(pi.selectCalls).toHaveLength(1);
		expect(pi.notifications).toHaveLength(0);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);
	});

	it("/router auto | spec | react apply the control without a selector", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router")!;

		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		await router("spec", ctx);
		expect(pi.selectCalls).toHaveLength(0);
		expect(pi.notifications.at(-1)).toContain("mode=spec");
		expect(pi.getActiveTools()).toEqual(SPEC_CORE);

		await router("react", ctx);
		expect(pi.notifications.at(-1)).toContain("mode=react");
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		await router("auto", ctx);
		expect(pi.notifications.at(-1)).toContain("mode=react"); // reclassified from current task
		expect(pi.getActiveTools()).toEqual(REACT_CORE);
	});

	it("rejects weak/mixed/numeric through the user-facing command", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router")!;

		await router("weak", ctx);
		await router("mixed", ctx);
		await router("30", ctx);
		await router("0.3", ctx);
		expect(pi.selectCalls).toHaveLength(0);
		expect(pi.notifications.filter((message) => message.includes("invalid mode"))).toHaveLength(4);
		expect(pi.setCalls).toEqual([]);
	});

	it("status shows only the user-facing fields", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router")!;

		await pi.emit("input", inputEvent("please inspect this"), ctx); // weak band, simple
		await router("status", ctx);

		const message = pi.notifications.at(-1)!;
		expect(message).toContain("enabled=true");
		expect(message).toContain("model=deepseek-v4-flash");
		expect(message).toContain("control=auto");
		expect(message).toContain("activeBand=weak");
		expect(message).toContain("complexity=simple");
		expect(message).toContain("tools=core");
		// Debug internals stay out of the user-facing status.
		expect(message).not.toContain("firstTurnApplied");
		expect(message).not.toContain("toolsPromoted");
		expect(message).not.toContain("override=");
	});

	it("status reflects an explicit control and promotion", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router")!;

		await router("react", ctx);
		await pi.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName: "read", input: {} }, ctx);
		await router("status", ctx);

		const message = pi.notifications.at(-1)!;
		expect(message).toContain("control=react");
		expect(message).toContain("activeBand=react");
		expect(message).toContain("tools=full");
	});

	it("completions return only auto/spec/react/status with descriptions", async () => {
		const { pi } = setup();
		const options = pi.commandOptions.get("router")!;
		const completions = options.getArgumentCompletions?.("") as unknown;

		expect(completions).toEqual([
			{ value: "auto", label: "auto", description: "Automatic routing (recommended)" },
			{ value: "spec", label: "spec", description: "Debug / review / maintenance" },
			{ value: "react", label: "react", description: "Build / implement / modify" },
			{ value: "status", label: "status", description: "Show router status" },
		]);

		const prefixed = options.getArgumentCompletions?.("s") as Array<{ value: string }>;
		expect(prefixed.map((item) => item.value)).toEqual(["spec", "status"]);
		expect(options.getArgumentCompletions?.("x")).toBeNull();
	});

	it("non-DeepSeek /router is a strict no-op: no selector, Disabled display", async () => {
		const pi = new FakePi();
		pi.install();
		const ctx = makeContext({ id: "gpt-test-model", provider: "custom" }, { getBranch: () => [] }, pi.makeUi());
		const router = pi.commands.get("router")!;

		await router("", ctx);
		await router("react", ctx);
		await router("status", ctx);

		expect(pi.selectCalls).toHaveLength(0);
		expect(pi.setCalls).toEqual([]);
		const disabled = pi.notifications.filter((message) => message.startsWith("DeepSeek Router"));
		expect(disabled).toHaveLength(3);
		for (const message of disabled) {
			expect(message).toContain("DeepSeek Router");
			expect(message).toContain("Disabled");
			expect(message).toContain('Current model ID does not start with "deepseek".');
		}
	});

	it("legacy aliases remain compatible and keep weak/mixed/debug behavior", async () => {
		const { pi, ctx } = setup();
		const status = pi.commands.get("deepseek-router-status");
		const mode = pi.commands.get("deepseek-router-mode");
		expect(status).toBeDefined();
		expect(mode).toBeDefined();

		// weak / mixed overrides still work through the legacy alias.
		await mode?.("weak", ctx);
		expect(pi.notifications.at(-1)).toContain("mode=weak");
		await mode?.("mixed", ctx);
		expect(pi.notifications.at(-1)).toContain("mode=0.30");

		// Numeric legacy forms still parse (0-100 and 0.0-1.0).
		await mode?.("50", ctx);
		expect(pi.notifications.at(-1)).toContain("mode=0.50");
		await mode?.("0.25", ctx);
		expect(pi.notifications.at(-1)).toContain("mode=0.25");

		// Legacy status keeps detailed debug fields for power users.
		await status?.("", ctx);
		const detail = pi.notifications.at(-1)!;
		expect(detail).toContain("enabled=true");
		expect(detail).toContain("mode=0.25");
		expect(detail).toContain("firstTurnApplied=");
		expect(detail).toContain("toolsPromoted=");
	});
});
