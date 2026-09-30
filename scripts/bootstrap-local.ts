import { pool } from "../src/server/db";
import { bootstrapLocalDatabase } from "../src/server/db/local-bootstrap";

bootstrapLocalDatabase(pool)
	.then((applied) => {
		console.info(
			`Local bootstrap complete: ${applied} migration files applied. Run db:migrate next to provision the owner.`,
		);
	})
	.catch(() => {
		console.error(
			"Local bootstrap failed. Verify the local target, database emptiness, and migration ledger. Production bootstrap is not allowed.",
		);
		process.exitCode = 1;
	})
	.finally(() => pool.end());
