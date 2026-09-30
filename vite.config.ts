import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const pkg = JSON.parse(
	readFileSync(
		fileURLToPath(new URL("./package.json", import.meta.url)),
		"utf8",
	),
) as { version: string };

export default defineConfig({
	resolve: { tsconfigPaths: true },
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	plugins: [nitro(), tailwindcss(), tanstackStart(), viteReact()],
});
