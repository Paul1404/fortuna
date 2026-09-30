// PSD2 lets a bank refuse background account reads after four a day, but places
// no limit on reads the owner actively asks for. The bank can only tell the two
// apart from the PSU presence headers, so Fortuna forwards the real browser's
// details for every sync it performs — which are all owner-triggered, because
// nothing but the app itself starts one.
//
// Enable Banking requires all of an institution's `required_psu_headers` or
// none at all; a partial set fails with PSU_HEADER_NOT_PROVIDED.

export type PsuPresence = {
	ipAddress: string | null;
	userAgent: string | null;
	accept: string | null;
	acceptCharset: string | null;
	acceptEncoding: string | null;
	acceptLanguage: string | null;
	referer: string | null;
};

/** The owner's own request details, taken from the browser call that ran. */
export function psuPresenceFromHeaders(headers: Headers): PsuPresence {
	// Railway terminates TLS in front of the app, so the browser address is in
	// the forwarding chain rather than on the socket.
	const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return {
		ipAddress: forwarded || headers.get("x-real-ip") || null,
		userAgent: headers.get("user-agent"),
		accept: headers.get("accept"),
		acceptCharset: headers.get("accept-charset"),
		acceptEncoding: headers.get("accept-encoding"),
		acceptLanguage: headers.get("accept-language"),
		referer: headers.get("referer"),
	};
}

const HEADER_NAMES: Record<keyof PsuPresence, string> = {
	ipAddress: "Psu-Ip-Address",
	userAgent: "Psu-User-Agent",
	accept: "Psu-Accept",
	acceptCharset: "Psu-Accept-Charset",
	acceptEncoding: "Psu-Accept-Encoding",
	acceptLanguage: "Psu-Accept-Language",
	referer: "Psu-Referer",
};

/** The headers this presence can actually fill, by their wire names. */
function availableHeaders(presence: PsuPresence): Map<string, string> {
	const available = new Map<string, string>();
	for (const [key, name] of Object.entries(HEADER_NAMES)) {
		const value = presence[key as keyof PsuPresence];
		if (value) available.set(name.toLowerCase(), value);
	}
	return available;
}

/**
 * The PSU headers to send, or null when the institution requires one Fortuna
 * cannot supply — a geolocation, for instance. Sending a partial set is
 * rejected outright, so in that case the read stays unattended.
 */
export function psuHeadersFor(
	presence: PsuPresence | null,
	requiredHeaders: readonly string[],
): Record<string, string> | null {
	if (!presence) return null;
	const available = availableHeaders(presence);
	// An address alone says nothing about presence without the agent behind it.
	if (!available.has("psu-ip-address") || !available.has("psu-user-agent"))
		return null;
	const headers: Record<string, string> = {};
	for (const required of requiredHeaders) {
		const value = available.get(required.toLowerCase());
		if (!value) return null;
		headers[required] = value;
	}
	// With nothing specifically required, address and agent are what identify a
	// present owner to the bank.
	if (Object.keys(headers).length === 0) {
		headers["Psu-Ip-Address"] = available.get("psu-ip-address") as string;
		headers["Psu-User-Agent"] = available.get("psu-user-agent") as string;
	}
	return headers;
}
