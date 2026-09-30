# syntax=docker/dockerfile:1

# 1. builder: install all deps and build the Nitro server output (.output/)
FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# 2. prod-deps: production-only node_modules for the migrator and runtime.
FROM oven/bun:1.4.2-debian AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 3. runner: glibc is required by Scalable's signed official Linux CLI.
FROM oven/bun:1.4.2-debian AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
	poppler-utils ca-certificates curl minisign && rm -rf /var/lib/apt/lists/*

# Pin the official v1.1.0 binary and verify Scalable's signed checksum manifest.
ARG TARGETARCH=amd64
RUN set -eu; \
	case "$TARGETARCH" in \
		amd64) sc_arch=x86_64; expected=64aa3b566f52dab82abdb44c9f6c0a82628fbb392aff1450c84894908639acb8 ;; \
		arm64) sc_arch=aarch64; expected=9e04c6f608bb1ac0ce4fa063f1971dece7a37842cbf1a6a231f497721298a4f8 ;; \
		*) exit 1 ;; \
	esac; \
	asset="sc-v1.1.0-linux-${sc_arch}-gnu.tar.gz"; \
	base='https://github.com/ScalableCapital/scalable-cli/releases/download/v1.1.0'; \
	curl -fsSL --retry 3 "$base/sc-v1.1.0-SHA256SUMS" -o /tmp/sc-SHA256SUMS; \
	curl -fsSL --retry 3 "$base/sc-v1.1.0-SHA256SUMS.minisig" -o /tmp/sc-SHA256SUMS.minisig; \
	minisign -V -P 'RWRKuuSASIzbSYpuU5gdXeTkXirJBl5+XVXLP6E60hBUUKZ5HPIGjV8b' \
		-m /tmp/sc-SHA256SUMS -x /tmp/sc-SHA256SUMS.minisig; \
	curl -fsSL --retry 3 "$base/$asset" -o "/tmp/$asset"; \
	cd /tmp; \
	grep -F "  $asset" sc-SHA256SUMS | sha256sum -c -; \
	echo "$expected  $asset" | sha256sum -c -; \
	tar -xzf "$asset" -C /usr/local/bin --strip-components=1 "sc-v1.1.0-linux-${sc_arch}-gnu/sc"; \
	chmod 0755 /usr/local/bin/sc; \
	/usr/local/bin/sc --version; \
	rm /tmp/sc-SHA256SUMS /tmp/sc-SHA256SUMS.minisig "/tmp/$asset"
ENV NODE_ENV=production \
	PORT=3000

COPY --chown=bun:bun --from=prod-deps /app/node_modules ./node_modules
COPY --chown=bun:bun --from=builder /app/.output ./.output
COPY --chown=bun:bun --from=builder /app/drizzle ./drizzle
COPY --chown=bun:bun --from=builder /app/src ./src
COPY --chown=bun:bun --from=builder /app/scripts ./scripts
COPY --chown=bun:bun --from=builder /app/package.json ./package.json
COPY --chown=bun:bun --from=builder /app/tsconfig.json ./tsconfig.json

USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
