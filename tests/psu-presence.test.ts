import { describe, expect, it } from "vitest";
import {
	psuHeadersFor,
	psuPresenceFromHeaders,
} from "@/server/providers/bank/psu-presence";

const browser = () =>
	psuPresenceFromHeaders(
		new Headers({
			"x-forwarded-for": "203.0.113.7, 10.0.0.1",
			"user-agent": "Mozilla/5.0 (Macintosh)",
			"accept-language": "de-DE,de;q=0.9",
		}),
	);

describe("psu presence", () => {
	it("takes the browser address from the forwarding chain", () => {
		// Behind Railway's proxy the socket address is the proxy, not the owner.
		expect(browser().ipAddress).toBe("203.0.113.7");
		expect(browser().userAgent).toBe("Mozilla/5.0 (Macintosh)");
	});

	it("sends address and agent when the bank requires nothing specific", () => {
		expect(psuHeadersFor(browser(), [])).toEqual({
			"Psu-Ip-Address": "203.0.113.7",
			"Psu-User-Agent": "Mozilla/5.0 (Macintosh)",
		});
	});

	it("fills exactly what the bank requires", () => {
		expect(
			psuHeadersFor(browser(), ["Psu-Ip-Address", "Psu-Accept-Language"]),
		).toEqual({
			"Psu-Ip-Address": "203.0.113.7",
			"Psu-Accept-Language": "de-DE,de;q=0.9",
		});
	});

	it("sends nothing when a required header cannot be filled", () => {
		// A partial set is rejected with PSU_HEADER_NOT_PROVIDED, so the read has
		// to go out unattended instead.
		expect(psuHeadersFor(browser(), ["Psu-Geo-Location"])).toBeNull();
	});

	it("sends nothing without a request behind it", () => {
		expect(psuHeadersFor(null, [])).toBeNull();
		expect(psuHeadersFor(psuPresenceFromHeaders(new Headers()), [])).toBeNull();
	});
});
