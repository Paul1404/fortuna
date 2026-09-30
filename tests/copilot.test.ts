import { describe, expect, it } from "vitest";
import {
	buildCopilotPrompt,
	COPILOT_DEVELOPER_INSTRUCTIONS,
	COPILOT_MODEL,
	COPILOT_TOOLS,
	classifyCopilotFocus,
	copilotInstructions,
	copilotToolSpecs,
	selectCopilotToolNames,
	withoutAccountIdentifiers,
} from "@/server/services/copilot";

describe("Fortuna Copilot", () => {
	it("acts as a strict Lower Franconian accountant who asks one question", () => {
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain(
			"unterfränkischer Buchhalter",
		);
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain(
			"genau eine kurze Frage mit Referenz, Datum, Betrag und Originaltext",
		);
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).not.toContain("Buchhalterprüfung");
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain(
			"nicht vertrauenswürdige Daten",
		);
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain("remember_user_context");
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain("Zielaufteilung");
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain("Market Timing");
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain(
			"Eine Zahlung beweist weder Produktnutzung noch Besitz",
		);
		expect(COPILOT_DEVELOPER_INSTRUCTIONS).toContain(
			"Keine Zahlung, Wertpapierorder, Vertragskündigung",
		);
	});

	it("addresses the owner formally by last name", () => {
		const instructions = copilotInstructions("Alex Beispiel");
		expect(instructions).toContain('als "Herr Beispiel"');
		expect(instructions).toContain("Duzen Sie ihn nie");
		expect(instructions).toContain("GitHub-Flavored Markdown");
	});

	it("uses the small Luna model", () => {
		expect(COPILOT_MODEL).toBe("gpt-5.6-luna");
	});

	it("grounds answers in the supplied Fortuna snapshot", () => {
		const prompt = buildCopilotPrompt(
			"Was kostet mich das?",
			[{ role: "assistant", content: "Worum geht es?" }],
			{ monthlyCostMinor: 2_000, currency: "EUR" },
		);
		expect(prompt).toContain("AKTUELLER FORTUNA-SNAPSHOT");
		expect(prompt).toContain('"monthlyCostMinor":2000');
		expect(prompt).toContain("FRAGE:\nWas kostet mich das?");
	});

	it("keeps only the ten latest messages", () => {
		const history = Array.from({ length: 12 }, (_, index) => ({
			role: "user" as const,
			content: `Nachricht ${index}`,
		}));
		const prompt = buildCopilotPrompt("Weiter", history, {});
		expect(prompt).not.toContain("Nachricht 0\n");
		expect(prompt).toContain("Nachricht 11");
	});

	it("exposes broad app editing without destructive tools", () => {
		const specs = copilotToolSpecs();
		const namespace = specs.find((tool) => tool.type === "namespace");
		expect(namespace?.name).toBe("fortuna");
		const tools = specs.flatMap((spec) =>
			spec.type === "namespace" ? spec.tools : [spec],
		);
		const names = tools.map((tool) => tool.name);
		expect(names).toContain("update_app_settings");
		expect(names).toContain("update_transaction");
		expect(names).toContain("record_asset_valuation");
		expect(names).toContain("remember_user_context");
		expect(names).toContain("forget_user_context");
		expect(names).toContain("read_contract_document");
		expect(names).toContain("update_investment_targets");
		expect(names).not.toContain("update_investment_policy");
		expect(names).toContain("get_financial_profile");
		expect(names).toContain("get_financial_observations");
		expect(names).toContain("get_weekly_financial_report");
		expect(names).toContain("estimate_purchase_impact");
		expect(names).toContain("get_accounts");
		expect(names).toContain("get_transactions");
		expect(names).toContain("get_recurring_payments");
		expect(names).toContain("get_assets");
		expect(names).toContain("get_liabilities");
		expect(names).toContain("get_investments");
		expect(names).toContain("get_net_worth");
		expect(names).toContain("get_forecast");
		expect(
			names.some((name) =>
				/order|withdraw|transfer_money|cancel_contract/.test(name),
			),
		).toBe(false);
		expect(names.some((name) => name.includes("delete"))).toBe(false);
		expect(tools.every((tool) => tool.inputSchema.type === "object")).toBe(
			true,
		);
		expect(
			tools.find((tool) => tool.name === "get_fortuna_state")?.deferLoading,
		).toBe(false);
		expect(
			tools.find((tool) => tool.name === "update_transaction")?.deferLoading,
		).toBe(true);
		expect(namespace?.tools.every((tool) => tool.deferLoading === true)).toBe(
			true,
		);
	});

	it("loads only the tool groups relevant to the question", () => {
		const transactionTools = selectCopilotToolNames("Was war Ausgabe 32?");
		expect(classifyCopilotFocus("Was war Ausgabe 32?")).toContain(
			"transactions",
		);
		expect(transactionTools).toContain("update_transaction");
		expect(transactionTools).not.toContain("create_security");
		expect(transactionTools.length).toBeLessThan(35);
		const attachmentTools = selectCopilotToolNames("Bitte prüfen", true);
		expect(attachmentTools).toContain("attach_contract_document");
	});

	it("hands the model no IBAN or provider account reference", () => {
		const safe = withoutAccountIdentifiers({
			rules: [
				{ id: "r1", name: "Miete", counterpartyIban: "DE89370400440532013000" },
			],
			account: {
				id: "a1",
				iban: "DE02120300000000202051",
				providerAccountRef: "owner@example.com",
				createdAt: new Date("2026-09-01T00:00:00Z"),
			},
		});
		expect(JSON.stringify(safe)).not.toMatch(/DE89|DE02|example\.com/);
		expect(safe).toMatchObject({
			rules: [{ id: "r1", name: "Miete" }],
			account: { id: "a1", createdAt: "2026-09-01T00:00:00.000Z" },
		});
		expect(withoutAccountIdentifiers(undefined)).toBeUndefined();
	});

	it("tells a client which amounts are signed", () => {
		const description = (name: string) =>
			COPILOT_TOOLS.find((tool) => tool.name === name)?.description ?? "";
		for (const name of [
			"record_cash_movement",
			"create_transaction",
			"update_transaction",
		])
			expect(description(name)).toMatch(/negative/);
	});
	it("no longer offers the removed tools", () => {
		const names = COPILOT_TOOLS.map((tool) => tool.name);
		for (const removed of [
			"create_budget",
			"get_budgets",
			"create_scenario",
			"update_account_projection",
			"create_security",
			"record_security_price",
			"create_investment_position",
		])
			expect(names).not.toContain(removed);
	});
});
