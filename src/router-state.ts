import type { RouterMode } from "./router-core.js";

export interface RouterSessionState {
	enabled: boolean;
	modelId?: string;
	mode?: RouterMode;
	override?: RouterMode;
	originalTools?: string[];
	toolsPromoted: boolean;
	currentTask?: string;
	complexity?: "simple" | "complex";
}

/**
 * State is keyed by Pi's session manager object. A WeakMap prevents one
 * session's first-tool/promotion state from leaking into another session.
 */
export class RouterStateStore {
	private readonly states = new WeakMap<object, RouterSessionState>();

	get(sessionManager: object): RouterSessionState {
		let state = this.states.get(sessionManager);
		if (!state) {
			state = { enabled: false, toolsPromoted: false };
			this.states.set(sessionManager, state);
		}
		return state;
	}

	disable(state: RouterSessionState, modelId: string | undefined): void {
		state.enabled = false;
		if (modelId === undefined) delete state.modelId;
		else state.modelId = modelId;
		delete state.originalTools;
		state.toolsPromoted = false;
		delete state.currentTask;
		delete state.complexity;
		if (state.override === undefined) delete state.mode;
	}
}
