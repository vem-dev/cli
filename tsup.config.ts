import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	clean: true,
	noExternal: ["@vem/core", "@vem/schemas"],
	external: ["fs-extra", "graceful-fs", "pino", "find-up-simple"],
	minify: false,
	sourcemap: true,
	target: "node20",
	shims: false,
	define: {
		__VERSION__: JSON.stringify(pkg.version),
	},
	env: {
		VEM_API_URL: process.env.VEM_API_URL || "http://localhost:3002",
		VEM_WEB_URL: process.env.VEM_WEB_URL || "http://localhost:3000",
	},
});
