import { describe, expect, it } from "vitest";

import {
	MODE_MIXED,
	MODE_REACT,
	MODE_SPEC,
	MODE_WEAK,
	bandFor,
	bandOf,
	classifyTask,
	clamp01,
	coreFor,
	isComplexTask,
	parseMode,
	personaFor,
} from "../src/router-core.js";

describe("router core", () => {
	it("quantizes the four supported bands", () => {
		expect(bandOf(MODE_SPEC)).toBe("spec");
		expect(bandOf(MODE_MIXED)).toBe("mixed");
		expect(bandOf(MODE_REACT)).toBe("react");
		expect(bandOf(MODE_WEAK)).toBe("weak");
		expect(bandFor(0.49)).toBe("mixed");
		expect(bandFor(0.5)).toBe("react");
	});

	it("classifies clear build/fix tasks and leaves ambiguous tasks weak", () => {
		expect(classifyTask("build a new command-line tool")).toBe(MODE_REACT);
		expect(classifyTask("fix the crash in the parser")).toBe(MODE_SPEC);
		expect(classifyTask("please inspect this")).toBe(MODE_WEAK);
	});

	it("uses conservative canonical first-turn tools", () => {
		expect(coreFor(MODE_SPEC)).toEqual(["read", "edit", "search"]);
		expect(coreFor(MODE_MIXED)).toEqual(["read", "edit", "write", "search"]);
		expect(coreFor(MODE_REACT)).toEqual(["read", "edit", "write"]);
		expect(coreFor(MODE_WEAK)).toEqual(["read", "edit", "search"]);
	});

	it("keeps flash/default weak personas distinct", () => {
		expect(personaFor(MODE_WEAK, "deepseek-v4-flash")).toContain("helpful assistant");
		expect(personaFor(MODE_WEAK, "deepseek-v4")).toContain("software engineer assistant");
	});

	it("parses explicit mode tokens", () => {
		expect(parseMode("auto")).toBe("auto");
		expect(parseMode("spec")).toBe(0);
		expect(parseMode("weak")).toBe("weak");
		expect(parseMode("mixed")).toBe(0.3);
		expect(parseMode("react")).toBe(1);
		expect(parseMode("50")).toBe(0.5);
		expect(parseMode("0.25")).toBe(0.25);
		expect(parseMode("not-a-mode")).toBeNull();
	});

	it("detects complex tasks", () => {
		expect(isComplexTask("refactor the authentication architecture")).toBe(true);
		expect(isComplexTask("read this file")).toBe(false);
		expect(isComplexTask("x".repeat(121))).toBe(true);
	});

	it("clamps numeric input", () => {
		expect(clamp01(-1)).toBe(0);
		expect(clamp01(2)).toBe(1);
		expect(clamp01("bad")).toBe(0);
	});
});
