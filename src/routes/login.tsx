import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { FortunaMark } from "@/components/brand";
import { HeroPanel } from "@/components/hero-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { VersionChip } from "@/components/version-chip";
import { authClient } from "@/lib/auth-client";
import { sanitizeAuthRedirect } from "@/lib/redirect";
import { fetchSession } from "@/lib/server-fns";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { from?: string } => ({
		from: typeof search.from === "string" ? search.from : undefined,
	}),
	beforeLoad: async () => {
		const user = await fetchSession();
		if (user) throw redirect({ to: "/" });
	},
	head: () => ({ meta: [{ title: "Anmelden · Fortuna" }] }),
	component: LoginPage,
});

function LoginPage() {
	const { from } = Route.useSearch();
	const redirectTo = sanitizeAuthRedirect(from);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [show, setShow] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();

	function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		start(async () => {
			const result = await authClient.signIn.email({ email, password });
			if (result.error) {
				setError(
					result.error.status === 429
						? "Zu viele Versuche. Bitte eine Minute warten."
						: "E-Mail-Adresse oder Passwort ist falsch.",
				);
				return;
			}
			window.location.assign(redirectTo);
		});
	}

	return (
		<HeroPanel className="min-h-dvh rounded-none border-0">
			<main
				id="main-content"
				className="flex min-h-dvh flex-col items-center justify-center px-4 py-12"
			>
				<div className="w-full max-w-[360px]">
					<div className="flex flex-col items-center text-center">
						<FortunaMark
							size={44}
							className="text-glow drop-shadow-[0_0_18px_var(--fortuna-glow)]"
						/>
						<h1 className="mt-5 font-display text-[28px] font-normal tracking-[0.2em] uppercase">
							Fortuna
						</h1>
						<p className="mt-1 text-xs text-hero-muted">
							Private Finanzübersicht
						</p>
					</div>
					<form
						onSubmit={submit}
						className="mt-8 space-y-4 rounded-lg border border-hero-border bg-nav-raised/70 p-6 shadow-[0_24px_60px_-28px_rgba(4,9,31,0.9)] backdrop-blur-xl"
					>
						<Field label="E-Mail-Adresse" htmlFor="email">
							<Input
								id="email"
								type="email"
								autoComplete="username"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className="h-9"
							/>
						</Field>
						<Field label="Passwort" htmlFor="password" error={error}>
							<div className="relative">
								<Input
									id="password"
									type={show ? "text" : "password"}
									autoComplete="current-password"
									required
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									className="h-9 pr-9"
									aria-invalid={error ? true : undefined}
								/>
								<button
									type="button"
									onClick={() => setShow((s) => !s)}
									aria-label={
										show ? "Passwort ausblenden" : "Passwort anzeigen"
									}
									aria-pressed={show}
									className="absolute inset-y-0 right-0 flex items-center px-2.5 text-text-muted hover:text-text"
								>
									{show ? (
										<EyeOff className="size-4" />
									) : (
										<Eye className="size-4" />
									)}
								</button>
							</div>
						</Field>
						<Button
							type="submit"
							size="lg"
							className="w-full"
							disabled={pending || !email || !password}
						>
							{pending ? <Loader2 className="size-4 animate-spin" /> : null}
							Anmelden
						</Button>
					</form>
					<div className="mt-6 flex items-center justify-center gap-3">
						<VersionChip />
						<ThemeToggle />
					</div>
					<div className="mt-4 flex justify-center gap-4 text-[11px] text-hero-muted">
						<Link
							to="/privacy"
							className="hover:text-hero-text hover:underline"
						>
							Datenschutz
						</Link>
						<Link to="/terms" className="hover:text-hero-text hover:underline">
							Nutzungsbedingungen
						</Link>
					</div>
				</div>
			</main>
		</HeroPanel>
	);
}
