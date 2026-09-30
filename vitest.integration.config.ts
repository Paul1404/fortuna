import { resolve } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests hit a real PostgreSQL. Locally the connection comes from
// .env; in CI the workflow sets DATABASE_URL and FORTUNA_INTEGRATION_TEST.
const fileEnv = loadEnv("test", process.cwd(), "");

export default defineConfig({
	resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
	test: {
		environment: "node",
		include: ["tests/integration/**/*.test.ts"],
		fileParallelism: false,
		testTimeout: 30_000,
		env: {
			DATABASE_URL: process.env.DATABASE_URL ?? fileEnv.DATABASE_URL ?? "",
			BETTER_AUTH_SECRET:
				process.env.BETTER_AUTH_SECRET ?? fileEnv.BETTER_AUTH_SECRET ?? "",
			BETTER_AUTH_URL:
				process.env.BETTER_AUTH_URL ??
				fileEnv.BETTER_AUTH_URL ??
				"http://localhost:3000",
			FORTUNA_INTEGRATION_TEST: process.env.FORTUNA_INTEGRATION_TEST ?? "1",
		},
	},
});
