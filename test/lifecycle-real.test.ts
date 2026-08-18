import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Model,
	type StopReason,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";

import extension from "../src/index.js";

/**
 * Real-lifecycle tests: drive an actual Pi `AgentSession` (official SDK,
 * `createAgentSession` + inline extension factory) with a scripted model
 * runtime, and assert on the LLM request contexts the model would actually
 * receive. This is the authoritative evidence for first-turn routing timing,
 * promotion, model switches, and session isolation — FakePi unit tests alone
 * cannot prove `input` → `before_agent_start` → first LLM request ordering.
 */

const TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** react mode ("build …") resolves to read/edit/write. */
const REACT_CORE = ["read", "edit", "write"];
/** spec mode ("fix …") resolves to read/edit/grep/find/ls. */
const SPEC_CORE = ["read", "edit", "grep", "find", "ls"];

	interface LlmRequest {
	modelId: string;
	systemPrompt: string;
	tools: string[];
	/** True when the request context carried the router's ephemeral guidance message. */
	hasGuidance: boolean;
}

interface TurnScript {
	stopReason: StopReason;
	text?: string;
	toolCalls?: ToolCall[];
}

function usage() {
	return {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantMessage(turn: TurnScript, model: Model<Api>): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (turn.toolCalls !== undefined) content.push(...turn.toolCalls);
	if (turn.text !== undefined) content.push({ type: "text", text: turn.text });
	return {
		role: "assistant",
		content,
		api: "pi-messages",
		provider: model.provider,
		model: model.id,
		usage: usage(),
		stopReason: turn.stopReason,
		timestamp: Date.now(),
	};
}

function makeModel(id: string, provider = "deepseek"): Model<Api> {
	return {
		id,
		name: id,
		api: "pi-messages",
		provider,
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 64000,
		maxTokens: 8192,
	};
}

function customTool(name: string): ToolDefinition {
	return {
		name,
		label: name,
		description: `Canned ${name} tool for lifecycle tests`,
		promptSnippet: `Canned ${name} tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: `ok: ${name}` }], details: {} }),
	};
}

const CUSTOM_TOOLS = TOOL_NAMES.map(customTool);

interface Harness {
	session: AgentSession;
	requests: LlmRequest[];
	dir: string;
}

async function createHarness(model: Model<Api>, script: TurnScript[], sessionManager?: SessionManager): Promise<Harness> {
	const dir = mkdtempSync(join(tmpdir(), "pidsr-lc-"));
	const requests: LlmRequest[] = [];
	const runtime = await ModelRuntime.create({
		modelsPath: null,
		authPath: join(dir, "auth.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	runtime.hasConfiguredAuth = () => true;
	runtime.checkAuth = async () => ({ type: "api_key" });
	runtime.streamSimple = (streamModel, context) => {
		const turn = script.shift() ?? { stopReason: "stop", text: "done" };
		requests.push({
			modelId: streamModel.id,
			systemPrompt: context.systemPrompt ?? "",
			tools: (context.tools ?? []).map((tool) => tool.name),
			hasGuidance: (context.messages ?? []).some((message) => {
				const content = (message as { content?: unknown }).content;
				if (typeof content === "string") return content.includes("Router: classify this task");
				if (!Array.isArray(content)) return false;
				return content.some((part) => {
					if (typeof part === "string") return part.includes("Router: classify this task");
					if (typeof part === "object" && part !== null && "text" in part) {
						const text = (part as { text?: unknown }).text;
						return typeof text === "string" && text.includes("Router: classify this task");
					}
					return false;
				});
			}),
		});
		const stream = createAssistantMessageEventStream();
		const message = assistantMessage(turn, streamModel);
		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
		stream.end();
		return stream;
	};
	const settingsManager = SettingsManager.inMemory();
	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager,
		extensionFactories: [{ name: "pi-deepseek-router", factory: extension }],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model,
		modelRuntime: runtime,
		sessionManager: sessionManager ?? SessionManager.inMemory(dir),
		settingsManager,
		resourceLoader: loader,
		tools: TOOL_NAMES,
		customTools: CUSTOM_TOOLS,
	});
	// Real modes (print/rpc/interactive) call bindExtensions() right after
	// creation; this fires the session_start event our extension subscribes to.
	await session.bindExtensions({ mode: "print" });
	return { session, requests, dir };
}

function availableToolsBlock(systemPrompt: string): string {
	const start = systemPrompt.indexOf("Available tools:");
	const end = systemPrompt.indexOf("In addition to the tools above");
	if (start === -1 || end === -1) return "";
	return systemPrompt.slice(start, end);
}

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("real AgentSession lifecycle (first-turn routing timing)", () => {
	it("A: DeepSeek first turn is routed before the first LLM request", async () => {
		const harness = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "here is the tool" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.prompt("build a new command-line tool");

		expect(harness.requests).toHaveLength(1);
		const request = harness.requests[0]!;
		// The first LLM request actually received the core subset.
		expect(request.tools).toEqual(REACT_CORE);
		// The system prompt the model received lists only core tools, plus the
		// router persona appended by before_agent_start (proves the input hook
		// ran before before_agent_start, which ran before the first request).
		const toolsBlock = availableToolsBlock(request.systemPrompt);
		expect(toolsBlock).toContain("- read:");
		expect(toolsBlock).toContain("- edit:");
		expect(toolsBlock).toContain("- write:");
		expect(toolsBlock).not.toContain("- bash:");
		expect(toolsBlock).not.toContain("- grep:");
		expect(request.systemPrompt).toContain("pi-deepseek-router:start");
		expect(request.systemPrompt).toContain("hands-on");
		// The session-level active tool set matches what the model saw.
		expect(harness.session.getActiveToolNames()).toEqual(REACT_CORE);
	});

	it("B: first tool call restores original tools for subsequent turns", async () => {
		const harness = await createHarness(makeModel("deepseek-chat"), [
			// The scripted model may only call tools that are actually active.
			{ stopReason: "toolUse", toolCalls: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }] },
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.prompt("build a new command-line tool");

		expect(harness.requests).toHaveLength(2);
		expect(harness.requests[0]!.tools).toEqual(REACT_CORE);
		// The turn after the first actual tool call keeps the full tool set.
		expect(harness.requests[1]!.tools).toEqual(TOOL_NAMES);
		expect(harness.session.getActiveToolNames()).toEqual(TOOL_NAMES);
		// Router persona persists for the remainder of the prompt's run.
		expect(harness.requests[1]!.systemPrompt).toContain("pi-deepseek-router:start");
	});

	it("C: first-turn reduction does not drift into the second user task", async () => {
		const harness = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "no tools needed" },
			{ stopReason: "stop", text: "second task done" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.prompt("build a new command-line tool");
		expect(harness.requests[0]!.tools).toEqual(REACT_CORE);
		// No tool call happened in the first turn: the reduction is still active.
		expect(harness.session.getActiveToolNames()).toEqual(REACT_CORE);

		await harness.session.prompt("fix the parser crash");
		expect(harness.requests).toHaveLength(2);
		// The second user task must not receive the first-turn core subset again.
		expect(harness.requests[1]!.tools).toEqual(TOOL_NAMES);
		expect(harness.session.getActiveToolNames()).toEqual(TOOL_NAMES);
	});

	it("D: non-DeepSeek input/before_agent_start/context/tool events are strict no-ops", async () => {
		const harness = await createHarness(makeModel("gpt-test-model", "custom"), [
			{ stopReason: "toolUse", toolCalls: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }] },
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.prompt("build a new command-line tool");

		// Tool calls executed; the extension never touched tools or the prompt.
		expect(harness.requests).toHaveLength(2);
		expect(harness.requests[0]!.tools).toEqual(TOOL_NAMES);
		expect(harness.requests[0]!.systemPrompt).not.toContain("pi-deepseek-router:start");
		expect(harness.requests[0]!.hasGuidance).toBe(false);
		expect(harness.requests[1]!.tools).toEqual(TOOL_NAMES);
		expect(harness.requests[1]!.systemPrompt).not.toContain("pi-deepseek-router:start");
		expect(harness.requests[1]!.hasGuidance).toBe(false);
		expect(harness.session.getActiveToolNames()).toEqual(TOOL_NAMES);
	});

	it("E1: gpt → deepseek routes the next real user input before its turn", async () => {
		const harness = await createHarness(makeModel("gpt-test-model", "custom"), [
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.setModel(makeModel("deepseek-chat"));
		// Tools are untouched by the switch itself.
		expect(harness.session.getActiveToolNames()).toEqual(TOOL_NAMES);

		await harness.session.prompt("build a new command-line tool");
		expect(harness.requests).toHaveLength(1);
		expect(harness.requests[0]!.modelId).toBe("deepseek-chat");
		expect(harness.requests[0]!.tools).toEqual(REACT_CORE);
		expect(harness.requests[0]!.systemPrompt).toContain("pi-deepseek-router:start");
	});

	it("E2: deepseek → gpt restores original tools and disables routing", async () => {
		const harness = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "done" },
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.prompt("build a new command-line tool");
		expect(harness.requests[0]!.tools).toEqual(REACT_CORE);

		await harness.session.setModel(makeModel("gpt-test-model", "custom"));
		expect(harness.session.getActiveToolNames()).toEqual(TOOL_NAMES);

		await harness.session.prompt("fix the parser crash");
		expect(harness.requests).toHaveLength(2);
		expect(harness.requests[1]!.tools).toEqual(TOOL_NAMES);
		expect(harness.requests[1]!.systemPrompt).not.toContain("pi-deepseek-router:start");
	});

	it("E3: deepseek-flash → deepseek-pro keeps the explicit override", async () => {
		const harness = await createHarness(makeModel("deepseek-v4-flash"), [
			{ stopReason: "stop", text: "done" },
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		// Explicit override: react (a "please explain…" task would classify weak).
		await harness.session.prompt("/deepseek-router-mode react");
		expect(harness.requests).toHaveLength(0);
		expect(harness.session.getActiveToolNames()).toEqual(REACT_CORE);

		await harness.session.prompt("please explain the architecture");
		expect(harness.requests[0]!.tools).toEqual(REACT_CORE);
		expect(harness.requests[0]!.systemPrompt).toContain("hands-on");

		await harness.session.setModel(makeModel("deepseek-v4-pro"));
		await harness.session.prompt("please explain the architecture");
		expect(harness.requests[1]!.tools).toEqual(TOOL_NAMES);
		// The override survived the DeepSeek → DeepSeek switch (react persona).
		expect(harness.requests[1]!.systemPrompt).toContain("hands-on");
	});

	it("F: sessions do not share first-turn routing state", async () => {
		const first = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "toolUse", toolCalls: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }] },
			{ stopReason: "stop", text: "done" },
		]);
		const second = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(first.dir, second.dir);

		await first.session.prompt("build a new command-line tool");
		expect(first.requests[0]!.tools).toEqual(REACT_CORE);
		expect(first.session.getActiveToolNames()).toEqual(TOOL_NAMES); // promoted in session 1

		// Session 2 gets its own first-turn routing even though session 1 promoted.
		await second.session.prompt("fix the parser crash");
		expect(second.requests[0]!.tools).toEqual(SPEC_CORE);
		expect(second.session.getActiveToolNames()).toEqual(SPEC_CORE);
	});

	it("resumed sessions derive mode from history and do not reduce tools", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pidsr-lc-"));
		tempDirs.push(dir);
		const manager = SessionManager.inMemory(dir);
		manager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "build a new command-line tool" }],
			timestamp: Date.now(),
		});
		const harness = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "done" },
		], manager);
		tempDirs.push(harness.dir);

		await harness.session.prompt("fix the parser crash");
		expect(harness.requests).toHaveLength(1);
		// Mode came from history (react persona), but the first turn is past:
		// the resumed session must not reduce tools.
		expect(harness.requests[0]!.tools).toEqual(TOOL_NAMES);
		expect(harness.requests[0]!.systemPrompt).toContain("hands-on");
	});

	it("extension-generated input never classifies a task nor routes tools", async () => {
		const harness = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "done" },
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		// sendUserMessage is the official extension-generated path (source "extension").
		await harness.session.sendUserMessage("build a website");
		expect(harness.requests[0]!.tools).toEqual(TOOL_NAMES);
		expect(harness.requests[0]!.systemPrompt).not.toContain("pi-deepseek-router:start");

		// The first real user task still classifies and routes normally.
		await harness.session.prompt("build a new command-line tool");
		expect(harness.requests[1]!.tools).toEqual(REACT_CORE);
		expect(harness.requests[1]!.systemPrompt).toContain("pi-deepseek-router:start");
	});

	it("weak-mode tasks get ephemeral guidance in the real request context", async () => {
		const harness = await createHarness(makeModel("deepseek-v4-flash"), [
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		// "please inspect this" classifies weak (no build/fix keywords).
		await harness.session.prompt("please inspect this");
		expect(harness.requests[0]!.tools).toEqual(SPEC_CORE); // weak core = read/edit/search
		expect(harness.requests[0]!.hasGuidance).toBe(true);
		// Weak persona in the system prompt; ephemeral guidance in the request messages.
		expect(harness.requests[0]!.systemPrompt).toContain("decide the task type");
	});

	it("rpc-sourced input routes like interactive input", async () => {
		const harness = await createHarness(makeModel("deepseek-chat"), [
			{ stopReason: "stop", text: "done" },
		]);
		tempDirs.push(harness.dir);

		await harness.session.prompt("build a new command-line tool", { source: "rpc" });
		expect(harness.requests[0]!.tools).toEqual(REACT_CORE);
		expect(harness.requests[0]!.systemPrompt).toContain("pi-deepseek-router:start");
	});
});
