// apps/cli/src/commands/skills.ts
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ConfigService } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import prompts from "prompts";

import {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	trackCommandUsage,
} from "../runtime.js";

const SKILLS_LOCK_FILE = "skills-lock.json";

type SkillsLock = {
	version: number;
	skills: Record<
		string,
		{
			source: string;
			sourceType: string;
			skillPath: string;
			computedHash?: string;
		}
	>;
};

type SkillFile = { path: string; content: string };

async function getRepoRoot(): Promise<string> {
	try {
		return execSync("git rev-parse --show-toplevel", {
			encoding: "utf-8",
		}).trim();
	} catch {
		return process.cwd();
	}
}

async function readSkillsLock(repoRoot: string): Promise<SkillsLock | null> {
	const lockPath = path.join(repoRoot, SKILLS_LOCK_FILE);
	try {
		const raw = await fs.readFile(lockPath, "utf-8");
		return JSON.parse(raw) as SkillsLock;
	} catch {
		return null;
	}
}

/**
 * Resolve the local installation path for a skill.
 * `npx skills@latest` installs files under `.agents/skills/<name>/`, but
 * `skills-lock.json` records `skillPath` as the path inside the upstream
 * GitHub repo (e.g. `skills/productivity/caveman/SKILL.md`). We prefer the
 * local `.agents/` location and fall back to `skillPath` for older setups.
 */
async function resolveSkillLocalPath(
	repoRoot: string,
	skillName: string,
	skillPath: string,
): Promise<string | null> {
	const agentsPath = path.join(
		repoRoot,
		".agents",
		"skills",
		skillName,
		"SKILL.md",
	);
	try {
		await fs.access(agentsPath);
		return agentsPath;
	} catch {
		// not installed under .agents/ — try the recorded skillPath
	}
	const legacyPath = path.join(repoRoot, skillPath);
	try {
		await fs.access(legacyPath);
		return legacyPath;
	} catch {
		return null;
	}
}

async function collectSkillFiles(
	repoRoot: string,
	skillsLock: SkillsLock,
): Promise<SkillFile[]> {
	const files: SkillFile[] = [];
	for (const [name, skill] of Object.entries(skillsLock.skills ?? {})) {
		const absPath = await resolveSkillLocalPath(
			repoRoot,
			name,
			skill.skillPath,
		);
		if (!absPath) continue;
		try {
			const content = await fs.readFile(absPath, "utf-8");
			// Always store the path relative to the repo root so the cloud API
			// records the actual local path, not the upstream GitHub source path.
			const relPath = path.relative(repoRoot, absPath);
			files.push({ path: relPath, content });
		} catch {
			// file may not exist if skill was removed externally
		}
	}
	return files;
}

function runSkillsCmd(args: string[]): boolean {
	const result = spawnSync("npx", ["skills@latest", ...args], {
		stdio: "inherit",
		shell: true,
	});
	return result.status === 0;
}

async function promptPushToCloud(): Promise<boolean> {
	const { push } = await prompts({
		type: "confirm",
		name: "push",
		message: "Push skills to vem cloud?",
		initial: true,
	});
	return push === true;
}

export function registerSkillsCommands(program: Command) {
	const skillsCmd = program
		.command("skills")
		.description("Manage agent skills for this project");

	// ── vem skills add ────────────────────────────────────────────────────────
	skillsCmd
		.command("add <source>")
		.description("Install skills from a GitHub source (e.g. mattpocock/skills)")
		.option("--no-push", "Skip the prompt to push skills to vem cloud")
		.action(async (source: string, options: { push?: boolean }) => {
			await trackCommandUsage("skills.add");
			console.log(chalk.blue(`⬇  Installing skills from ${source}...`));

			const ok = runSkillsCmd(["add", source]);
			if (!ok) {
				console.error(chalk.red("\n✖ skills install failed."));
				process.exitCode = 1;
				return;
			}

			console.log(chalk.green(`\n✔ Skills from ${source} installed.\n`));

			if (options.push !== false) {
				const shouldPush = await promptPushToCloud();
				if (shouldPush) {
					await pushSkillsToCloud();
				}
			}
		});

	// ── vem skills list ───────────────────────────────────────────────────────
	skillsCmd
		.command("list")
		.description("List installed skills from skills-lock.json")
		.action(async () => {
			await trackCommandUsage("skills.list");
			const repoRoot = await getRepoRoot();
			const lock = await readSkillsLock(repoRoot);

			if (!lock || Object.keys(lock.skills ?? {}).length === 0) {
				console.log(
					chalk.yellow(
						"No skills installed. Run `vem skills add <source>` to get started.",
					),
				);
				return;
			}

			console.log(chalk.bold("\nInstalled Skills:\n"));
			for (const [name, skill] of Object.entries(lock.skills)) {
				console.log(
					`  ${chalk.cyan(name)} ${chalk.gray(`← ${skill.source} · ${skill.skillPath}`)}`,
				);
			}
			console.log(
				chalk.gray(
					`\n  ${Object.keys(lock.skills).length} skill(s) total · skills-lock.json v${lock.version}\n`,
				),
			);
		});

	// ── vem skills remove ─────────────────────────────────────────────────────
	skillsCmd
		.command("remove <skill>")
		.description("Remove an installed skill")
		.option("--no-push", "Skip the prompt to push skills to vem cloud")
		.action(async (skill: string, options: { push?: boolean }) => {
			await trackCommandUsage("skills.remove");
			console.log(chalk.blue(`🗑  Removing skill ${skill}...`));

			const ok = runSkillsCmd(["remove", skill]);
			if (!ok) {
				console.error(chalk.red("\n✖ skills remove failed."));
				process.exitCode = 1;
				return;
			}

			console.log(chalk.green(`\n✔ Skill ${skill} removed.\n`));

			if (options.push !== false) {
				const shouldPush = await promptPushToCloud();
				if (shouldPush) {
					await pushSkillsToCloud();
				}
			}
		});

	// ── vem skills update ─────────────────────────────────────────────────────
	skillsCmd
		.command("update [source]")
		.description("Update installed skills (all or a specific source)")
		.option("--no-push", "Skip the prompt to push skills to vem cloud")
		.action(async (source: string | undefined, options: { push?: boolean }) => {
			await trackCommandUsage("skills.update");
			const args = source ? ["update", source] : ["update"];
			console.log(
				chalk.blue(
					source
						? `⟳  Updating skills from ${source}...`
						: "⟳  Updating all installed skills...",
				),
			);

			const ok = runSkillsCmd(args);
			if (!ok) {
				console.error(chalk.red("\n✖ skills update failed."));
				process.exitCode = 1;
				return;
			}

			console.log(chalk.green("\n✔ Skills updated.\n"));

			if (options.push !== false) {
				const shouldPush = await promptPushToCloud();
				if (shouldPush) {
					await pushSkillsToCloud();
				}
			}
		});

	// ── vem skills push ───────────────────────────────────────────────────────
	skillsCmd
		.command("push")
		.description("Push local skills to the vem cloud")
		.option("-m, --message <msg>", "Commit message for this version")
		.action(async (options: { message?: string }) => {
			await trackCommandUsage("skills.push");
			await pushSkillsToCloud(options.message);
		});

	// ── vem skills pull ───────────────────────────────────────────────────────
	skillsCmd
		.command("pull")
		.description("Pull skills from the vem cloud and write them to disk")
		.option("-f, --force", "Overwrite local files without prompting")
		.action(async (options: { force?: boolean }) => {
			await trackCommandUsage("skills.pull");
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

				console.log(chalk.blue("⬇  Fetching skills from cloud..."));
				const res = await fetch(`${API_URL}/projects/${projectId}/skills`, {
					headers: {
						Authorization: `Bearer ${key}`,
						...(await buildDeviceHeaders(configService)),
					},
				});

				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(
						`API Error ${res.status}: ${data.error || res.statusText}`,
					);
				}

				const data = (await res.json()) as {
					skills_lock: SkillsLock;
					skill_files: SkillFile[];
					version_number: number | null;
				};

				if (!data.version_number) {
					console.log(
						chalk.yellow("No skills snapshot in cloud. Nothing to pull."),
					);
					return;
				}

				const repoRoot = await getRepoRoot();

				// Write skills-lock.json
				const lockDest = path.join(repoRoot, SKILLS_LOCK_FILE);
				const lockExists = await fs
					.access(lockDest)
					.then(() => true)
					.catch(() => false);

				if (lockExists && !options.force) {
					const { overwrite } = await prompts({
						type: "confirm",
						name: "overwrite",
						message: `${SKILLS_LOCK_FILE} already exists. Overwrite?`,
						initial: false,
					});
					if (!overwrite) {
						console.log(chalk.yellow(`  ⊘ Skipped ${SKILLS_LOCK_FILE}`));
					} else {
						await fs.writeFile(
							lockDest,
							JSON.stringify(data.skills_lock, null, 2),
							"utf-8",
						);
						console.log(chalk.green(`  ✔ ${SKILLS_LOCK_FILE}`));
					}
				} else {
					await fs.writeFile(
						lockDest,
						JSON.stringify(data.skills_lock, null, 2),
						"utf-8",
					);
					console.log(chalk.green(`  ✔ ${SKILLS_LOCK_FILE}`));
				}

				// Write skill files
				let written = 0;
				let skipped = 0;

				// Build a map from skillPath (GitHub source path) → skill name so we
				// can remap legacy cloud entries (stored before the path-fix) to the
				// correct local `.agents/skills/<name>/SKILL.md` location.
				const skillPathToName = new Map<string, string>();
				for (const [name, skill] of Object.entries(
					data.skills_lock?.skills ?? {},
				)) {
					skillPathToName.set(skill.skillPath, name);
				}

				for (const entry of data.skill_files ?? []) {
					if (
						typeof entry.path !== "string" ||
						typeof entry.content !== "string"
					)
						continue;
					if (!entry.content.trim()) continue;

					// Remap legacy GitHub source paths to the local .agents/ convention.
					// New pushes already store `.agents/skills/<name>/SKILL.md`; old
					// entries have the upstream path like `skills/productivity/caveman/SKILL.md`.
					let localRelPath = entry.path;
					if (!entry.path.startsWith(".agents/skills/")) {
						const skillName = skillPathToName.get(entry.path);
						if (skillName) {
							localRelPath = path.join(
								".agents",
								"skills",
								skillName,
								"SKILL.md",
							);
						}
					}

					const dest = path.resolve(repoRoot, localRelPath);
					const resolvedRoot = path.resolve(repoRoot);
					if (
						!dest.startsWith(`${resolvedRoot}${path.sep}`) &&
						dest !== resolvedRoot
					) {
						console.warn(chalk.yellow(`Skipping unsafe path: ${localRelPath}`));
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
								message: `File ${localRelPath} already exists. Overwrite?`,
								initial: false,
							});
							if (!overwrite) {
								console.log(chalk.yellow(`  ⊘ Skipped ${localRelPath}`));
								skipped++;
								continue;
							}
						}
					}

					await fs.mkdir(path.dirname(dest), { recursive: true });
					await fs.writeFile(dest, entry.content, "utf-8");
					console.log(chalk.green(`  ✔ ${localRelPath}`));
					written++;
				}

				const skippedMsg = skipped > 0 ? `, ${skipped} skipped` : "";
				console.log(
					chalk.green(
						`\n✔ Pulled v${data.version_number}: ${written} skill file(s)${skippedMsg}.\n`,
					),
				);
			} catch (error) {
				console.error(
					chalk.red("\n✖ Skills pull failed:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	// ── vem skills status ─────────────────────────────────────────────────────
	skillsCmd
		.command("status")
		.description("Compare local skills with the vem cloud snapshot")
		.action(async () => {
			await trackCommandUsage("skills.status");
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

				const repoRoot = await getRepoRoot();
				const [localLock, cloudRes] = await Promise.all([
					readSkillsLock(repoRoot),
					fetch(`${API_URL}/projects/${projectId}/skills`, {
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
					skills_lock: SkillsLock;
					version_number: number | null;
				};

				const localSkills = Object.keys(localLock?.skills ?? {});
				const cloudSkills = Object.keys(cloudData.skills_lock?.skills ?? {});

				const allSkills = new Set([...localSkills, ...cloudSkills]);

				console.log(chalk.bold("\nSkills sync status:\n"));

				if (allSkills.size === 0) {
					console.log(chalk.gray("  No skills installed or in cloud."));
				} else {
					let inSync = true;
					for (const skill of [...allSkills].sort()) {
						const isLocal = localSkills.includes(skill);
						const isCloud = cloudSkills.includes(skill);
						if (isLocal && !isCloud) {
							console.log(
								chalk.cyan(`  ↑ ${skill}`) +
									chalk.gray(" (local only — run `vem skills push`)"),
							);
							inSync = false;
						} else if (!isLocal && isCloud) {
							console.log(
								chalk.yellow(`  ↓ ${skill}`) +
									chalk.gray(" (cloud only — run `vem skills pull`)"),
							);
							inSync = false;
						} else {
							console.log(
								chalk.green(`  ✔ ${skill}`) + chalk.gray(" (in sync)"),
							);
						}
					}

					const cloudVersionNote = cloudData.version_number
						? chalk.gray(` · cloud v${cloudData.version_number}`)
						: chalk.gray(" · no cloud snapshot");
					console.log(
						inSync
							? chalk.green(`\n✔ Skills are in sync.${cloudVersionNote}\n`)
							: chalk.yellow(
									`\n⚠ Skills are out of sync.${cloudVersionNote}\n`,
								),
					);
				}
			} catch (error) {
				console.error(
					chalk.red("\n✖ Skills status check failed:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});

	// ── vem skills versions ───────────────────────────────────────────────────
	skillsCmd
		.command("versions")
		.description("List skills version history from the cloud")
		.option("-n, --limit <n>", "Maximum number of versions to show", "20")
		.action(async (options: { limit?: string }) => {
			await trackCommandUsage("skills.versions");
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
					`${API_URL}/projects/${projectId}/skills/versions?limit=${limit}`,
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
					console.log(chalk.yellow("No skills versions found in cloud."));
					return;
				}

				console.log(chalk.bold("\nSkills Version History:\n"));
				for (const [index, version] of versions.entries()) {
					const isLatest = index === 0;
					const date = new Date(version.created_at).toLocaleString();
					const tag = isLatest ? chalk.green(" [current]") : "";
					const msg = version.commit_message
						? chalk.gray(` — ${version.commit_message}`)
						: "";
					console.log(
						`  ${chalk.bold(`v${version.version_number}`)}${tag}${msg}`,
					);
					console.log(chalk.gray(`    ${date} · id: ${version.id}`));
				}
				console.log();
			} catch (error) {
				console.error(
					chalk.red("\n✖ Failed to fetch skills versions:"),
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
		});
}

async function pushSkillsToCloud(commitMessage?: string): Promise<void> {
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

		const repoRoot = await getRepoRoot();
		const lock = await readSkillsLock(repoRoot);
		if (!lock || Object.keys(lock.skills ?? {}).length === 0) {
			console.log(
				chalk.yellow(
					"No skills found in skills-lock.json. Install some with `vem skills add <source>`.",
				),
			);
			return;
		}

		const skillFiles = await collectSkillFiles(repoRoot, lock);
		console.log(
			chalk.blue(
				`⬆  Pushing ${Object.keys(lock.skills).length} skill(s) (${skillFiles.length} file(s))...`,
			),
		);

		const res = await fetch(`${API_URL}/projects/${projectId}/skills`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`,
				...(await buildDeviceHeaders(configService)),
			},
			body: JSON.stringify({
				skills_lock: lock,
				skill_files: skillFiles,
				commit_message: commitMessage,
			}),
		});

		if (!res.ok) {
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(
				`API Error ${res.status}: ${data.error || res.statusText}`,
			);
		}

		const data = (await res.json()) as {
			version_number: number;
			skill_count: number;
		};

		console.log(
			chalk.green(
				`\n✔ Skills pushed (v${data.version_number}, ${data.skill_count} skill(s)).\n`,
			),
		);
	} catch (error) {
		console.error(
			chalk.red("\n✖ Skills push failed:"),
			error instanceof Error ? error.message : String(error),
		);
		process.exitCode = 1;
	}
}
