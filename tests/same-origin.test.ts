import { describe, expect, it } from "vitest";
import { validateSameOriginRequest } from "@/server/same-origin";

function request(origin?: string, fetchSite?: string) {
	const headers = new Headers();
	if (origin) headers.set("origin", origin);
	if (fetchSite) headers.set("sec-fetch-site", fetchSite);
	return new Request("https://fortuna.pdcd.net/api/upload", {
		method: "POST",
		headers,
	});
}

describe("same-origin mutation boundary", () => {
	it("accepts the configured production origin", () => {
		expect(
			validateSameOriginRequest(
				request("https://fortuna.pdcd.net", "same-origin"),
				{
					baseUrl: "https://fortuna.pdcd.net",
					nodeEnv: "production",
				},
			),
		).toBeNull();
	});

	it("rejects missing, foreign and cross-site origins", () => {
		const options = {
			baseUrl: "https://fortuna.pdcd.net",
			nodeEnv: "production",
		};
		expect(validateSameOriginRequest(request(), options)?.status).toBe(403);
		expect(
			validateSameOriginRequest(request("https://example.com"), options)
				?.status,
		).toBe(403);
		expect(
			validateSameOriginRequest(
				request("https://fortuna.pdcd.net", "cross-site"),
				options,
			)?.status,
		).toBe(403);
	});
});
