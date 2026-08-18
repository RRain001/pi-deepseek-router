import { describe, expect, it } from "vitest";

import { FakePi, agentStartEvent, makeContext } from "./test-harness.js";

describe("model switching and prompt behavior", () => {
	it("enables on DeepSeek, promotes after the first tool, and restores on exit", async () => {
		const pi = new FakePi();
		pi.install();
		const manager = { getBranch: () => [] };
		const nonDeepSeek = { id: "gpt-test-model", provider: "custom" };
		const deepSeek = { id: "deepseek-v4-pro", provider: "custom" };
		const nonCtx = makeContext(nonDeepSeek, manager);
		const deepCtx = makeContext(deepSeek, manager);

		await pi.emit("model_select", { type: "model_select", model: deepSeek, previousModel: nonDeepSeek, source: "set" }, deepCtx);
		await pi.emit("before_agent_start", agentStartEvent("build a new command-line tool"), deepCtx);
		expect(pi.getActiveTools()).toEqual(["read", "edit", "write"]);

		await pi.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName: "write", input: {} }, deepCtx);
		expect(pi.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
		const callsAfterPromotion = pi.setCalls.length;
		await pi.emit("tool_call", { type: "tool_call", toolCallId: "2", toolName: "bash", input: {} }, deepCtx);
		expect(pi.setCalls).toHaveLength(callsAfterPromotion);

		await pi.emit("model_select", { type: "model_select", model: nonDeepSeek, previousModel: deepSeek, source: "set" }, nonCtx);
		expect(pi.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);

		await pi.emit("model_select", { type: "model_select", model: deepSeek, previousModel: nonDeepSeek, source: "set" }, deepCtx);
		await pi.emit("before_agent_start", agentStartEvent("fix the parser crash"), deepCtx);
		expect(pi.getActiveTools()).toEqual(["read", "edit", "grep", "find", "ls"]);
	});

	it("adds one marked persona section and does not duplicate it", async () => {
		const pi = new FakePi();
		pi.install();
		const model = { id: "DeepSeek-v4-pro", provider: "custom" };
		const ctx = makeContext(model);
		const first = await pi.emit("before_agent_start", agentStartEvent("build a new tool"), ctx);
		const second = await pi.emit(
			"before_agent_start",
			agentStartEvent("build a new tool", (first as { systemPrompt: string }).systemPrompt),
			ctx,
		);

		expect((first as { systemPrompt: string }).systemPrompt.match(/pi-deepseek-router:start/g)).toHaveLength(1);
		expect(second).toBeUndefined();
	});
});
