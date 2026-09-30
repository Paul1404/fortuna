import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { account, user } from "@/server/db/auth-schema";
import { userSettings } from "@/server/db/schema";
import { logger } from "@/server/logger";

// Sign-up is disabled, so the owner account is created here: by the migrator
// from OWNER_* env vars on deploy, and by the seed script in development.

export type EnsureOwnerResult = { userId: string; created: boolean };

export async function ensureOwner(input: {
	email: string;
	password: string;
	name: string;
}): Promise<EnsureOwnerResult> {
	const email = input.email.trim().toLowerCase();
	const existing = await db.query.user.findFirst({
		where: eq(user.email, email),
	});
	// better-auth's internal API hashes the password and writes user + account
	// through the same code path the sign-up endpoint would use.
	const ctx = await auth.$context;
	let userId = existing?.id;
	let created = false;
	if (!userId) {
		const row = await ctx.internalAdapter.createUser(
			{ email, name: input.name, emailVerified: true },
			{ method: "email-password" },
		);
		userId = row.id;
		created = true;
	}
	const credential = await db.query.account.findFirst({
		where: and(
			eq(account.userId, userId),
			eq(account.providerId, "credential"),
		),
	});
	if (credential) {
		await ensureSettings(userId);
		return { userId, created: false };
	}
	const hash = await ctx.password.hash(input.password);
	await ctx.internalAdapter.linkAccount({
		userId,
		providerId: "credential",
		accountId: userId,
		password: hash,
	});
	await ensureSettings(userId);
	logger.info("Owner account ready", {
		event: "owner.created",
		userId,
		created,
	});
	return { userId, created: true };
}

export async function ensureSettings(userId: string): Promise<void> {
	await db
		.insert(userSettings)
		.values({ userId })
		.onConflictDoNothing({ target: userSettings.userId });
}

export async function ensureOwnerFromEnv(): Promise<
	"disabled" | "created" | "unchanged"
> {
	const email = process.env.OWNER_EMAIL?.trim();
	const password = process.env.OWNER_PASSWORD;
	if (!email || !password) return "disabled";
	if (password.length < 12) {
		throw new Error("OWNER_PASSWORD must be at least 12 characters");
	}
	const result = await ensureOwner({
		email,
		password,
		name: process.env.OWNER_NAME?.trim() || "Owner",
	});
	return result.created ? "created" : "unchanged";
}
