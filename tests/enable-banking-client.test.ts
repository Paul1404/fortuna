import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	createEnableBankingJwt,
	EnableBankingApiError,
	getEnableBankingBalances,
	getEnableBankingTransactions,
	INSTITUTION_COUNTRIES,
	listInstitutions,
	startEnableBankingAuthorization,
	testEnableBankingAccess,
} from "@/server/providers/bank/enable-banking-client";

describe("Enable Banking API client", () => {
	const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const privateKeyPem = keys.privateKey
		.export({ format: "pem", type: "pkcs8" })
		.toString();
	const applicationId = "11111111-2222-4333-8444-555555555555";

	it("creates the documented short-lived RS256 JWT", () => {
		const token = createEnableBankingJwt({
			applicationId,
			privateKeyPem,
			now: 1_700_000_000,
		});
		const [encodedHeader, encodedBody, signature] = token.split(".");
		expect(
			JSON.parse(Buffer.from(encodedHeader, "base64url").toString()),
		).toEqual({ typ: "JWT", alg: "RS256", kid: applicationId });
		expect(
			JSON.parse(Buffer.from(encodedBody, "base64url").toString()),
		).toEqual({
			iss: "enablebanking.com",
			aud: "api.enablebanking.com",
			iat: 1_700_000_000,
			exp: 1_700_000_300,
		});
		expect(
			createVerify("RSA-SHA256")
				.update(`${encodedHeader}.${encodedBody}`)
				.end()
				.verify(keys.publicKey, signature, "base64url"),
		).toBe(true);
	});

	it("returns only sanitized application and German coverage metadata", async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			return url.endsWith("/application")
				? Response.json({
						environment: "PRODUCTION",
						active: true,
						services: ["AIS"],
					})
				: Response.json({ aspsps: [{ name: "A" }, { name: "B" }] });
		});
		const fetcher = fetchMock as unknown as typeof fetch;
		await expect(
			testEnableBankingAccess({ applicationId, privateKeyPem }, fetcher),
		).resolves.toEqual({
			environment: "PRODUCTION",
			active: true,
			services: ["AIS"],
			germanInstitutionCount: 2,
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("starts authorization with the selected German institution", async () => {
		const fetcher = vi.fn(
			async (_input: string | URL | Request, init?: RequestInit) => {
				expect(JSON.parse(String(init?.body))).toMatchObject({
					// The scope has to be explicit: left to the bank, some grant
					// nothing but the account list and the consent arrives empty.
					access: {
						valid_until: "2027-01-01T00:00:00Z",
						balances: true,
						transactions: true,
					},
					aspsp: { name: "Meine Bank", country: "DE" },
					state: "state-1",
					redirect_url: "https://fortuna.example/callback",
					psu_type: "personal",
				});
				return Response.json({
					url: "https://auth.enablebanking.com/start",
					authorization_id: "auth-1",
				});
			},
		) as unknown as typeof fetch;
		await expect(
			startEnableBankingAuthorization(
				{ applicationId, privateKeyPem },
				{
					institutionName: "Meine Bank",
					institutionCountry: "DE",
					state: "state-1",
					redirectUrl: "https://fortuna.example/callback",
					validUntil: "2027-01-01T00:00:00Z",
				},
				fetcher,
			),
		).resolves.toEqual({
			url: "https://auth.enablebanking.com/start",
			authorizationId: "auth-1",
		});
	});

	it("deduplicates institutions and follows transaction continuation pages", async () => {
		let page = 0;
		const transactionFetchMock = vi.fn(
			async (input: string | URL | Request) => {
				const url = String(input);
				if (url.includes("/aspsps")) {
					// A German list, and one country that answers with an error —
					// which must not take the rest of the picker down.
					if (url.includes("country=DE"))
						return Response.json({
							aspsps: [
								{ name: "Bank B", country: "DE" },
								{ name: "Bank A", country: "DE" },
								{ name: "Bank A", country: "DE" },
							],
						});
					if (url.includes("country=LU"))
						return Response.json({
							aspsps: [
								{
									name: "PayPal",
									country: "LU",
									required_psu_headers: ["Psu-Ip-Address"],
								},
							],
						});
					return new Response("nope", { status: 403 });
				}
				page += 1;
				return Response.json({
					transactions: [{ entry_reference: `tx-${page}` }],
					continuation_key: page === 1 ? "next-page" : null,
				});
			},
		);
		const fetcher = transactionFetchMock as unknown as typeof fetch;
		await expect(
			listInstitutions({ applicationId, privateKeyPem }, fetcher),
		).resolves.toEqual([
			{ name: "Bank A", country: "DE", requiredPsuHeaders: [] },
			{ name: "Bank B", country: "DE", requiredPsuHeaders: [] },
			{
				name: "PayPal",
				country: "LU",
				requiredPsuHeaders: ["Psu-Ip-Address"],
			},
		]);
		// Every country is asked, not just Germany: PayPal Europe is Luxembourg.
		const asked = transactionFetchMock.mock.calls
			.map((call) => String(call[0]))
			.filter((url) => url.includes("/aspsps"));
		for (const country of INSTITUTION_COUNTRIES)
			expect(asked.some((url) => url.includes(`country=${country}`))).toBe(
				true,
			);
		await expect(
			getEnableBankingTransactions(
				{ applicationId, privateKeyPem },
				"account-1",
				"2026-01-01",
				fetcher,
			),
		).resolves.toHaveLength(2);
		expect(String(transactionFetchMock.mock.calls.at(-1)?.[0])).toContain(
			"continuation_key=next-page",
		);
	});
	it("stops when the provider hands out a continuation key a second time", async () => {
		const fetcher = vi.fn(async () =>
			Response.json({
				transactions: [{ entry_reference: "tx" }],
				continuation_key: "same-key",
			}),
		) as unknown as typeof fetch;
		await expect(
			getEnableBankingTransactions(
				{ applicationId, privateKeyPem },
				"account-1",
				"2026-01-01",
				fetcher,
			),
		).resolves.toHaveLength(2);
		// The first page and the one the key points at, not a hundred requests
		// against the bank's daily allowance.
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("keeps provider response text out of 429 errors and classifies the operation", async () => {
		const fetcher = vi.fn(async () =>
			Response.json(
				{
					code: "ASPSP_RATE_LIMIT_EXCEEDED",
					message: "Private IBAN DE44500105175407324931",
				},
				{ status: 429 },
			),
		) as unknown as typeof fetch;
		const error = await getEnableBankingBalances(
			{ applicationId, privateKeyPem },
			"account-1",
			fetcher,
		).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(EnableBankingApiError);
		expect(error).toMatchObject({
			status: 429,
			providerCode: "ASPSP_RATE_LIMIT_EXCEEDED",
			operation: "balances",
		});
		expect((error as EnableBankingApiError).message).not.toContain(
			"DE44500105175407324931",
		);
		expect(JSON.stringify(error)).not.toContain("DE44500105175407324931");
	});
});
