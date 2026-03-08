import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getRepoRoot } from "@vem/core";
import chalk from "chalk";
import prompts from "prompts";

const VEM_PRE_PUSH_MARKER = "# vem pre-push hook";
const VEM_PRE_PUSH_VERSION_MARKER = "# vem-managed-hook:v2";

function getVemPrePushHookContent() {
	return `#!/bin/sh
${VEM_PRE_PUSH_MARKER}
${VEM_PRE_PUSH_VERSION_MARKER}
# Automatically run vem push when pushing code to the linked remote only.

REMOTE_NAME="$1"
REMOTE_URL="$2"

if ! command -v vem >/dev/null 2>&1; then
  echo "vem not found in PATH, skipping auto-push..."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
CONFIG_FILE="$REPO_ROOT/.vem/config.json"
LINKED_REMOTE_NAME=""
LINKED_REMOTE_URL=""

if [ -n "$REPO_ROOT" ] && [ -f "$CONFIG_FILE" ] && command -v node >/dev/null 2>&1; then
  LINKED_REMOTE_NAME="$(node -e 'try { const fs = require("fs"); const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (typeof c.linked_remote_name === "string") process.stdout.write(c.linked_remote_name); } catch {}' "$CONFIG_FILE")"
  LINKED_REMOTE_URL="$(node -e 'try { const fs = require("fs"); const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (typeof c.linked_remote_url === "string") process.stdout.write(c.linked_remote_url); } catch {}' "$CONFIG_FILE")"
fi

if [ -n "$LINKED_REMOTE_NAME" ] && [ "$REMOTE_NAME" != "$LINKED_REMOTE_NAME" ]; then
  echo "Skipping vem push for remote '$REMOTE_NAME' (linked: '$LINKED_REMOTE_NAME')."
  exit 0
fi

if [ -z "$LINKED_REMOTE_NAME" ] && [ -n "$LINKED_REMOTE_URL" ] && [ "$REMOTE_URL" != "$LINKED_REMOTE_URL" ]; then
  echo "Skipping vem push for remote '$REMOTE_NAME' (linked URL mismatch)."
  exit 0
fi

echo "Running vem push..."
vem push || echo "vem push failed, but continuing git push..."
`;
}

type InstallGitHookOptions = {
	promptIfMissing?: boolean;
	quiet?: boolean;
};

async function installGitHook(options: InstallGitHookOptions = {}) {
	const promptIfMissing = options.promptIfMissing ?? true;
	const quiet = options.quiet ?? false;

	try {
		const root = await getRepoRoot();
		const hooksDir = join(root, ".git", "hooks");
		const hookPath = join(hooksDir, "pre-push");

		// Ensure hooks directory exists
		if (!fs.existsSync(hooksDir)) {
			fs.mkdirSync(hooksDir, { recursive: true });
		}

		const hookContent = getVemPrePushHookContent();

		if (fs.existsSync(hookPath)) {
			const existingHook = fs.readFileSync(hookPath, "utf-8");
			if (existingHook.includes(VEM_PRE_PUSH_MARKER)) {
				await writeFile(hookPath, hookContent, { mode: 0o755 });
				if (!quiet) {
					console.log(chalk.green("✔ Git pre-push hook updated."));
				}
				return;
			}
			if (!quiet) {
				console.log(
					chalk.yellow(
						"\n⚠ A pre-push hook already exists. Skipping vem hook installation.",
					),
				);
			}
			return;
		}

		if (!promptIfMissing) {
			return;
		}

		const response = await prompts({
			type: "confirm",
			name: "install",
			message:
				"Do you want to install a git pre-push hook to auto-sync with vem?",
			initial: true,
		});

		if (!response.install) return;

		await writeFile(hookPath, hookContent, { mode: 0o755 });
		if (!quiet) {
			console.log(chalk.green("✔ Git pre-push hook installed."));
		}
	} catch (error) {
		if (!quiet) {
			console.log(chalk.yellow(`⚠ Failed to install git hook: ${error}`));
		}
	}
}

export { installGitHook };
