import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
	test: {
		environment: "node",
		include: ["tests/**/*.test.{ts,tsx}"],
		exclude: ["tests/integration/**/*.test.ts"],
		env: {
			DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/test",
			BETTER_AUTH_SECRET: "unit-test-secret-at-least-32-bytes-long-000",
		},
	},
});
