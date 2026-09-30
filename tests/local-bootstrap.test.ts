import { describe, expect, it } from "vitest";
import { assertLocalBootstrapTarget } from "../src/server/db/local-bootstrap";

describe("local bootstrap boundary", () => {
	for (const name of [
		"fortuna_dev",
		"fortuna_test",
		"fortuna_demo_portfolio",
	]) {
		it(`accepts the isolated local ${name} target`, () => {
			expect(() =>
				assertLocalBootstrapTarget(`postgres://demo@127.0.0.1:5432/${name}`),
			).not.toThrow();
		});
	}
	for (const url of [
		"postgres://demo@production.example.test/fortuna_dev",
		"postgres://demo@localhost/fortuna",
		"postgres://demo@localhost/other",
	]) {
		it("refuses remote or non-demo databases", () => {
			expect(() => assertLocalBootstrapTarget(url)).toThrow();
		});
	}
	it("refuses production mode even on localhost", () => {
		expect(() =>
			assertLocalBootstrapTarget(
				"postgres://demo@localhost/fortuna_dev",
				"production",
			),
		).toThrow();
	});
});
