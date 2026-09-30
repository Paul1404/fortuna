import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { resolveTrustedOrigins } from "./auth-origins";
import { db } from "./db";
import * as authSchema from "./db/auth-schema";

// Private single-user deployment. Real accounts and sessions via better-auth,
// but open sign-up is disabled: the owner account is created by the migrator
// from OWNER_EMAIL / OWNER_PASSWORD (or by `bun run db:seed` in development).
// `tanstackStartCookies()` must stay the last plugin so Set-Cookie headers are
// written correctly in TanStack Start.

function requireSecret(): string {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters");
	}
	return secret;
}

export const auth = betterAuth({
	appName: "Fortuna",
	baseURL: process.env.BETTER_AUTH_URL || undefined,
	secret: requireSecret(),
	trustedOrigins: resolveTrustedOrigins(
		process.env.BETTER_AUTH_URL,
		process.env.AUTH_TRUSTED_ORIGINS,
	),
	database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		minPasswordLength: 12,
		maxPasswordLength: 256,
	},
	session: {
		expiresIn: 60 * 60 * 24 * 14,
		updateAge: 60 * 60 * 24,
		cookieCache: { enabled: false },
	},
	advanced: {
		cookiePrefix: "fortuna",
		useSecureCookies: process.env.NODE_ENV === "production",
	},
	rateLimit: {
		enabled: true,
		window: 60,
		max: 30,
		customRules: {
			"/sign-in/email": { window: 60, max: 8 },
		},
	},
	plugins: [tanstackStartCookies()],
});

export type Session = typeof auth.$Infer.Session;
