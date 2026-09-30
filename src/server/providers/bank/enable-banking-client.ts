import { createSign } from "node:crypto";

const API_BASE = "https://api.enablebanking.com";

export type EnableBankingCredential = {
	applicationId: string;
	privateKeyPem: string;
};

export type EnableBankingAccessCheck = {
	environment: string;
	active: boolean;
	services: string[];
	germanInstitutionCount: number;
};

export class EnableBankingApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly providerCode:
			| "ASPSP_RATE_LIMIT_EXCEEDED"
			| "ACCESS_EXCEEDED"
			| null = null,
		readonly operation:
			| "account_details"
			| "balances"
			| "transactions"
			| "other" = "other",
	) {
		super(message);
	}
}

function safeOperation(path: string): EnableBankingApiError["operation"] {
	if (path.endsWith("/details")) return "account_details";
	if (path.endsWith("/balances")) return "balances";
	if (path.includes("/transactions")) return "transactions";
	return "other";
}

function encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createEnableBankingJwt(input: {
	applicationId: string;
	privateKeyPem: string;
	now?: number;
}): string {
	const now = input.now ?? Math.floor(Date.now() / 1000);
	const header = encode({ typ: "JWT", alg: "RS256", kid: input.applicationId });
	const body = encode({
		iss: "enablebanking.com",
		aud: "api.enablebanking.com",
		iat: now,
		exp: now + 300,
	});
	const unsigned = `${header}.${body}`;
	const signature = createSign("RSA-SHA256")
		.update(unsigned)
		.end()
		.sign(input.privateKeyPem, "base64url");
	return `${unsigned}.${signature}`;
}

async function requestJson(
	path: string,
	token: string,
	fetcher: typeof fetch,
	init: RequestInit = {},
	psuHeaders: Record<string, string> | null = null,
): Promise<Record<string, unknown>> {
	const headers = new Headers(init.headers);
	headers.set("Accept", "application/json");
	headers.set("Authorization", `Bearer ${token}`);
	if (init.body) headers.set("Content-Type", "application/json");
	// Present-owner reads are not counted against the bank's daily allowance.
	for (const [name, value] of Object.entries(psuHeaders ?? {}))
		headers.set(name, value);
	const response = await fetcher(`${API_BASE}${path}`, {
		...init,
		headers,
		signal: AbortSignal.timeout(10_000),
	});
	const payload = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	if (!response.ok) {
		const providerCode =
			payload.code === "ASPSP_RATE_LIMIT_EXCEEDED" ||
			payload.code === "ACCESS_EXCEEDED"
				? payload.code
				: null;
		throw new EnableBankingApiError(
			`Enable Banking HTTP ${response.status}`,
			response.status,
			providerCode,
			safeOperation(path),
		);
	}
	return payload;
}

export async function testEnableBankingAccess(
	credential: EnableBankingCredential,
	fetcher: typeof fetch = fetch,
): Promise<EnableBankingAccessCheck> {
	const token = createEnableBankingJwt(credential);
	const application = await requestJson("/application", token, fetcher);
	const providers = await requestJson(
		"/aspsps?country=DE&service=AIS&psu_type=personal",
		token,
		fetcher,
	);
	// Kept to DE on purpose: this is a reachability check, not the picker.
	return {
		environment:
			typeof application.environment === "string"
				? application.environment
				: "UNKNOWN",
		active: application.active === true,
		services: Array.isArray(application.services)
			? application.services.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
		germanInstitutionCount: Array.isArray(providers.aspsps)
			? providers.aspsps.length
			: 0,
	};
}

/**
 * Countries whose institutions a German owner plausibly banks with.
 *
 * Asking only for `DE` hid every provider licensed elsewhere, and some of the
 * ones that matter most are: PayPal Europe is a Luxembourg credit institution,
 * Revolut is Lithuanian, bunq Dutch, Wise Belgian. None of them could ever
 * appear in the picker, however well the rest of the integration worked.
 */
export const INSTITUTION_COUNTRIES = [
	"DE",
	"LU",
	"AT",
	"LT",
	"NL",
	"BE",
	"IE",
] as const;

export type Institution = {
	name: string;
	country: string;
	requiredPsuHeaders: string[];
};

// The list changes about as often as a bank is founded, and it is read on
// every connect screen and before every sync. Keyed by application so a new
// key never serves the previous application's institutions.
const institutionCache = new Map<
	string,
	{ entries: Institution[]; readAt: number }
>();
const INSTITUTION_TTL_MS = 60 * 60 * 1_000;

function toInstitutions(payload: Record<string, unknown>): Institution[] {
	if (!Array.isArray(payload.aspsps)) return [];
	return payload.aspsps.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const item = entry as Record<string, unknown>;
		if (typeof item.name !== "string" || typeof item.country !== "string")
			return [];
		return [
			{
				name: item.name,
				country: item.country,
				requiredPsuHeaders: Array.isArray(item.required_psu_headers)
					? item.required_psu_headers.filter(
							(value): value is string => typeof value === "string",
						)
					: [],
			},
		];
	});
}

export async function listInstitutions(
	credential: EnableBankingCredential,
	fetcher: typeof fetch = fetch,
): Promise<Institution[]> {
	const cached = institutionCache.get(credential.applicationId);
	if (cached && Date.now() - cached.readAt < INSTITUTION_TTL_MS)
		return cached.entries;
	const token = createEnableBankingJwt(credential);
	// One country per request, in parallel. A country the application is not
	// licensed for answers with an error, which must not take the rest down.
	const results = await Promise.all(
		INSTITUTION_COUNTRIES.map(async (country) => {
			try {
				return toInstitutions(
					await requestJson(
						`/aspsps?country=${country}&service=AIS&psu_type=personal`,
						token,
						fetcher,
					),
				);
			} catch {
				return [];
			}
		}),
	);
	const byKey = new Map<string, Institution>();
	for (const entry of results.flat())
		byKey.set(`${entry.country}|${entry.name}`, entry);
	const entries = [...byKey.values()].sort(
		(left, right) =>
			left.name.localeCompare(right.name, "de") ||
			left.country.localeCompare(right.country),
	);
	institutionCache.set(credential.applicationId, {
		entries,
		readAt: Date.now(),
	});
	return entries;
}

/**
 * Which PSU headers an institution insists on.
 *
 * The country is part of the identity: two countries can hold an institution
 * of the same name, and looking one up in the wrong country's list returns
 * nothing. That silently falls back to "no headers required", which drops the
 * PSU presence headers and with them the exemption from the four-reads-a-day
 * limit — a sync that quietly gets rarer rather than an error.
 */
export async function getRequiredPsuHeaders(
	credential: EnableBankingCredential,
	institutionName: string,
	country: string,
	fetcher: typeof fetch = fetch,
): Promise<string[]> {
	const entries = await listInstitutions(credential, fetcher);
	const match = entries.find(
		(entry) => entry.name === institutionName && entry.country === country,
	);
	return match?.requiredPsuHeaders ?? [];
}

export async function startEnableBankingAuthorization(
	credential: EnableBankingCredential,
	input: {
		institutionName: string;
		institutionCountry: string;
		state: string;
		redirectUrl: string;
		validUntil: string;
	},
	fetcher: typeof fetch = fetch,
): Promise<{ url: string; authorizationId: string }> {
	const payload = await requestJson(
		"/auth",
		createEnableBankingJwt(credential),
		fetcher,
		{
			method: "POST",
			body: JSON.stringify({
				// Asking only for a validity leaves the scope to the bank, and the
				// provider documents that some then grant nothing but the account
				// list — which is how Deutsche Bank returned an authorised consent
				// with no accounts at all. Fortuna reads balances and transactions,
				// so it says so.
				access: {
					valid_until: input.validUntil,
					balances: true,
					transactions: true,
				},
				aspsp: {
					name: input.institutionName,
					country: input.institutionCountry,
				},
				state: input.state,
				redirect_url: input.redirectUrl,
				psu_type: "personal",
			}),
		},
	);
	if (typeof payload.url !== "string") {
		throw new EnableBankingApiError(
			"Enable Banking hat keine Weiterleitungs-URL geliefert",
			502,
		);
	}
	return {
		url: payload.url,
		authorizationId:
			typeof payload.authorization_id === "string"
				? payload.authorization_id
				: input.state,
	};
}

export async function authorizeEnableBankingSession(
	credential: EnableBankingCredential,
	code: string,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
	return requestJson("/sessions", createEnableBankingJwt(credential), fetcher, {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

/**
 * Read an existing session. Used to recover the authorised account list when
 * the authorisation response itself carried none.
 */
export async function getEnableBankingSession(
	credential: EnableBankingCredential,
	sessionId: string,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
	return requestJson(
		`/sessions/${encodeURIComponent(sessionId)}`,
		createEnableBankingJwt(credential),
		fetcher,
	);
}

export async function getEnableBankingAccountDetails(
	credential: EnableBankingCredential,
	accountId: string,
	fetcher: typeof fetch = fetch,
	psuHeaders: Record<string, string> | null = null,
): Promise<Record<string, unknown>> {
	return requestJson(
		`/accounts/${encodeURIComponent(accountId)}/details`,
		createEnableBankingJwt(credential),
		fetcher,
		{},
		psuHeaders,
	);
}

export async function getEnableBankingBalances(
	credential: EnableBankingCredential,
	accountId: string,
	fetcher: typeof fetch = fetch,
	psuHeaders: Record<string, string> | null = null,
): Promise<Record<string, unknown>[]> {
	const payload = await requestJson(
		`/accounts/${encodeURIComponent(accountId)}/balances`,
		createEnableBankingJwt(credential),
		fetcher,
		{},
		psuHeaders,
	);
	return Array.isArray(payload.balances)
		? payload.balances.filter(
				(item): item is Record<string, unknown> =>
					Boolean(item) && typeof item === "object",
			)
		: [];
}

export async function getEnableBankingTransactions(
	credential: EnableBankingCredential,
	accountId: string,
	dateFrom: string | null,
	fetcher: typeof fetch = fetch,
	psuHeaders: Record<string, string> | null = null,
): Promise<Record<string, unknown>[]> {
	const transactions: Record<string, unknown>[] = [];
	let continuationKey: string | null = null;
	// A key the provider has already handed out leads back to a page already
	// read; following it again only spends requests against the bank's limit.
	const seenKeys = new Set<string>();
	for (let page = 0; page < 100; page += 1) {
		const params = new URLSearchParams();
		if (dateFrom) params.set("date_from", dateFrom);
		if (continuationKey) params.set("continuation_key", continuationKey);
		const payload = await requestJson(
			`/accounts/${encodeURIComponent(accountId)}/transactions?${params}`,
			createEnableBankingJwt(credential),
			fetcher,
			{},
			psuHeaders,
		);
		if (Array.isArray(payload.transactions)) {
			transactions.push(
				...payload.transactions.filter(
					(item): item is Record<string, unknown> =>
						Boolean(item) && typeof item === "object",
				),
			);
		}
		continuationKey =
			typeof payload.continuation_key === "string" && payload.continuation_key
				? payload.continuation_key
				: null;
		if (!continuationKey || seenKeys.has(continuationKey)) break;
		seenKeys.add(continuationKey);
	}
	return transactions;
}
