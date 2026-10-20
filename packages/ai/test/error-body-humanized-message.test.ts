// Regression tests for the human-readable lead of provider error bodies.
//
// When the raw JSON error body carries a non-empty string `message`,
// `error.message` or `detail`, formatProviderError leads with that message and
// keeps the unchanged raw body after a "Raw response: " marker. The raw body
// must stay verbatim in the composed string so substring consumers
// (context-overflow detection, retry classification) keep matching it.

import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import { formatProviderError, normalizeProviderError } from "../src/utils/error-body.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";

function openaiShapedError(status: number, parsedBody: unknown): Error {
	return Object.assign(new Error(`${status} status code (no body)`), { status, error: parsedBody });
}

function assistantError(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "ollama",
		model: "qwen3.5:35b",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

describe("formatProviderError humanized message", () => {
	it("leads with the top-level `message` and keeps the raw body after Raw response", () => {
		const rawBody = '{"code":"400","message":"Invalid request parameters","param":"","type":"BadRequestError"}';
		const norm = normalizeProviderError(openaiShapedError(400, JSON.parse(rawBody)));

		expect(formatProviderError(norm)).toBe(`400: Invalid request parameters\nRaw response: ${rawBody}`);
		expect(formatProviderError(norm, "OpenAI API error")).toBe(
			`OpenAI API error (400): Invalid request parameters\nRaw response: ${rawBody}`,
		);
	});

	it("leads with the nested `error.message`", () => {
		const rawBody = '{"error":{"message":"Rate limit exceeded","type":"rate_limit"}}';
		const norm = normalizeProviderError(openaiShapedError(429, JSON.parse(rawBody)));

		expect(formatProviderError(norm)).toBe(`429: Rate limit exceeded\nRaw response: ${rawBody}`);
		expect(formatProviderError(norm, "OpenAI API error")).toBe(
			`OpenAI API error (429): Rate limit exceeded\nRaw response: ${rawBody}`,
		);
	});

	it("leads with `detail`", () => {
		const rawBody = '{"detail":"Item not found"}';
		const norm = normalizeProviderError(openaiShapedError(404, JSON.parse(rawBody)));

		expect(formatProviderError(norm)).toBe(`404: Item not found\nRaw response: ${rawBody}`);
	});

	it("extracts nothing from empty or non-string messages and keeps the body raw", () => {
		for (const rawBody of ['{"message":""}', '{"message":42}', '{"error":{"message":""}}']) {
			const norm = normalizeProviderError(openaiShapedError(400, JSON.parse(rawBody)));
			expect(formatProviderError(norm)).toBe(`400: ${rawBody}`);
		}
	});

	it("keeps a body with a plain-string `error` raw even when it has a `message`", () => {
		const rawBody = '{"error":"blocked by gateway WAF","message":"Invalid request parameters"}';
		const norm = normalizeProviderError(openaiShapedError(403, JSON.parse(rawBody)));

		expect(formatProviderError(norm)).toBe(`403: ${rawBody}`);
	});
});

describe("composed error keeps the raw body for substring consumers", () => {
	it("keeps a non-message overflow marker classifiable through isContextOverflow", () => {
		const rawBody = '{"code":"model_context_window_exceeded","message":"invalid request"}';
		const composed = formatProviderError(normalizeProviderError(openaiShapedError(400, JSON.parse(rawBody))));

		expect(composed).toContain(rawBody);
		expect(isContextOverflow(assistantError(composed))).toBe(true);
	});

	it("keeps the composed HTTP-413 string matching the anchored overflow pattern at its start", () => {
		const rawBody = '{"message":"failed to parse request","code":""}';
		const norm = normalizeProviderError(openaiShapedError(413, JSON.parse(rawBody)));
		const composed = formatProviderError(norm);
		const prefixed = formatProviderError(norm, "github-copilot API error");

		expect(composed).toContain(rawBody);
		expect(prefixed).toContain(rawBody);
		expect(isContextOverflow(assistantError(composed))).toBe(true);
		expect(isContextOverflow(assistantError(prefixed))).toBe(true);
		expect(
			isContextOverflow(
				assistantError(formatProviderError(normalizeProviderError(openaiShapedError(400, JSON.parse(rawBody))))),
			),
		).toBe(false);
	});
});
