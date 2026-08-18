export const MODE_SPEC = 0 as const;
export const MODE_MIXED = 0.3 as const;
export const MODE_REACT = 1 as const;
export const MODE_WEAK = "weak" as const;

export type RouterMode = number | typeof MODE_WEAK;
export type RouterBand = "spec" | "mixed" | "react" | "weak";
export type ParsedMode = RouterMode | "auto";

const COMPLEX_RE =
	/(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i;
const REACT_RE =
	/(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi;
const SPEC_RE =
	/(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi;

const SPEC_PERSONA = "You are a helpful software engineer assistant.";
const MIXED_PERSONA = `${SPEC_PERSONA}\nWork directly: prefer writing or editing code over describing plans. Verify changes by reading and running them.`;
const REACT_PERSONA =
	"You are a hands-on software engineer who delivers working output fast.\n" +
	"Work directly: write or edit code, then verify it by reading and running. " +
	"Keep the loop tight — produce, verify, fix — and finish with a usable deliverable and a short summary.";
const WEAK_DEFAULT =
	`${SPEC_PERSONA}\n` +
	"Before acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.";
const WEAK_FLASH =
	"You are a helpful assistant.\n" +
	"Before acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.\n" +
	"Review what you have already done in this session and continue from there; do not repeat completed steps. Avoid unnecessary environment checks and exhaustive scans.";

/** Return true for long or architecturally-worded tasks. */
export function isComplexTask(text: string): boolean {
	return typeof text === "string" && (text.length > 120 || COMPLEX_RE.test(text));
}

export function isFlashModel(modelId: unknown): boolean {
	return typeof modelId === "string" && /flash/i.test(modelId);
}

export function clamp01(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.min(1, Math.max(0, numeric));
}

export function bandOf(mode: RouterMode): RouterBand {
	if (mode === MODE_WEAK) return "weak";
	const numeric = clamp01(mode);
	if (numeric < 0.2) return "spec";
	if (numeric < 0.5) return "mixed";
	return "react";
}

export function bandFor(mode: RouterMode): RouterBand {
	return bandOf(mode);
}

/** Persona strings are deliberately selected only after the DeepSeek gate. */
export function personaFor(mode: RouterMode, modelId: unknown): string {
	switch (bandOf(mode)) {
		case "spec":
			return SPEC_PERSONA;
		case "mixed":
			return MIXED_PERSONA;
		case "weak":
			return isFlashModel(modelId) ? WEAK_FLASH : WEAK_DEFAULT;
		case "react":
			return REACT_PERSONA;
	}
}

/**
 * Canonical first-turn tool categories. The Pi adapter resolves `search` and
 * `shell` through the real catalog, so this core remains platform-neutral.
 */
export function coreFor(mode: RouterMode): string[] {
	switch (bandOf(mode)) {
		case "spec":
			return ["read", "edit", "search"];
		case "mixed":
			return ["read", "edit", "write", "search"];
		case "react":
			return ["read", "edit", "write"];
		case "weak":
			return ["read", "edit", "search"];
	}
}

export function classifyTask(text: string): RouterMode {
	const value = typeof text === "string" ? text : "";
	const react = value.match(REACT_RE)?.length ?? 0;
	const spec = value.match(SPEC_RE)?.length ?? 0;
	if (react > spec) return MODE_REACT;
	if (spec > react) return MODE_SPEC;
	return MODE_WEAK;
}

export function parseMode(token: unknown): ParsedMode | null {
	if (token === undefined || token === null) return null;
	const value = String(token).trim().toLowerCase();
	if (value === "auto") return "auto";
	if (value === "weak" || value === "router") return MODE_WEAK;
	if (value === "spec" || value === "spec-lean") return MODE_SPEC;
	if (value === "balanced" || value === "mixed") return MODE_MIXED;
	if (value === "react" || value === "react-lean") return MODE_REACT;

	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return null;
	return value.includes(".") ? clamp01(numeric) : clamp01(numeric / 100);
}

export function formatMode(mode: RouterMode | undefined): string {
	return mode === undefined ? "pending" : typeof mode === "string" ? mode : mode.toFixed(2);
}
