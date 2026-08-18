import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The only model-selection predicate used by this extension.
 * Provider names and deny-lists are intentionally not considered.
 */
export function isDeepSeekModelId(modelId: unknown): boolean {
	return typeof modelId === "string" && modelId.toLowerCase().startsWith("deepseek");
}

export function modelIdOf(model: unknown): string | undefined {
	if (typeof model !== "object" || model === null || !("id" in model)) return undefined;
	const id = (model as { id?: unknown }).id;
	return typeof id === "string" ? id : undefined;
}

export function isDeepSeekModel(ctx: Pick<ExtensionContext, "model">): boolean {
	return isDeepSeekModelId(modelIdOf(ctx.model));
}
