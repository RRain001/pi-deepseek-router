import { describe, expect, it } from "vitest";

import { FakePi, agentStartEvent, inputEvent, makeContext, userMessage } from "./test-harness.js";

describe("non-DeepSeek strict no-op", () => {
	it("keeps prompt, messages, tools, and router state untouched", async () => {
		const pi = new FakePi();
		pi.install();
		const ctx = makeContext({ id: "gpt-test-model", provider: "custom" });
		const prompt = agentStartEvent("build a tool");
		const messages = [userMessage("build a tool")];
		const originalMessages = structuredClone(messages);

		const input = await pi.emit("input", inputEvent("build a tool"), ctx);
		const before = await pi.emit("before_agent_start", prompt, ctx);
		const context = await pi.emit("context", { type: "context", messages }, ctx);
		await pi.emit("tool_call", { type: "tool_call", toolCallId: "1", toolName: "read", input: {} }, ctx);
		await pi.emit("tool_result", { type: "tool_result", toolCallId: "1", toolName: "read", input: {}, content: [], isError: false }, ctx);

		expect(input).toBeUndefined();
		expect(before).toBeUndefined();
		expect(context).toBeUndefined();
		expect(prompt.systemPrompt).toBe("PI BASE PROMPT");
		expect(messages).toEqual(originalMessages);
		expect(pi.getActiveTools()).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
		expect(pi.setCalls).toEqual([]);

		// The only public command is /router; it must not enable or mutate anything.
		expect([...pi.commands.keys()]).toEqual(["router"]);
		const router = pi.commands.get("router")!;
		const notifications: string[] = [];
		(ctx.ui as any).notify = (message: string) => notifications.push(message);
		await router("", ctx);
		await router("react", ctx);
		expect(notifications).toHaveLength(2);
		for (const message of notifications) {
			expect(message).toContain("DeepSeek Router");
			expect(message).toContain("Disabled");
		}
		expect(pi.setCalls).toEqual([]);
	});
});
