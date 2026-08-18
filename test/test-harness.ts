import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import extension from "../src/index.js";

export interface FakeModel {
	id: string;
	provider: string;
}

export interface FakeCommandOptions {
	handler: (args: string, ctx: any) => unknown;
	getArgumentCompletions?: (prefix: string) => unknown;
}

export interface FakeUi {
	notify: (message: string, type?: "info" | "warning" | "error") => void;
	select: (title: string, options: string[]) => Promise<string | undefined>;
}

export class FakePi {
	readonly handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	readonly commands = new Map<string, (args: string, ctx: any) => unknown>();
	readonly commandOptions = new Map<string, FakeCommandOptions>();
	readonly notifications: string[] = [];
	readonly setCalls: string[][] = [];
	/** Titles/options passed to ctx.ui.select by command handlers. */
	readonly selectCalls: Array<{ title: string; options: string[] }> = [];
	/** Queued choices returned by ctx.ui.select; shift() returns undefined when empty. */
	selectQueue: Array<string | undefined> = [];
	private active: string[];

	constructor(initialTools = ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
		this.active = [...initialTools];
	}

	on(event: string, handler: (event: any, ctx: any) => unknown): void {
		this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
	}

	registerCommand(name: string, options: FakeCommandOptions): void {
		this.commands.set(name, options.handler);
		this.commandOptions.set(name, options);
	}

	getAllTools(): Array<{ name: string }> {
		return ["read", "bash", "edit", "write", "grep", "find", "ls"].map((name) => ({ name }));
	}

	getActiveTools(): string[] {
		return [...this.active];
	}

	setActiveTools(names: string[]): void {
		this.active = [...names];
		this.setCalls.push([...names]);
	}

	install(): void {
		extension(this as unknown as ExtensionAPI);
	}

	/** Build a ctx.ui implementation wired to this fake's capture queues. */
	makeUi(): FakeUi {
		return {
			notify: (message) => {
				this.notifications.push(message);
			},
			select: async (title, options) => {
				this.selectCalls.push({ title, options });
				return this.selectQueue.shift();
			},
		};
	}

	async emit(event: string, payload: any, ctx: any): Promise<any> {
		let result: unknown;
		for (const handler of this.handlers.get(event) ?? []) result = await handler(payload, ctx);
		return result;
	}
}

export function makeContext(
	model: FakeModel | undefined,
	sessionManager: object = { getBranch: () => [] },
	ui: FakeUi = { notify() {}, select: async () => undefined },
): ExtensionContext {
	return {
		model,
		sessionManager,
		ui,
	} as unknown as ExtensionContext;
}

export function agentStartEvent(prompt: string, systemPrompt = "PI BASE PROMPT"): any {
	return {
		type: "before_agent_start",
		prompt,
		systemPrompt,
		systemPromptOptions: { cwd: "/tmp" },
	};
}

export function inputEvent(text: string, source: "interactive" | "rpc" | "extension" = "interactive"): any {
	return { type: "input", text, source };
}

export function userMessage(text: string): any {
	return { role: "user", content: text, timestamp: Date.now() };
}
