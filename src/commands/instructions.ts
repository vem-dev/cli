// apps/cli/src/commands/instructions.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	ConfigService,
	ConstitutionService,
	KNOWN_AGENT_INSTRUCTION_FILES,
} from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import prompts from "prompts";

import {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	trackCommandUsage,
} from "../runtime.js";

type InstructionEntry = { path: string; content: string };

async function getRepoRoot(): Promise<string> {
	const { execSync } = await import("node:child_process");
	try {
		return execSync("git rev-parse --show-toplevel", {
			encoding: "utf-8",
		}).trim();
	} catch {
		return process.cwd();
	}
}

async function readLocalInstructions(): Promise<InstructionEntry[]> {
	const repoRoot = await getRepoRoot();
	const result: InstructionEntry[] = [];
	for (const relativePath of KNOWN_AGENT_INSTRUCTION_FILES) {
		const absPath = path.join(repoRoot, relativePath);
		try {
			const content = await fs.readFile(absPath, "utf-8");
			result.push({ path: relativePath, content });
		} catch {
			// file doesn't exist locally
		}
	}
	return result;
}

export function registerInstructionCommands(program: Command) {
	const instructionsCmd = program
		.command("instructions")
		.alias("instr")
		.description("Manage and sync agent instruction files");

	instructionsCmd
		.command("pull")
		.description(
			"Pull the latest instructions from the cloud and write them to local files",
		)
		.option("-f, --force", "Overwrite local files without prompt")
		.action(async (options: { force?: boolean }) => {
			await trackCommandUsage("instructions.pull");
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();
				if (!projectId) {
					console.error(
						chalk.red(
							"Error: No project linked. Run `vem link <projectId>` first.",
						),
					);
					process.exitCode = 1;
					return;
				}

				console.log(chalk.blue("⬇  Fetching instructions from cloud..."));
				const res = await fetch(
					`${API_URL}/projects/${projectId}/instructions`,
					{
						headers: {
							Authorization: `Bearer ${key}`,
							...(await buildDeviceHeaders(configService)),
						},
					},
				);

				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(
						`API Error ${res.status}: ${data.error || res.statusText}`,
					);
				}

				const data = (await res.json()) as {
					instructions: InstructionEntry[];
					known_files: string[];
				};

				const instructions = data.instructions ?? [];
				if (instructions.length === 0) {
					console.log(
						chalk.yellow("No instructions configured for this project."),
					);
					return;
				}

				const repoRoot = await getRepoRoot();
				let written = 0;
				let skipped = 0;
				for (const entry of instructions) {
					if (
						typeof entry.path !== "string" ||
						typeof entry.content !== "string"
					)
						continue;
					if (!entry.content.trim()) continue;

					const dest = path.resolve(repoRoot, entry.path);
					const resolvedRoot = path.resolve(repoRoot);
					if (
						!dest.startsWith(`${resolvedRoot}${path.sep}`) &&
						dest !== resolvedRoot
					) {
						console.warn(chalk.yellow(`Skipping unsafe path: ${entry.path}`));
						continue;
					}

					if (!options.force) {
						const fileExists = await fs
							.access(dest)
							.then(() => true)
							.catch(() => false);
						if (fileExists) {
							const { overwrite } = await prompts({
								type: "confirm",
								name: "overwrite",
								message: `File ${entry.path} (${dest}) already exists. Overwrite?`,
								initial: false,
							});
							if (!overwrite) {
								console.log(chalk.yellow(`  ⊘ Skipped ${entry.path}`));
								skipped++;
								continue;
							}
						}
					}

					await fs.mkdir(path.dirname(dest), { recursive: true });
					await fs.writeFile(dest, entry.content, "utf-8");
					console.log(chalk.green(`  ✔ ${entry.path}`));
					written++;
				}

				const skippedMsg = skipped > 0 ? `, ${skipped} skipped` : "";
				console.log(
					chalk.green(
						`\n✔ Pulled ${written} instruction file(s)${skippedMsg}.\n`,
					),
				);
			} catch (error) {
				console.error(
					chalk.red("\n✖ Instructions pull failed:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	instructionsCmd
		.command("push")
		.description("Push local instruction files to the cloud")
		.option("-m, --message <msg>", "Commit message for this version")
		.action(async (options: { message?: string }) => {
			await trackCommandUsage("instructions.push");
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();
				if (!projectId) {
					console.error(
						chalk.red(
							"Error: No project linked. Run `vem link <projectId>` first.",
						),
					);
					process.exitCode = 1;
					return;
				}

				const localInstructions = await readLocalInstructions();
				if (localInstructions.length === 0) {
					console.log(
						chalk.yellow("No instruction files found locally. Looked for:"),
					);
					for (const f of KNOWN_AGENT_INSTRUCTION_FILES) {
						console.log(chalk.gray(`  ${f}`));
					}
					return;
				}

				console.log(
					chalk.blue(
						`⬆  Pushing ${localInstructions.length} instruction file(s)...`,
					),
				);

				const res = await fetch(
					`${API_URL}/projects/${projectId}/instructions`,
					{
						method: "PUT",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${key}`,
							...(await buildDeviceHeaders(configService)),
						},
						body: JSON.stringify({
							instructions: localInstructions,
							commit_message: options.message,
						}),
					},
				);

				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(
						`API Error ${res.status}: ${data.error || res.statusText}`,
					);
				}

				const data = (await res.json()) as {
					version_number?: number;
					instructions: InstructionEntry[];
				};

				for (const entry of localInstructions) {
					console.log(chalk.green(`  ✔ ${entry.path}`));
				}
				const versionNote = data.version_number
					? ` (saved as v${data.version_number})`
					: "";
				console.log(chalk.green(`\n✔ Instructions pushed${versionNote}.\n`));
			} catch (error) {
				console.error(
					chalk.red("\n✖ Instructions push failed:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	instructionsCmd
		.command("status")
		.description("Check if local instruction files are in sync with the cloud")
		.action(async () => {
			await trackCommandUsage("instructions.status");
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();
				if (!projectId) {
					console.error(
						chalk.red(
							"Error: No project linked. Run `vem link <projectId>` first.",
						),
					);
					process.exitCode = 1;
					return;
				}

				const [localInstructions, cloudRes] = await Promise.all([
					readLocalInstructions(),
					fetch(`${API_URL}/projects/${projectId}/instructions`, {
						headers: {
							Authorization: `Bearer ${key}`,
							...(await buildDeviceHeaders(configService)),
						},
					}),
				]);

				if (!cloudRes.ok) {
					const data = (await cloudRes.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(
						`API Error ${cloudRes.status}: ${data.error || cloudRes.statusText}`,
					);
				}

				const cloudData = (await cloudRes.json()) as {
					instructions: InstructionEntry[];
				};
				const cloudInstructions = cloudData.instructions ?? [];

				const localMap = new Map(
					localInstructions.map((e) => [e.path, e.content]),
				);
				const cloudMap = new Map(
					cloudInstructions.map((e) => [e.path, e.content]),
				);

				const allPaths = new Set([...localMap.keys(), ...cloudMap.keys()]);

				let inSync = true;
				console.log(chalk.bold("\nInstruction file sync status:\n"));
				for (const filePath of [...allPaths].sort()) {
					const local = localMap.get(filePath);
					const cloud = cloudMap.get(filePath);
					if (local === undefined) {
						console.log(
							chalk.yellow(`  ↓ ${filePath}`) +
								chalk.gray(" (cloud only — run `vem instructions pull`)"),
						);
						inSync = false;
					} else if (cloud === undefined) {
						console.log(
							chalk.cyan(`  ↑ ${filePath}`) +
								chalk.gray(" (local only — run `vem instructions push`)"),
						);
						inSync = false;
					} else if (local !== cloud) {
						console.log(
							chalk.magenta(`  ≠ ${filePath}`) +
								chalk.gray(" (differs — run pull or push to sync)"),
						);
						inSync = false;
					} else {
						console.log(
							chalk.green(`  ✔ ${filePath}`) + chalk.gray(" (in sync)"),
						);
					}
				}

				if (allPaths.size === 0) {
					console.log(chalk.gray("  No instructions configured."));
				}

				console.log(
					inSync
						? chalk.green("\n✔ All instruction files are in sync.\n")
						: chalk.yellow("\n⚠ Some instruction files are out of sync.\n"),
				);
			} catch (error) {
				console.error(
					chalk.red("\n✖ Instructions status check failed:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	instructionsCmd
		.command("versions")
		.description("List instruction version history from the cloud")
		.option("-n, --limit <n>", "Maximum number of versions to show", "20")
		.action(async (options: { limit?: string }) => {
			await trackCommandUsage("instructions.versions");
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();
				if (!projectId) {
					console.error(
						chalk.red(
							"Error: No project linked. Run `vem link <projectId>` first.",
						),
					);
					process.exitCode = 1;
					return;
				}

				const limit = Math.min(
					100,
					Math.max(1, Number.parseInt(options.limit ?? "20", 10) || 20),
				);
				const res = await fetch(
					`${API_URL}/projects/${projectId}/instructions/versions?limit=${limit}`,
					{
						headers: {
							Authorization: `Bearer ${key}`,
							...(await buildDeviceHeaders(configService)),
						},
					},
				);

				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(
						`API Error ${res.status}: ${data.error || res.statusText}`,
					);
				}

				const data = (await res.json()) as {
					versions: Array<{
						id: string;
						version_number: number;
						commit_message: string | null;
						author: string | null;
						created_at: string;
					}>;
				};

				const versions = data.versions ?? [];
				if (versions.length === 0) {
					console.log(chalk.yellow("No instruction versions found."));
					return;
				}

				console.log(chalk.bold("\nInstruction Version History:\n"));
				for (const [index, version] of versions.entries()) {
					const isLatest = index === 0;
					const date = new Date(version.created_at).toLocaleString();
					const tag = isLatest ? chalk.green(" [current]") : "";
					const msg = version.commit_message
						? chalk.gray(` — ${version.commit_message}`)
						: "";
					const author = version.author
						? chalk.gray(` by ${version.author}`)
						: "";
					console.log(
						`  ${chalk.bold(`v${version.version_number}`)}${tag}${msg}${author}`,
					);
					console.log(chalk.gray(`    ${date} · id: ${version.id}`));
				}
				console.log();
			} catch (error) {
				console.error(
					chalk.red("\n✖ Failed to fetch versions:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	instructionsCmd
		.command("revert <versionId>")
		.description("Revert instructions to a specific version by version ID")
		.action(async (versionId: string) => {
			await trackCommandUsage("instructions.revert");
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();
				if (!projectId) {
					console.error(
						chalk.red(
							"Error: No project linked. Run `vem link <projectId>` first.",
						),
					);
					process.exitCode = 1;
					return;
				}

				console.log(
					chalk.blue(`⟲  Reverting instructions to version ${versionId}...`),
				);

				const res = await fetch(
					`${API_URL}/projects/${projectId}/instructions/versions/${versionId}/revert`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${key}`,
							...(await buildDeviceHeaders(configService)),
						},
					},
				);

				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(
						`API Error ${res.status}: ${data.error || res.statusText}`,
					);
				}

				const data = (await res.json()) as {
					version_number: number;
					reverted_from: number;
					instructions: InstructionEntry[];
				};

				console.log(
					chalk.green(
						`✔ Reverted to v${data.reverted_from} (new version: v${data.version_number})`,
					),
				);
				console.log(
					chalk.gray("  Run `vem instructions pull` to update local files."),
				);
			} catch (error) {
				console.error(
					chalk.red("\n✖ Revert failed:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	// ── vem constitution ──────────────────────────────────────────────────────
	const constitutionService = new ConstitutionService();
	const constitutionCmd = program
		.command("constitution")
		.description(
			"Manage the Agent Constitution — immutable principles for all AI agents",
		);

	constitutionCmd
		.command("show")
		.description("Print the current Agent Constitution")
		.action(async () => {
			await trackCommandUsage("constitution.show");
			const content = await constitutionService.get();
			if (!content) {
				console.log(
					chalk.yellow(
						"No constitution found. Run `vem constitution init` to create one.",
					),
				);
				return;
			}
			console.log(content);
		});

	constitutionCmd
		.command("init")
		.description("Create a default Agent Constitution in .vem/CONSTITUTION.md")
		.action(async () => {
			await trackCommandUsage("constitution.init");
			const created = await constitutionService.initDefault();
			if (created) {
				console.log(
					chalk.green(
						"✔ Created .vem/CONSTITUTION.md with default principles.",
					),
				);
				console.log(
					chalk.gray("  Edit it with `vem constitution edit` to customize."),
				);
			} else {
				console.log(
					chalk.yellow(
						"Constitution already exists. Use `vem constitution edit` to modify it.",
					),
				);
			}
		});

	constitutionCmd
		.command("edit")
		.description("Edit the Agent Constitution in your $EDITOR")
		.action(async () => {
			await trackCommandUsage("constitution.edit");
			const { execSync } = await import("node:child_process");
			const { getVemDir } = await import("@vem/core");
			const vemDir = await getVemDir();
			const constitutionPath = path.join(vemDir, "CONSTITUTION.md");

			// Ensure the file exists before opening
			const exists = await constitutionService.exists();
			if (!exists) {
				await constitutionService.initDefault();
				console.log(
					chalk.gray("Created default constitution — opening in editor..."),
				);
			}

			const editor = process.env.EDITOR ?? process.env.VISUAL ?? "nano";
			try {
				execSync(`${editor} "${constitutionPath}"`, { stdio: "inherit" });
				console.log(chalk.green("✔ Constitution updated."));
			} catch {
				console.log(
					chalk.yellow(
						`Could not open editor. Edit manually: ${constitutionPath}`,
					),
				);
			}
		});

	constitutionCmd
		.command("set")
		.description("Set the Agent Constitution from stdin")
		.option("--file <path>", "Read constitution from a file instead of stdin")
		.action(async (options: { file?: string }) => {
			await trackCommandUsage("constitution.set");
			let content: string;
			if (options.file) {
				content = await fs.readFile(options.file, "utf-8");
			} else {
				const chunks: Buffer[] = [];
				for await (const chunk of process.stdin) {
					chunks.push(chunk as Buffer);
				}
				content = Buffer.concat(chunks).toString("utf-8");
			}
			await constitutionService.set(content.trim());
			console.log(chalk.green("✔ Constitution updated."));
		});
}
