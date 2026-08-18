import { describe, expect, it } from "vitest";

import { FakePi, agentStartEvent, makeContext, userMessage } from "./test-harness.js";

describe("non-DeepSeek strict no-op", () => {
	it("keeps prompt, messages, tools, and router state untouched", async () => {
		const pi = new FakePi();
		pi.install();
		const ctx = makeContext({ id: "gpt-test-model", provider: "custom" });
		const prompt = agentStartEvent("build a tool");
		const messages = [userMessage("build a tool")];
		const originalMessages = structuredClone(messages);

		const before = await pi.emit("before_agent_start", prompt, ctx);
		const context = await pi.emit("context", { type: "context", messages }, ctx);
		await pi.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName: "read", input: {} }, ctx);
		await pi.emit("tool_result", { type: "tool_result", toolCallId: "1", toolName: "read", input: {}, content: [], isError: false }, ctx);

		expect(before).toBeUndefined();
		expect(context).toBeUndefined();
		expect(prompt.systemPrompt).toBe("PI BASE PROMPT");
		expect(messages).toEqual(originalMessages);
		expect(pi.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
		expect(pi.setCalls).toEqual([]);

		const status = pi.commands.get("deepseek-router-status");
		expect(status).toBeDefined();
		const notifications: string[] = [];
		(ctx.ui as any).notify = (message: string) => notifications.push(message);
		await status?.("", ctx);
		expect(notifications[0]).toContain("enabled=false");
		expect(notifications[0]).toContain("reason=model-id-does-not-start-with-deepseek");

		const mode = pi.commands.get("deepseek-router-mode");
		await mode?.("react", ctx);
		expect(pi.setCalls).toEqual([]);
		expect(notifications.at(-1)).toContain("reason=model-id-does-not-start-with-deepseek");
	});
});
