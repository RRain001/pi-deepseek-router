import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isDeepSeekModel, isDeepSeekModelId, modelIdOf } from "./deepseek-gate.js";
import { guidanceFor } from "./guidance.js";
import { bandFor, classifyTask, coreFor, formatMode, isComplexTask, parseMode, personaFor, type RouterMode } from "./router-core.js";
import { RouterStateStore, type RouterSessionState } from "./router-state.js";

const ROUTER_PROMPT_START = "<!-- pi-deepseek-router:start -->";
const ROUTER_PROMPT_END = "<!-- pi-deepseek-router:end -->";
const GUIDANCE_CUSTOM_TYPE = "pi-deepseek-router-guidance";

const TOOL_ALIASES: Record<string, string[]> = {
	read: ["read"],
	edit: ["edit"],
	write: ["write"],
	search: ["grep", "find", "ls"],
	shell: ["bash"],
};

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (typeof part === "object" && part !== null && "text" in part) {
				const text = (part as { text?: unknown }).text;
				return typeof text === "string" ? text : "";
			}
			return "";
		})
		.join(" ");
}

function messageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	return contentText((message as { content?: unknown }).content);
}

function firstUserTask(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = (entry as { message?: unknown }).message;
		if (typeof message === "object" && message !== null && (message as { role?: unknown }).role === "user") {
			const text = messageText(message);
			if (text.trim()) return text;
		}
	}
	return undefined;
}

function latestUserTask(messages: readonly unknown[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (typeof message === "object" && message !== null && (message as { role?: unknown }).role === "user") {
			const text = messageText(message);
			if (text.trim()) return text;
		}
	}
	return undefined;
}

function toolNames(pi: ExtensionAPI): string[] {
	return pi.getAllTools().map((tool) => tool.name);
}

function resolveCoreTools(mode: RouterMode, available: readonly string[], original: readonly string[]): string[] {
	const availableSet = new Set(available);
	const originalSet = new Set(original);
	const resolved: string[] = [];
	for (const category of coreFor(mode)) {
		for (const candidate of TOOL_ALIASES[category] ?? [category]) {
			if (availableSet.has(candidate) && originalSet.has(candidate) && !resolved.includes(candidate)) {
				resolved.push(candidate);
			}
		}
	}
	return resolved;
}

function setInitialTools(pi: ExtensionAPI, state: RouterSessionState): void {
	if (state.toolsPromoted || state.originalTools === undefined || state.mode === undefined) return;
	const selected = resolveCoreTools(state.mode, toolNames(pi), state.originalTools);
	pi.setActiveTools(selected);
}

function restoreTools(pi: ExtensionAPI, state: RouterSessionState): void {
	if (state.originalTools !== undefined) pi.setActiveTools([...state.originalTools]);
}

export default function deepSeekRouter(pi: ExtensionAPI): void {
	const states = new RouterStateStore();

	function stateFor(ctx: ExtensionContext): RouterSessionState {
		return states.get(ctx.sessionManager);
	}

	function ensureEnabled(ctx: ExtensionContext, model: unknown, taskText?: string): RouterSessionState {
		const state = stateFor(ctx);
		const modelId = modelIdOf(model);
		if (modelId === undefined || !isDeepSeekModelId(modelId)) return state;

		const newlyActivated = !state.enabled || state.originalTools === undefined;
		const previousMode = state.mode;
		if (newlyActivated) {
			state.originalTools = pi.getActiveTools();
			state.toolsPromoted = false;
		}
		state.enabled = true;
		state.modelId = modelId;

		if (taskText !== undefined) {
			const firstTask = state.currentTask === undefined;
			if (firstTask) state.mode = state.override ?? classifyTask(taskText);
			state.currentTask = taskText;
			state.complexity = isComplexTask(taskText) ? "complex" : "simple";
		}
		if (state.mode === undefined && state.override !== undefined) state.mode = state.override;
		if (newlyActivated || state.mode !== previousMode) setInitialTools(pi, state);
		return state;
	}

	function syncModel(ctx: ExtensionContext, model: unknown): void {
		const state = stateFor(ctx);
		const modelId = modelIdOf(model);
		if (isDeepSeekModelId(modelId)) {
			ensureEnabled(ctx, model);
			return;
		}

		if (state.enabled) restoreTools(pi, state);
		states.disable(state, modelId);
	}

	function promoteTools(ctx: ExtensionContext): void {
		const state = stateFor(ctx);
		if (!state.enabled || state.toolsPromoted) return;
		restoreTools(pi, state);
		state.toolsPromoted = true;
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		const task = firstUserTask(ctx);
		ensureEnabled(ctx, ctx.model, task);
	});

	pi.on("model_select", async (event, ctx) => {
		syncModel(ctx, event.model);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		const state = stateFor(ctx);
		if (state.enabled) restoreTools(pi, state);
		states.disable(state, modelIdOf(ctx.model));
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		const state = ensureEnabled(ctx, ctx.model, event.prompt);
		if (state.mode === undefined) return;
		if (event.systemPrompt.includes(ROUTER_PROMPT_START)) return;

		const persona = personaFor(state.mode, state.modelId);
		const section = [
			ROUTER_PROMPT_START,
			"## DeepSeek Router",
			`mode=${formatMode(state.mode)} band=${bandFor(state.mode)}`,
			persona,
			ROUTER_PROMPT_END,
		].join("\n");
		return { systemPrompt: `${event.systemPrompt}\n\n${section}` };
	});

	pi.on("context", async (event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		const state = ensureEnabled(ctx, ctx.model);
		if (state.mode === undefined) return;
		const taskText = state.currentTask ?? latestUserTask(event.messages);
		if (!taskText) return;
		const guidance = guidanceFor(state.mode, taskText);
		if (!guidance) return;

		const messages = event.messages.filter((message) => {
			return (message as { customType?: unknown }).customType !== GUIDANCE_CUSTOM_TYPE;
		});
		messages.push({
			role: "custom",
			customType: GUIDANCE_CUSTOM_TYPE,
			content: guidance,
			display: false,
			timestamp: Date.now(),
		});
		return { messages };
	});

	pi.on("tool_call", async (_event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		ensureEnabled(ctx, ctx.model);
		promoteTools(ctx);
	});

	pi.on("tool_result", async (_event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		ensureEnabled(ctx, ctx.model);
		promoteTools(ctx);
	});

	pi.registerCommand("deepseek-router-status", {
		description: "Show DeepSeek router status without affecting other models",
		handler: async (_args, ctx) => {
			const modelId = modelIdOf(ctx.model);
			if (!isDeepSeekModel(ctx)) {
				ctx.ui.notify(
					`enabled=false model=${modelId ?? "none"} reason=model-id-does-not-start-with-deepseek`,
					"info",
				);
				return;
			}
			const state = stateFor(ctx);
			const mode = formatMode(state.mode);
			ctx.ui.notify(
				[
					"enabled=true",
					`model=${modelId ?? "none"}`,
					`mode=${mode}`,
					`band=${state.mode === undefined ? "pending" : bandFor(state.mode)}`,
					`complexity=${state.complexity ?? "pending"}`,
					`toolsPromoted=${state.toolsPromoted}`,
					`override=${state.override === undefined ? "no" : "yes"}`,
				].join(" "),
				"info",
			);
		},
	});

	pi.registerCommand("deepseek-router-mode", {
		description: "Set DeepSeek router mode: auto, spec, weak, mixed, react, or numeric",
		handler: async (args, ctx) => {
			if (!isDeepSeekModel(ctx)) {
				ctx.ui.notify("enabled=false reason=model-id-does-not-start-with-deepseek", "info");
				return;
			}
			const parsed = parseMode(args);
			if (parsed === null) {
				ctx.ui.notify("invalid mode: use auto, spec, weak, mixed, react, 0-100, or 0.0-1.0", "warning");
				return;
			}

			const state = ensureEnabled(ctx, ctx.model);
			if (parsed === "auto") {
				delete state.override;
				if (state.currentTask === undefined) delete state.mode;
				else state.mode = classifyTask(state.currentTask);
			} else {
				state.override = parsed;
				state.mode = parsed;
			}
			setInitialTools(pi, state);
			ctx.ui.notify(`mode=${formatMode(state.mode)} — next request applies`, "info");
		},
	});
}
