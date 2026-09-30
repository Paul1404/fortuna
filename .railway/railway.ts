import {
	bucket,
	defineRailway,
	github,
	postgres,
	preserve,
	project,
	ref,
	service,
} from "railway/iac";

// Railway infrastructure as code. Review with `railway config plan`; apply
// only deliberately (`railway config apply`) after reading the plan.
export default defineRailway(() => {
	const db = postgres("Postgres", { region: "europe-west4-drams3a" });
	const files = bucket("fortuna-files", { region: "ams" });

	const app = service("fortuna-app", {
		source: github("Paul1404/fortuna", { branch: "main", checkSuites: false }),
		build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
		// Runs in a separate container before the new release starts: applies
		// Drizzle migrations and creates the owner account on first deploy.
		preDeploy: "bun src/server/db/migrate.ts",
		start: "bun .output/server/index.mjs",
		healthcheck: "/api/health",
		healthcheckTimeout: 60,
		domains: ["fortuna.pdcd.net"],
		replicas: { "europe-west4-drams3a": 1 },
		deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
			env: {
			DATABASE_URL: db.env.DATABASE_URL,
			OBJECT_STORAGE_ENDPOINT: ref(files, "ENDPOINT"),
			OBJECT_STORAGE_REGION: ref(files, "REGION"),
			OBJECT_STORAGE_BUCKET: ref(files, "BUCKET"),
			OBJECT_STORAGE_ACCESS_KEY_ID: ref(files, "ACCESS_KEY_ID"),
			OBJECT_STORAGE_SECRET_ACCESS_KEY: ref(files, "SECRET_ACCESS_KEY"),
			OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
			NODE_ENV: "production",
			PORT: "3000",
			LOG_LEVEL: "info",
			// Secrets live only in Railway; never in source.
			BETTER_AUTH_SECRET: preserve(),
			BETTER_AUTH_URL: "https://fortuna.pdcd.net",
			AUTH_TRUSTED_ORIGINS: preserve(),
			OWNER_EMAIL: preserve(),
			OWNER_PASSWORD: preserve(),
			OWNER_NAME: preserve(),
			MCP_BEARER_TOKEN: preserve(),
		},
	});

	return project("fortuna", { resources: [db, files, app] });
});
