import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import extension from "../src/index.js";

export interface FakeModel {
	id: string;
	provider: string;
}

export class FakePi {
	readonly handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	readonly commands = new Map<string, (args: string, ctx: any) => unknown>();
	readonly notifications: string[] = [];
	readonly setCalls: string[][] = [];
	private active: string[];

	constructor(initialTools = ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
		this.active = [...initialTools];
	}

	on(event: string, handler: (event: any, ctx: any) => unknown): void {
		this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
	}

	registerCommand(name: string, options: { handler: (args: string, ctx: any) => unknown }): void {
		this.commands.set(name, options.handler);
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

	async emit(event: string, payload: any, ctx: any): Promise<any> {
		let result: unknown;
		for (const handler of this.handlers.get(event) ?? []) result = await handler(payload, ctx);
		return result;
	}
}

export function makeContext(model: FakeModel | undefined, sessionManager: object = { getBranch: () => [] }): ExtensionContext {
	return {
		model,
		sessionManager,
		ui: {
			notify(message: string) {
				// The fake captures notifications through the caller's replacement below.
				void message;
			},
		},
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

export function userMessage(text: string): any {
	return { role: "user", content: text, timestamp: Date.now() };
}
