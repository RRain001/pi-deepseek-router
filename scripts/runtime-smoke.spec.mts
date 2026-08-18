import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import extension from "../src/index.js";

/**
 * REAL DeepSeek runtime smoke — drives real provider calls through the
 * official Pi SDK while recording the exact LLM request contexts
 * (systemPrompt / tools / guidance messages) the model receives.
 *
 * Run: npm run smoke:real  (requires real credentials)
 * This file is excluded from the default `npm test` run.
 *
 * Configuration (cross-platform defaults, overridable via env):
 *   PI_AGENT_DIR   → Pi agent dir                 (default: ~/.pi/agent)
 *   PI_AUTH_PATH   → credentials file             (default: <agentDir>/auth.json)
 *   PI_MODELS_PATH → models catalog file          (default: <agentDir>/models.json)
 */

const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");

const AUTH_PATH = process.env.PI_AUTH_PATH ?? join(AGENT_DIR, "auth.json");
const MODELS_PATH = process.env.PI_MODELS_PATH ?? join(AGENT_DIR, "models.json");

const TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
/** react mode ("build …") resolves to read/edit/write. */
const REACT_CORE = ["read", "edit", "write"];
/** weak/spec mode resolves to read/edit/grep/find/ls. */
const WEAK_CORE = ["read", "edit", "grep", "find", "ls"];

/** DeepSeek models with configured credentials in this environment. */
const DEEPSEEK_MODELS = [
	{ provider: "deepseek", id: "deepseek-v4-flash" },
	{ provider: "opencode-go", id: "deepseek-v4-flash" },
] as const;

/** Non-DeepSeek model with credentials, used for the switch no-op check. */
const NON_DEEPSEEK = { provider: "opencode-go", id: "qwen3.7-plus" } as const;

interface RecordedRequest {
	modelId: string;
	systemPrompt: string;
	tools: string[];
	hasGuidance: boolean;
	postToolCall: boolean;
}

interface SessionHarness {
	session: AgentSession;
	dir: string;
}

function customTool(name: string): ToolDefinition {
	return {
		name,
		label: name,
		description: `Canned ${name} tool for runtime smoke`,
		promptSnippet: `Canned ${name} tool`,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: `ok: ${name}` }], details: {} }),
	};
}

function guidanceInMessages(messages: readonly unknown[]): boolean {
	return messages.some((message) => {
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
	});
}

function availableToolsBlock(systemPrompt: string): string {
	const start = systemPrompt.indexOf("Available tools:");
	const end = systemPrompt.indexOf("In addition to the tools above");
	if (start === -1 || end === -1) return "";
	return systemPrompt.slice(start, end);
}

async function createRealSession(
	runtime: ModelRuntime,
	provider: string,
	id: string,
	thinkingLevel: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "off" = "low",
): Promise<SessionHarness> {
	const dir = mkdtempSync(join(tmpdir(), "pidsr-real-"));
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
	const model = runtime.getModel(provider, id);
	if (!model) throw new Error(`model not found: ${provider}/${id}`);
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model,
		modelRuntime: runtime,
		thinkingLevel,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager,
		resourceLoader: loader,
		tools: TOOL_NAMES,
		customTools: TOOL_NAMES.map(customTool),
	});
	await session.bindExtensions({ mode: "print" });
	return { session, dir };
}

describe("REAL DeepSeek runtime smoke", () => {
	let runtime: ModelRuntime;
	let requests: RecordedRequest[];
	let toolCallsSeen: number;

	beforeAll(async () => {
		runtime = await ModelRuntime.create({
			authPath: AUTH_PATH,
			modelsPath: MODELS_PATH,
			refreshOnCreate: true,
			allowModelNetwork: false,
		});
		for (const { provider, id } of DEEPSEEK_MODELS) {
			const model = runtime.getModel(provider, id);
			expect(model, `model ${provider}/${id} should exist`).toBeDefined();
			expect(runtime.hasConfiguredAuth(provider), `provider ${provider} should have auth`).toBe(true);
		}
		requests = [];
		toolCallsSeen = 0;
		// Instrument the real runtime: record every LLM request context before
		// forwarding the call to the real provider.
		const orig = runtime.streamSimple.bind(runtime);
		runtime.streamSimple = (model, context, options) => {
			requests.push({
				modelId: model.id,
				systemPrompt: context.systemPrompt ?? "",
				tools: (context.tools ?? []).map((tool) => tool.name),
				hasGuidance: guidanceInMessages(context.messages ?? []),
				postToolCall: toolCallsSeen > 0,
			});
			return orig(model, context, options);
		};
	});

	async function runFirstTurnSmoke(provider: string, id: string): Promise<void> {
		const harness = await createRealSession(runtime, provider, id, "low");
		harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start") toolCallsSeen += 1;
		});
		try {
			// 1) First-turn reduction + router system prompt reach the real model.
			const before = requests.length;
			await harness.session.prompt(
				"build a new command-line tool. You MUST call the read tool first (tool name: read), then continue based on its result.",
			);
			expect(requests.length).toBeGreaterThan(before);
			const first = requests[before]!;
			expect(first.tools).toEqual(REACT_CORE);
			expect(first.systemPrompt).toContain("pi-deepseek-router:start");
			const block = availableToolsBlock(first.systemPrompt);
			expect(block).toContain("- read:");
			expect(block).toContain("- edit:");
			expect(block).toContain("- write:");
			expect(block).not.toContain("- bash:");
			expect(block).not.toContain("- grep:");

			// 2) Tool-call promotion: the request after the first real tool call
			//    received the full original tool set. Models that refuse to call
			//    tools are recorded as SKIPPED (evidence comes from models that
			//    do call tools); at least one model must prove it.
			if (toolCallsSeen === 0) {
				console.warn(`[SKIPPED] ${provider}/${id}: model did not make a tool call despite the forced instruction`);
			} else {
				const afterToolCall = requests.find(
					(request) => request.postToolCall && requests.indexOf(request) > before,
				);
				expect(afterToolCall, "a request after the first tool call should exist").toBeDefined();
				expect(afterToolCall!.tools).toEqual(TOOL_NAMES);
			}
		} finally {
			rmSync(harness.dir, { recursive: true, force: true });
		}
	}

	async function runWeakSmoke(provider: string, id: string): Promise<void> {
		const harness = await createRealSession(runtime, provider, id, "low");
		try {
			// 3) Weak mode: ephemeral guidance reaches the real model.
			const before = requests.length;
			await harness.session.prompt("please inspect this");
			expect(requests.length).toBeGreaterThan(before);
			const first = requests[before]!;
			expect(first.tools).toEqual(WEAK_CORE);
			expect(first.systemPrompt).toContain("decide the task type");
			expect(first.hasGuidance).toBe(true);

			// 4) Switching to a non-DeepSeek model is a strict no-op.
			const nonDeepSeek = runtime.getModel(NON_DEEPSEEK.provider, NON_DEEPSEEK.id);
			expect(nonDeepSeek, `model ${NON_DEEPSEEK.provider}/${NON_DEEPSEEK.id} should exist`).toBeDefined();
			await harness.session.setModel(nonDeepSeek!);
			const switched = requests.length;
			await harness.session.prompt("build a new command-line tool");
			expect(requests.length).toBeGreaterThan(switched);
			const afterSwitch = requests[switched]!;
			expect(afterSwitch.tools).toEqual(TOOL_NAMES);
			expect(afterSwitch.systemPrompt).not.toContain("pi-deepseek-router:start");
			expect(afterSwitch.hasGuidance).toBe(false);
		} finally {
			rmSync(harness.dir, { recursive: true, force: true });
		}
	}

	for (const { provider, id } of DEEPSEEK_MODELS) {
		it(
			`${provider}/${id}: first-turn reduction, real tool-call promotion`,
			async () => {
				await runFirstTurnSmoke(provider, id);
			},
			240_000,
		);
		it(
			`${provider}/${id}: weak guidance + non-DeepSeek switch no-op`,
			async () => {
				await runWeakSmoke(provider, id);
			},
			240_000,
		);
	}
	// A real tool call must have been observed at least once across all models;
	// otherwise the promotion evidence is missing.
	afterAll(() => {
		expect(toolCallsSeen, "at least one real tool call across all models").toBeGreaterThan(0);
	});
});
