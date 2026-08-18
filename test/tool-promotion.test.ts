import { describe, expect, it } from "vitest";

import { FakePi, agentStartEvent, inputEvent, makeContext } from "./test-harness.js";

describe("tool promotion and session-local state", () => {
	it("injects weak guidance ephemerally and promotes only once", async () => {
		const pi = new FakePi();
		pi.install();
		const manager = { getBranch: () => [] };
		const model = { id: "deepseek-v4-flash", provider: "custom" };
		const ctx = makeContext(model, manager);
		await pi.emit("input", inputEvent("please inspect this"), ctx);
		await pi.emit("before_agent_start", agentStartEvent("please inspect this"), ctx);

		const contextResult = await pi.emit(
			"context",
			{ type: "context", messages: [{ role: "user", content: "please inspect this", timestamp: Date.now() }] },
			ctx,
		);
		const resultMessages = (contextResult as { messages: Array<{ customType?: string; content?: string }> }).messages;
		expect(resultMessages.filter((message) => message.customType === "pi-deepseek-router-guidance")).toHaveLength(1);
		expect(resultMessages.at(-1)?.content).toContain("classify this task");

		await pi.emit("input", inputEvent("refactor the authentication architecture"), ctx);
		await pi.emit("before_agent_start", agentStartEvent("refactor the authentication architecture"), ctx);
		const complexContextResult = await pi.emit(
			"context",
			{ type: "context", messages: [{ role: "user", content: "refactor the authentication architecture", timestamp: Date.now() }] },
			ctx,
		);
		expect((complexContextResult as { messages: Array<{ content?: string }> }).messages.at(-1)?.content).toContain("architecture, edge cases, and integration points");

		await pi.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName: "read", input: {} }, ctx);
		const callsAfterFirstTool = pi.setCalls.length;
		await pi.emit("tool_result", { type: "tool_result", toolCallId: "1", toolName: "read", input: {}, content: [], isError: false }, ctx);
		expect(pi.setCalls).toHaveLength(callsAfterFirstTool);
	});

	it("does not share promotion state between sessions", async () => {
		const pi = new FakePi();
		pi.install();
		const model = { id: "deepseek-chat", provider: "custom" };
		const first = makeContext(model, { getBranch: () => [] });
		const second = makeContext(model, { getBranch: () => [] });

		await pi.emit("input", inputEvent("please inspect this"), first);
		await pi.emit("before_agent_start", agentStartEvent("please inspect this"), first);
		await pi.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName: "read", input: {} }, first);
		const afterFirst = pi.setCalls.length;

		// A second session gets its own first-turn routing: reduction, not promotion.
		await pi.emit("input", inputEvent("please inspect this"), second);
		await pi.emit("before_agent_start", agentStartEvent("please inspect this"), second);
		expect(pi.getActiveTools()).toEqual(["read", "edit", "grep", "find", "ls"]);
		await pi.emit("tool_call", { type: "tool_call", toolCallId: "2", toolName: "read", input: {} }, second);
		expect(pi.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
		expect(pi.setCalls.length).toBeGreaterThan(afterFirst);
	});
});
