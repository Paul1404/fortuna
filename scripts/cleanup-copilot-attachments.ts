import { sweepCopilotAttachments } from "../src/server/services/copilot-attachments";

try {
	const result = await sweepCopilotAttachments({ strict: true });
	console.info(
		`Copilot attachment cleanup: mode=${result.mode} checked=${result.checked} deleted=${result.deleted} deferred=${result.deferred}`,
	);
} catch (error) {
	console.error(
		error instanceof Error
			? error.message
			: "Copilot attachment cleanup failed",
	);
	process.exitCode = 1;
}
