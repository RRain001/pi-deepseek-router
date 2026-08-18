import { bandFor, isComplexTask, type RouterMode } from "./router-core.js";

export const GUIDE_WEAK =
	"Router: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.";

export const GUIDE_DEEP =
	"Router: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.";

export function guidanceFor(mode: RouterMode, taskText: string): string | undefined {
	if (bandFor(mode) !== "weak") return undefined;
	return isComplexTask(taskText) ? GUIDE_DEEP : GUIDE_WEAK;
}
