import type { ExtensionAPI, ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";

import { isDeepSeekModel, isDeepSeekModelId, modelIdOf } from "./deepseek-gate.js";
import { guidanceFor } from "./guidance.js";
import { MODE_REACT, MODE_SPEC, bandFor, classifyTask, coreFor, formatMode, isComplexTask, personaFor, type RouterMode } from "./router-core.js";
import { RouterStateStore, type RouterSessionState } from "./router-state.js";

const ROUTER_PROMPT_START = "<!-- pi-deepseek-router:start -->";
const ROUTER_PROMPT_END = "<!-- pi-deepseek-router:end -->";
const GUIDANCE_CUSTOM_TYPE = "pi-deepseek-router-guidance";

/**
 * Real user input sources in Pi 0.84.x (official `InputSource` type):
 * - "interactive": TUI / print-mode / one-shot prompts
 * - "rpc": SDK/RPC `prompt` commands
 * Anything else ("extension") is extension-generated input and must never
 * classify a session task or fix the automatic mode.
 */
const USER_INPUT_SOURCES = new Set(["interactive", "rpc"]);

/**
 * User-level router surface exposed by `/router`. `weak` stays auto's internal
 * fallback band for ambiguous tasks; `mixed` remains an upstream-marked
 * experimental band inside router-core. Neither is exposed through the TUI.
 */
type UserControl = "auto" | "spec" | "react";

const USER_MODE_OPTIONS = [
	"Auto — Automatic routing (recommended)",
	"Spec — Debug / review / maintenance",
	"React — Build / implement / modify",
	"Status — Show current router status",
] as const;

const ROUTER_COMPLETIONS = [
	{ value: "auto", label: "auto", description: "Automatic routing (recommended)" },
	{ value: "spec", label: "spec", description: "Debug / review / maintenance" },
	{ value: "react", label: "react", description: "Build / implement / modify" },
	{ value: "status", label: "status", description: "Show router status" },
] as const;

function capitalizeBand(band: string): string {
	return band.length === 0 ? band : band.charAt(0).toUpperCase() + band.slice(1);
}

/** Human title suffix showing the configured control and the actual band. */
function currentStateLabel(state: RouterSessionState): string {
	if (state.override !== undefined) return `Current: ${capitalizeBand(bandFor(state.override))}`;
	if (state.mode === undefined) return "Current: Auto";
	return `Current: Auto → ${capitalizeBand(bandFor(state.mode))}`;
}

function effectiveModeLabel(state: RouterSessionState): string {
	return state.mode === undefined ? "pending" : bandFor(state.mode);
}

/** Apply one of the three user-level controls (mirrors legacy mode semantics). */
function applyUserControl(pi: ExtensionAPI, state: RouterSessionState, control: UserControl): void {
	if (control === "auto") {
		delete state.override;
		if (state.currentTask === undefined) delete state.mode;
		else state.mode = classifyTask(state.currentTask);
	} else {
		state.override = control === "spec" ? MODE_SPEC : MODE_REACT;
		state.mode = state.override;
	}
	setInitialTools(pi, state);
}

function controlLabel(state: RouterSessionState): string {
	return state.override === undefined ? "auto" : bandFor(state.override);
}

function toolsLabel(state: RouterSessionState): "core" | "full" {
	if (state.toolsPromoted) return "full";
	if (state.firstTurnApplied) return "core";
	return "full";
}

/**
 * User-facing simplified status. Read-only: never touches override, mode,
 * active tools, currentTask, firstTurnApplied, or toolsPromoted.
 */
function showStatus(ctx: ExtensionContext, state: RouterSessionState): void {
	ctx.ui.notify(
		[
			`enabled=${state.enabled}`,
			`model=${modelIdOf(ctx.model) ?? "none"}`,
			`control=${controlLabel(state)}`,
			`activeBand=${state.mode === undefined ? "pending" : bandFor(state.mode)}`,
			`complexity=${state.complexity ?? "pending"}`,
			`tools=${toolsLabel(state)}`,
		].join(" "),
		"info",
	);
}

/** Non-DeepSeek `/router` display: informational only, never opens a selector. */
function notifyRouterDisabled(ctx: ExtensionContext): void {
	ctx.ui.notify(
		["DeepSeek Router", "Disabled", 'Current model ID does not start with "deepseek".'].join("\n"),
		"info",
	);
}

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

function sameNames(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

function setInitialTools(pi: ExtensionAPI, state: RouterSessionState): void {
	if (state.toolsPromoted || state.originalTools === undefined || state.mode === undefined) return;
	const selected = resolveCoreTools(state.mode, toolNames(pi), state.originalTools);
	if (sameNames(pi.getActiveTools(), selected)) return;
	pi.setActiveTools(selected);
}

function restoreTools(pi: ExtensionAPI, state: RouterSessionState): void {
	if (state.originalTools === undefined) return;
	if (sameNames(pi.getActiveTools(), state.originalTools)) return;
	pi.setActiveTools([...state.originalTools]);
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
		if (newlyActivated) {
			state.originalTools = pi.getActiveTools();
			state.toolsPromoted = false;
			state.firstTurnApplied = false;
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

	/**
	 * First-turn tool routing happens here, before the agent turn starts.
	 *
	 * Official Pi ordering (verified against 0.84.2 `AgentSession.prompt()`):
	 * extension commands → `input` → skill/template expansion → `before_agent_start`
	 * → agent loop → first LLM request. `setActiveToolsByName()` takes effect on
	 * the next agent turn, so reducing tools from the `input` handler guarantees
	 * the first LLM request of the first real user task sees the core subset.
	 *
	 * Source handling:
	 * - "interactive"/"rpc" are real user input: only the session's first real
	 *   user task fixes the automatic mode and gets the core subset.
	 * - "extension" (sendUserMessage) never classifies a task and never reduces
	 *   tools; it only triggers the first-turn restore if a previous first turn
	 *   left the reduced set behind without a tool call.
	 */
	pi.on("input", async (event: InputEvent, ctx: ExtensionContext) => {
		if (!isDeepSeekModel(ctx)) return;
		const state = ensureEnabled(ctx, ctx.model);
		const userSource = USER_INPUT_SOURCES.has(event.source);
		state.lastInputSource = userSource ? "user" : "other";

		if (userSource) {
			const firstTask = state.currentTask === undefined;
			if (firstTask) {
				state.mode = state.override ?? classifyTask(event.text);
				state.toolsPromoted = false;
				state.firstTurnApplied = false;
			}
			state.currentTask = event.text;
			state.complexity = isComplexTask(event.text) ? "complex" : "simple";

			if (firstTask) {
				setInitialTools(pi, state);
				state.firstTurnApplied = true;
			} else if (state.firstTurnApplied && !state.toolsPromoted) {
				// The first turn already ran without a tool call: never let the
				// first-turn reduction drift into a second user task.
				restoreTools(pi, state);
				state.toolsPromoted = true;
			}
		} else if (state.firstTurnApplied && !state.toolsPromoted) {
			restoreTools(pi, state);
			state.toolsPromoted = true;
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!isDeepSeekModel(ctx)) return;
		const task = firstUserTask(ctx);
		if (task !== undefined) {
			// Resumed session: restore mode/persona semantics from history. This
			// intentionally does NOT reduce tools — the first turn is in the past.
			ensureEnabled(ctx, ctx.model, task);
		} else {
			ensureEnabled(ctx, ctx.model);
		}
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
		const state = ensureEnabled(ctx, ctx.model);
		// Defensive fallback only: the `input` hook already ran for this prompt
		// (same prompt() call, strictly earlier). Classify only when the input
		// hook saw real user input but could not classify it. Extension input
		// (lastInputSource === "other") is never classified here, so extension
		// messages cannot fix the session mode.
		if (state.mode === undefined && state.currentTask === undefined && state.lastInputSource === "user") {
			state.mode = state.override ?? classifyTask(event.prompt);
			state.currentTask = event.prompt;
			state.complexity = isComplexTask(event.prompt) ? "complex" : "simple";
			setInitialTools(pi, state);
			state.firstTurnApplied = true;
		}
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

	pi.registerCommand("router", {
		description: "DeepSeek Router: auto, spec, react, or status",
		getArgumentCompletions: (prefix: string) => {
			const filtered = ROUTER_COMPLETIONS.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? [...filtered] : null;
		},
		handler: async (args, ctx) => {
			if (!isDeepSeekModel(ctx)) {
				notifyRouterDisabled(ctx);
				return;
			}
			const token = args.trim().toLowerCase();
			if (token === "status") {
				showStatus(ctx, stateFor(ctx));
				return;
			}

			const state = ensureEnabled(ctx, ctx.model);
			if (token === "") {
				// Mode selector: the user-facing surface is exactly Auto / Spec /
				// React / Status, mirroring the argument completions.
				const choice = await ctx.ui.select(
					`DeepSeek Router · ${modelIdOf(ctx.model) ?? "unknown"}\n${currentStateLabel(state)}`,
					[...USER_MODE_OPTIONS],
				);
				let control: UserControl | undefined;
				if (choice?.startsWith("Auto")) control = "auto";
				else if (choice?.startsWith("Spec")) control = "spec";
				else if (choice?.startsWith("React")) control = "react";
				if (control === undefined) {
					if (choice?.startsWith("Status")) showStatus(ctx, state); // view-only
					return; // cancelled or status
				}
				applyUserControl(pi, state, control);
			} else if (token === "auto" || token === "spec" || token === "react") {
				applyUserControl(pi, state, token);
			} else {
				ctx.ui.notify("invalid mode: use auto, spec, react, or status", "warning");
				return;
			}
			ctx.ui.notify(`mode=${effectiveModeLabel(state)} — next request applies`, "info");
		},
	});
}
