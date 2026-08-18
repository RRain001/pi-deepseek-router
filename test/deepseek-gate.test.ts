import { describe, expect, it } from "vitest";

import { isDeepSeekModel, isDeepSeekModelId } from "../src/deepseek-gate.js";

describe("strict DeepSeek prefix gate", () => {
	it.each([
		["deepseek-v4-pro", true],
		["deepseek-v4-flash", true],
		["DeepSeek-V4-Pro", true],
		["deepseek-chat", true],
		["gpt-5", false],
		["claude-sonnet", false],
		["gemini-3-pro", false],
		["qwen3-coder", false],
		["kimi-k2", false],
		[undefined, false],
		[null, false],
		["", false],
	])("isDeepSeekModelId(%j) -> %j", (modelId, expected) => {
		expect(isDeepSeekModelId(modelId)).toBe(expected);
	});

	it("reads only model.id from context", () => {
		expect(isDeepSeekModel({ model: { id: "deepseek-chat", provider: "custom" } } as any)).toBe(true);
		expect(isDeepSeekModel({ model: { id: "custom/deepseek-chat", provider: "deepseek" } } as any)).toBe(false);
		expect(isDeepSeekModel({ model: undefined } as any)).toBe(false);
	});
});
