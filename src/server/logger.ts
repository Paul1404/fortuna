// Structured server logger. One JSON line per event in production, a readable
// line in development. Sensitive keys and secret-shaped strings are redacted so
// a connection string or provider token in an error message never reaches logs.

import packageJson from "../../package.json";

type Level = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Record<Level, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};
const isProd = process.env.NODE_ENV === "production";

function threshold(): number {
	const configured = process.env.LOG_LEVEL?.toLowerCase() as Level | undefined;
	if (configured && configured in LEVEL_WEIGHT) return LEVEL_WEIGHT[configured];
	return isProd ? LEVEL_WEIGHT.info : LEVEL_WEIGHT.debug;
}

const REDACT_KEY =
	/pass|secret|token|cookie|authorization|credential|connection.?string|database.?url|private.?key|api.?key|iban/i;

const SECRET_IN_TEXT: Array<[RegExp, string]> = [
	[/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, "$1[redacted]@"],
	[
		/\b(pass\w*|secret\w*|token\w*|api[_-]?key|credential\w*)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
		"$1$2[redacted]",
	],
	// IBANs: keep country and check digits, drop the account part.
	[/\b([A-Z]{2}\d{2})[A-Z0-9]{11,30}\b/g, "$1[redacted]"],
];

export function redactText(value: string): string {
	let out = value;
	for (const [pattern, replacement] of SECRET_IN_TEXT) {
		out = out.replace(pattern, replacement);
	}
	return out;
}

function errorDetails(value: object, depth: number): LogContext | undefined {
	const err = value as { message?: unknown; stack?: unknown; cause?: unknown };
	const errorLike =
		value instanceof Error ||
		(typeof err.message === "string" && typeof err.stack === "string");
	if (!errorLike) return undefined;
	const details: LogContext = {};
	for (const key of ["name", "message", "stack", "code"] as const) {
		const item = (value as Record<string, unknown>)[key];
		if (typeof item === "string") details[key] = redactText(item);
		else if (typeof item === "number") details[key] = item;
	}
	if (err.cause !== undefined) {
		details.cause = serializeLogValue(err.cause, depth + 1);
	}
	return details;
}

export function serializeLogValue(value: unknown, depth = 0): unknown {
	if (depth > 3) return "[...]";
	if (value && typeof value === "object") {
		const details = errorDetails(value, depth);
		if (details) return details;
	}
	if (Array.isArray(value)) {
		return value.map((v) => serializeLogValue(v, depth + 1));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = REDACT_KEY.test(k)
				? "[redacted]"
				: serializeLogValue(v, depth + 1);
		}
		return out;
	}
	if (typeof value === "string") return redactText(value);
	return value;
}

const COLORS: Record<Level, string> = {
	debug: "\x1b[2;37m",
	info: "\x1b[36m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function emit(level: Level, msg: string, context?: LogContext): void {
	if (LEVEL_WEIGHT[level] < threshold()) return;
	const ctx = context ? (serializeLogValue(context) as LogContext) : undefined;
	const time = new Date().toISOString();
	if (isProd) {
		const line = JSON.stringify({ time, level, msg, ...ctx });
		if (level === "error" || level === "warn") console.error(line);
		else console.log(line);
		return;
	}
	const head = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
	const tail = ctx && Object.keys(ctx).length ? ` ${JSON.stringify(ctx)}` : "";
	const out = `${head} ${msg}${tail}`;
	if (level === "error" || level === "warn") console.error(out);
	else console.log(out);
}

export type Logger = {
	debug: (msg: string, context?: LogContext) => void;
	info: (msg: string, context?: LogContext) => void;
	warn: (msg: string, context?: LogContext) => void;
	error: (msg: string, context?: LogContext) => void;
	child: (bindings: LogContext) => Logger;
};

function make(base: LogContext): Logger {
	const merge = (c?: LogContext) => ({ ...base, ...c });
	return {
		debug: (m, c) => emit("debug", m, merge(c)),
		info: (m, c) => emit("info", m, merge(c)),
		warn: (m, c) => emit("warn", m, merge(c)),
		error: (m, c) => emit("error", m, merge(c)),
		child: (bindings) => make({ ...base, ...bindings }),
	};
}

export const logger = make({
	service: "fortuna",
	version: packageJson.version,
	environment: process.env.NODE_ENV ?? "development",
});
