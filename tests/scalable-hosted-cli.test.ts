import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	beginScalableDeviceLogin,
	parseScalableDevicePrompt,
	readScalableBrokerSnapshot,
	readScalableHoldingsPulse,
	type ScalableCliAuthFiles,
	ScalableCliError,
} from "@/server/providers/investment/scalable-hosted-cli";

const fixture = `#!/bin/sh
set -eu
dir="$XDG_CONFIG_HOME/scalable-cli"
if [ "$1" = login ]; then
  printf 'Open this URL:\nhttps://login.scalable.capital/device?user_code=ABCD-1234\n\nVerify the code ABCD-1234 in your browser.\n'
  printf '%s' '{"session":{"access_token":"test-access","refresh_token":"test-refresh"}}' > "$dir/session.json"
  printf '%s' '{"kty":"EC","crv":"P-256","d":"test-scalar"}' > "$dir/auth-signing-key.json"
  exit 0
fi
if [ "$1" = broker ]; then
  case "$2" in
    overview) printf '%s' '{"ok":true,"command":"broker overview","data":{"account_id":"acc-test","portfolio_id":"port-test","result":{"valuation":{"total":"4500"},"timestamps":{"valuation_timestamp_utc":"2026-09-17T08:00:00Z"}}}}' ;;
    holdings) printf '%s' '{"ok":true,"command":"broker holdings","data":{"account_id":"acc-test","portfolio_id":"port-test","result":{"items":[{"isin":"IE00B4L5Y983","name":"Test ETF","quantity":"45","valuation":"4500","valuation_currency":"EUR"}]}}}' ;;
    cash-breakdown) printf '%s' '{"ok":true,"command":"broker cash-breakdown","data":{"account_id":"acc-test","portfolio_id":"port-test","result":{"cash_balance":"69"}}}' ;;
    transactions) printf '%s' '{"ok":true,"command":"broker transactions","data":{"account_id":"acc-test","portfolio_id":"port-test","result":{"cursor":null,"items":[]}}}' ;;
    *) exit 9 ;;
  esac
  exit 0
fi
if [ "$1" = logout ]; then exit 0; fi
exit 9
`;

// Refreshes the session on every read, then fails everything but
// `broker overview` with the published network/backend status, the way a
// backend error after the token call does.
const rotatingFailure = `#!/bin/sh
set -eu
dir="$XDG_CONFIG_HOME/scalable-cli"
if [ "$1" = broker ]; then
  printf '{"session":{"access_token":"access-%s","refresh_token":"refresh-%s"}}' "$2" "$2" > "$dir/session.json"
  case "$2" in
    overview) printf '%s' '{"ok":true,"data":{"account_id":"acc-test","portfolio_id":"port-test","result":{}}}' ;;
    *) exit 30 ;;
  esac
  exit 0
fi
exit 9
`;

describe("hosted official CLI boundary", () => {
	let directory = "";
	let previous: string | undefined;
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "fortuna-hosted-cli-test-"));
		const binary = join(directory, "sc");
		await writeFile(binary, fixture);
		await chmod(binary, 0o700);
		previous = process.env.FORTUNA_SCALABLE_CLI_BIN;
		process.env.FORTUNA_SCALABLE_CLI_BIN = binary;
	});
	afterAll(async () => {
		if (previous === undefined) delete process.env.FORTUNA_SCALABLE_CLI_BIN;
		else process.env.FORTUNA_SCALABLE_CLI_BIN = previous;
		await rm(directory, { recursive: true, force: true });
	});
	it("accepts only a Scalable HTTPS device prompt", () => {
		expect(
			parseScalableDevicePrompt(
				"Open this URL:\nhttps://evil.example/device\nVerify the code ABCD-1234 in your browser.",
			),
		).toBeNull();
		expect(
			parseScalableDevicePrompt(
				"Open this URL:\nhttps://login.scalable.capital/device\nVerify the code ABCD-1234 in your browser.",
			),
		).toMatchObject({ code: "ABCD-1234" });
	});
	it("finishes device login without returning session material", async () => {
		let complete: (auth: ScalableCliAuthFiles) => void = () => undefined;
		const completed = new Promise<ScalableCliAuthFiles>((resolve) => {
			complete = resolve;
		});
		const prompt = await beginScalableDeviceLogin(
			"test-owner",
			async (auth) => complete(auth),
			async () => {
				throw new Error("unexpected login failure");
			},
		);
		expect(prompt).toMatchObject({
			code: "ABCD-1234",
			url: "https://login.scalable.capital/device?user_code=ABCD-1234",
		});
		expect(JSON.stringify(prompt)).not.toContain("test-access");
		const auth = await completed;
		expect(auth.session).toContain("test-access");
		expect(auth.signingKey).toContain("test-scalar");
	});
	it("unwraps official --json envelopes and runs only broker read commands", async () => {
		const auth: ScalableCliAuthFiles = {
			session:
				'{"session":{"access_token":"test-access","refresh_token":"test-refresh"}}',
			signingKey: '{"kty":"EC","crv":"P-256","d":"test-scalar"}',
		};
		let refreshes = 0;
		const bundle = await readScalableBrokerSnapshot(auth, async () => {
			refreshes += 1;
		});
		expect(refreshes).toBe(4);
		expect(bundle.overview).toMatchObject({
			account_id: "acc-test",
			result: { valuation: { total: "4500" } },
		});
		expect(bundle.transactions).toHaveLength(1);
		const pulse = await readScalableHoldingsPulse(auth, async () => {
			refreshes += 1;
		});
		expect(pulse).toMatchObject({
			account_id: "acc-test",
			result: { items: [{ isin: "IE00B4L5Y983" }] },
		});
		expect(refreshes).toBe(5);
	});
	it("keeps a session the CLI refreshed before a read failed", async () => {
		const binary = join(directory, "sc-rotating");
		await writeFile(binary, rotatingFailure);
		await chmod(binary, 0o700);
		process.env.FORTUNA_SCALABLE_CLI_BIN = binary;
		const auth: ScalableCliAuthFiles = {
			session:
				'{"session":{"access_token":"test-access","refresh_token":"test-refresh"}}',
			signingKey: '{"kty":"EC","crv":"P-256","d":"test-scalar"}',
		};
		try {
			const snapshotSaves: string[] = [];
			const snapshot = readScalableBrokerSnapshot(auth, async (updated) => {
				snapshotSaves.push(updated.session);
			});
			await expect(snapshot).rejects.toBeInstanceOf(ScalableCliError);
			await expect(snapshot).rejects.toMatchObject({
				code: "CLI_NETWORK_OR_BACKEND_ERROR",
				exitStatus: 30,
			});
			expect(snapshotSaves).toHaveLength(2);
			expect(snapshotSaves[0]).toContain("refresh-overview");
			expect(snapshotSaves[1]).toContain("refresh-holdings");

			const pulseSaves: string[] = [];
			await expect(
				readScalableHoldingsPulse(auth, async (updated) => {
					pulseSaves.push(updated.session);
				}),
			).rejects.toBeInstanceOf(ScalableCliError);
			expect(pulseSaves).toEqual([expect.stringContaining("refresh-holdings")]);
		} finally {
			process.env.FORTUNA_SCALABLE_CLI_BIN = join(directory, "sc");
		}
	});
});
