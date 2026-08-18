import { describe, expect, it } from "vitest";

import { FakePi, inputEvent, makeContext } from "./test-harness.js";

const REACT_CORE = ["read", "edit", "write"];
const SPEC_CORE = ["read", "edit", "grep", "find", "ls"];

const SELECTOR_OPTIONS = [
	"Auto — Automatic routing (recommended)",
	"Spec — Debug / review / maintenance",
	"React — Build / implement / modify",
	"Status — Show current router status",
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
	it("no-arg opens a selector with Auto/Spec/React/Status and a stateful title", async () => {
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

	it("selector and argument completions expose the same four entries in the same order", async () => {
		const { pi } = setup();
		const completions = pi.commandOptions.get("router")!.getArgumentCompletions?.("") as Array<{ value: string }>;
		// Auto → Spec → React → Status (lowercase completions, label order identical).
		expect(SELECTOR_OPTIONS.map((option) => option.split(" ")[0]!.toLowerCase())).toEqual([
			"auto",
			"spec",
			"react",
			"status",
		]);
		expect(completions.map((completion) => completion.value)).toEqual(["auto", "spec", "react", "status"]);
	});

	it("selector -> auto clears the override and keeps automatic routing", async () => {
		const { pi, ctx } = setup(["Auto — Automatic routing (recommended)"]);
		const router = pi.commands.get("router")!;

		// A react task becomes the session's first real task.
		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);

		// Force a spec override first, then switch back to auto via the selector.
		await router("spec", ctx);
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

	it("selector -> Status shows the same status as /router status without changing state", async () => {
		const { pi, ctx } = setup(["Status — Show current router status"]);
		const router = pi.commands.get("router")!;

		// Session is routed (react core active, mode fixed by the first task).
		await pi.emit("input", inputEvent("build a new command-line tool"), ctx);
		expect(pi.getActiveTools()).toEqual(REACT_CORE);
		const toolsBefore = pi.getActiveTools();

		await router("", ctx);
		// 1. selector closed after one call; 2. status shown; 3. nothing mutated.
		expect(pi.selectCalls).toHaveLength(1);
		expect(pi.notifications.at(-1)).toContain("enabled=true");
		expect(pi.notifications.at(-1)).toContain("control=auto");
		expect(pi.notifications.at(-1)).toContain("activeBand=react");
		expect(pi.notifications.at(-1)).toContain("tools=core");
		expect(pi.getActiveTools()).toEqual(toolsBefore);

		// The view-only status must equal `/router status` output exactly.
		const fromSelector = pi.notifications.at(-1);
		await router("status", ctx);
		expect(pi.notifications.at(-1)).toBe(fromSelector);
		expect(pi.selectCalls).toHaveLength(1); // no second selector
		expect(pi.getActiveTools()).toEqual(toolsBefore); // still untouched
	});

	it("selector -> Status does not promote tools or touch promotion flags", async () => {
		const { pi, ctx } = setup(["Status — Show current router status"]);
		const router = pi.commands.get("router")!;

		await router("", ctx);
		expect(pi.selectCalls).toHaveLength(1);
		expect(pi.notifications.at(-1)).toContain("enabled=true");
		expect(pi.notifications.at(-1)).toContain("tools=full"); // no first turn yet → full
		expect(pi.setCalls).toEqual([]); // active tools never changed
		expect(pi.notifications.at(-1)).not.toContain("firstTurnApplied");
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

	it("/router status output and selector Status output are the same user-facing status", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router")!;

		await pi.emit("input", inputEvent("please inspect this"), ctx);
		await router("status", ctx);
		const viaArgs = pi.notifications.at(-1);

		pi.selectQueue.push("Status — Show current router status");
		await router("", ctx);
		expect(pi.notifications.at(-1)).toBe(viaArgs);
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

	it("legacy commands no longer exist", async () => {
		const { pi } = setup();
		expect(pi.commands.has("deepseek-router-status")).toBe(false);
		expect(pi.commands.has("deepseek-router-mode")).toBe(false);
		// The only public command is /router.
		expect([...pi.commands.keys()]).toEqual(["router"]);
	});

	it("weak/mixed/numeric cannot be set through any public command", async () => {
		const { pi, ctx } = setup();
		const router = pi.commands.get("router")!;

		for (const token of ["weak", "mixed", "30", "0.3", "100"]) {
			await router(token, ctx);
			expect(pi.notifications.at(-1)).toContain("invalid mode");
		}
		expect(pi.setCalls).toEqual([]);
	});
});
