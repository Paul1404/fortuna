import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function ChangePasswordForm() {
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	return (
		<form
			className="grid gap-3 sm:grid-cols-3"
			onSubmit={(e) => {
				e.preventDefault();
				const form = e.currentTarget;
				const data = new FormData(form);
				const current = String(data.get("current") ?? "");
				const next = String(data.get("next") ?? "");
				const confirm = String(data.get("confirm") ?? "");
				setError(null);
				if (next.length < 12)
					return setError("Das neue Passwort muss mindestens 12 Zeichen haben");
				if (next !== confirm)
					return setError("Die Passwörter stimmen nicht überein");
				start(async () => {
					const result = await authClient.changePassword({
						currentPassword: current,
						newPassword: next,
						revokeOtherSessions: true,
					});
					if (result.error) {
						setError(
							result.error.message ?? "Passwort konnte nicht geändert werden",
						);
						return;
					}
					form.reset();
					toast.success(
						"Passwort geändert; andere Sitzungen wurden abgemeldet",
					);
				});
			}}
		>
			<Field label="Aktuelles Passwort" htmlFor="pw-current">
				<Input
					id="pw-current"
					name="current"
					type="password"
					autoComplete="current-password"
					required
				/>
			</Field>
			<Field
				label="Neues Passwort"
				htmlFor="pw-next"
				hint="Mindestens 12 Zeichen."
			>
				<Input
					id="pw-next"
					name="next"
					type="password"
					autoComplete="new-password"
					required
					minLength={12}
				/>
			</Field>
			<Field
				label="Neues Passwort wiederholen"
				htmlFor="pw-confirm"
				error={error}
			>
				<Input
					id="pw-confirm"
					name="confirm"
					type="password"
					autoComplete="new-password"
					required
					minLength={12}
				/>
			</Field>
			<div className="sm:col-span-3">
				<Button type="submit" disabled={pending}>
					Passwort ändern
				</Button>
			</div>
		</form>
	);
}
