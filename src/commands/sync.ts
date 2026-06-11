import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	applyVemUpdate,
	CHANGELOG_DIR,
	ConfigService,
	ConstitutionService,
	computeSnapshotHash,
	DECISIONS_DIR,
	ensureVemFiles,
	formatVemPack,
	parseVemUpdateBlock,
	ScalableLogService,
	SensorsService,
	ValidationRulesService,
} from "@vem/core";
import { VemReviewSchema } from "@vem/schemas";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

import {
	API_URL,
	buildDeviceHeaders,
	computeVemHash,
	ensureAuthenticated,
	getCommits,
	getGitHash,
	getGitRemote,
	isVemDirty,
	performPush,
	processQueue,
	readStdin,
	showWorkflowHint,
	syncProjectMemoryToRemote,
	syncService,
	taskService,
	trackCommandUsage,
} from "../runtime.js";

import {
	submitStructuredVemUpdateToRemote,
	syncParsedTaskUpdatesToRemote,
} from "./agent.js";

export function registerSyncCommands(program: Command) {
	program
		.command("push")
		.description("Push local snapshot to cloud")
		.option(
			"--dry-run",
			"Preview what would be pushed without actually pushing",
		)
		.option("--force", "Push even if no changes detected")
		.action(async (options: { dryRun?: boolean; force?: boolean }) => {
			await trackCommandUsage("push");
			try {
				const configService = new ConfigService();
				const projectId = await configService.getProjectId();
				if (!projectId) {
					console.error(
						chalk.red(
							"Error: Project not linked. Run `vem link <projectId>` before pushing snapshots.",
						),
					);
					return;
				}

				const key = await ensureAuthenticated(configService);
				const baseVersion = await configService.getLastVersion();

				// Process queue before pushing new snapshot
				await processQueue(syncService, configService, key);

				const repoUrl = projectId ? null : await getGitRemote();

				const gitHash = getGitHash();
				if (!gitHash) {
					console.error(
						chalk.red(
							"Error: git HEAD not found. Create at least one commit before running `vem push`.",
						),
					);
					return;
				}

				const vemHash = await computeVemHash();
				const lastPush = await configService.getLastPushState();
				const hasChanges = !(
					vemHash &&
					lastPush.gitHash === gitHash &&
					lastPush.vemHash === vemHash
				);

				if (!hasChanges && !options.force) {
					const lastPushTime = lastPush.gitHash ? "previously" : "never";
					console.log(
						chalk.gray(
							`✔ No changes since last push (git HEAD and .vem unchanged). Last push: ${lastPushTime}`,
						),
					);
					console.log(chalk.gray("   Use --force to push anyway."));
					return;
				}

				console.log(chalk.blue("📦 Packing snapshot..."));
				const snapshot = await syncService.pack();
				const snapshotHash = computeSnapshotHash(snapshot);

				const targetLabel = `linked project ${projectId}`;

				// Dry-run mode: show preview and exit
				if (options.dryRun) {
					console.log(chalk.cyan("\n📋 Dry Run Preview\n"));
					console.log(chalk.white(`Target: ${targetLabel}`));
					console.log(chalk.white(`Git Hash: ${gitHash}`));
					console.log(chalk.white(`Snapshot Hash: ${snapshotHash}`));
					console.log(chalk.white(`Base Version: ${baseVersion || "none"}`));
					console.log(
						chalk.white(
							"Verification: pending until Git webhook matches git hash + snapshot hash",
						),
					);

					const taskCount = snapshot.tasks?.tasks?.length || 0;
					const decisionCount = snapshot.decisions?.length || 0;
					const changelogCount = snapshot.changelog?.length || 0;
					const agentInstructionCount =
						snapshot.agent_instructions?.length || 0;

					console.log(chalk.white(`\nSnapshot Contents:`));
					console.log(chalk.gray(`  Tasks: ${taskCount}`));
					console.log(chalk.gray(`  Decisions (chars): ${decisionCount}`));
					console.log(chalk.gray(`  Changelog (chars): ${changelogCount}`));
					console.log(
						chalk.gray(`  Context: ${snapshot.context ? "yes" : "no"}`),
					);
					console.log(
						chalk.gray(
							`  Current state: ${snapshot.current_state ? "yes" : "no"}`,
						),
					);
					console.log(
						chalk.gray(
							`  Agent instructions: ${agentInstructionCount} file${agentInstructionCount === 1 ? "" : "s"}`,
						),
					);

					console.log(chalk.cyan("\n✔ Dry run complete. No changes pushed.\n"));
					console.log(chalk.gray("   Run without --dry-run to push for real."));
					return;
				}

				console.log(chalk.blue(`🚀 Pushing to cloud (${targetLabel})...`));

				const commits = await getCommits(50);
				const payload = {
					...snapshot,
					...(repoUrl ? { repo_url: repoUrl } : {}),
					base_version: baseVersion,
					commits,
					project_id: projectId,
					git_hash: gitHash,
					snapshot_hash: snapshotHash,
				};

				let result = await performPush(payload, key, configService);
				if (
					!result.success &&
					result.status === 409 &&
					result.data?.expected_repo_url &&
					projectId
				) {
					const expectedRepoUrl = result.data.expected_repo_url as string;
					const actualRepo = repoUrl || "(no git remote)";
					console.log(
						chalk.yellow(
							`Project is linked to ${expectedRepoUrl}. Local repo is ${actualRepo}. Retrying using the linked project only...`,
						),
					);
					console.log(
						chalk.blue(
							`🚀 Pushing to cloud (linked repo ${expectedRepoUrl})...`,
						),
					);
					const retryPayload = { ...payload } as Record<string, unknown>;
					delete retryPayload.repo_url;
					result = await performPush(retryPayload, key, configService);
				}

				if (result.success) {
					if (gitHash && vemHash) {
						await configService.setLastPushState({ gitHash, vemHash });
						await configService.setLastSyncedVemHash(vemHash);
					}
					console.log(
						chalk.green(
							`\n✔ Snapshot pushed! Version: ${result.data.version || "v1"}\n`,
						),
					);

					// Auto-archive completed tasks to prevent duplication in future snapshots
					try {
						const archivedCount = await taskService.archiveTasks({
							status: "done",
						});
						if (archivedCount > 0) {
							console.log(
								chalk.green(`✔ Archived ${archivedCount} completed tasks.`),
							);
						}
					} catch (err) {
						// Soft failure: Don't fail the push if archiving fails, just warn
						console.error(
							chalk.yellow(
								`⚠ Failed to archive completed tasks: ${err instanceof Error ? err.message : String(err)}`,
							),
						);
					}

					// Auto-sync skills if skills-lock.json exists
					if (projectId) {
						try {
							const repoRoot = execSync("git rev-parse --show-toplevel", {
								encoding: "utf-8",
							}).trim();
							const lockPath = join(repoRoot, "skills-lock.json");
							const lockRaw = await readFile(lockPath, "utf-8");
							const lock = JSON.parse(lockRaw) as {
								version: number;
								skills: Record<
									string,
									{ source: string; sourceType: string; skillPath: string }
								>;
							};
							const skillCount = Object.keys(lock.skills ?? {}).length;
							// Collect skill file contents, resolving the actual local path.
							// skills-lock.json records `skillPath` as the upstream GitHub repo
							// path (e.g. skills/productivity/caveman/SKILL.md), but
							// `npx skills@latest` installs files to .agents/skills/<name>/.
							// Try the local .agents/ path first, then fall back to skillPath.
							const skillFiles: { path: string; content: string }[] = [];
							for (const [skillName, skill] of Object.entries(
								lock.skills ?? {},
							)) {
								const agentsPath = join(
									repoRoot,
									".agents",
									"skills",
									skillName,
									"SKILL.md",
								);
								const legacyPath = join(repoRoot, skill.skillPath);
								for (const candidate of [agentsPath, legacyPath]) {
									try {
										const content = await readFile(candidate, "utf-8");
										const { relative } = await import("node:path");
										skillFiles.push({
											path: relative(repoRoot, candidate),
											content,
										});
										break;
									} catch {
										// try next candidate
									}
								}
							}
							const apiKey = await configService.getApiKey();
							const deviceHeaders = await buildDeviceHeaders(configService);
							const skillsRes = await fetch(
								`${API_URL}/projects/${projectId}/skills`,
								{
									method: "PUT",
									headers: {
										"Content-Type": "application/json",
										Authorization: `Bearer ${apiKey}`,
										...deviceHeaders,
									},
									body: JSON.stringify({
										skills_lock: lock,
										skill_files: skillFiles,
									}),
								},
							);
							if (skillsRes.ok) {
								console.log(
									chalk.green(
										`✔ Skills synced (${skillCount} skill${skillCount === 1 ? "" : "s"}).`,
									),
								);
							}
						} catch {
							// No skills-lock.json or sync failed — soft failure
						}
					}

					// Sync vem config (constitution, validation_rules, sensors_config) — soft failure
					try {
						const [constitutionContent, validationRules, sensorsConfig] =
							await Promise.all([
								new ConstitutionService().get(),
								new ValidationRulesService().readRules(),
								new SensorsService().readConfig(),
							]);
						const apiKey = await configService.getApiKey();
						const deviceHeaders = await buildDeviceHeaders(configService);
						await fetch(`${API_URL}/projects/${projectId}/vem-config`, {
							method: "PATCH",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${apiKey}`,
								...deviceHeaders,
							},
							body: JSON.stringify({
								constitution_content: constitutionContent,
								validation_rules: validationRules,
								sensors_config: sensorsConfig,
							}),
						});
					} catch {
						// Soft failure — don't block push on vem-config sync
					}

					// Show workflow hint
					await showWorkflowHint("push");
				} else {
					if (result.status === 409) {
						const data = result.data;
						if (data.latest_version) {
							const latest = data.latest_version || "unknown";
							console.error(
								chalk.yellow(
									`Conflict: local base version ${baseVersion || "none"} does not match latest ${latest}. Pull the latest snapshot (\`vem pull\`) or re-run push from the latest memory state.`,
								),
							);
							return;
						}
						if (data.expected_repo_url) {
							const expectedRepoUrl = data.expected_repo_url as string;
							const actualRepo = repoUrl || "(no git remote)";
							console.error(
								chalk.yellow(
									`Project is linked to ${expectedRepoUrl}, local repo is ${actualRepo}. Update your git remote or re-link the project, then retry.`,
								),
							);
							return;
						}
						console.error(chalk.yellow(data.error || "Conflict detected."));
						return;
					}
					if (result.status === 403) {
						console.error(
							chalk.red(
								result.error ||
									"Device limit reached. Disconnect a device or upgrade your plan.",
							),
						);
						return;
					}
					if (result.status === 404) {
						console.error(
							chalk.red(
								result.error ||
									"Project not found. It may have been deleted. Run `vem unlink` then `vem link` to reconnect.",
							),
						);
						return;
					}

					// Network error or other non-rejection error: enqueue
					console.log(
						chalk.yellow(
							`\n⚠ Push failed (${result.error}). Queuing snapshot for later...`,
						),
					);
					const id = await syncService.enqueue(payload);
					console.log(chalk.gray(`Queued as ${id}`));
				}
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Push Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Push Failed:"), String(error));
				}
			}
		});

	program
		.command("pull")
		.description("Pull latest snapshot from cloud")
		.option("-f, --force", "Overwrite local changes without warning")
		.action(async (options) => {
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();

				if ((await isVemDirty(configService)) && !options.force) {
					console.error(
						chalk.yellow(
							"⚠ Local .vem memory has unsynced changes. Pulling will overwrite it.",
						),
					);
					console.log(
						chalk.gray(
							"Push your snapshot first, or use `vem pull --force` to proceed.",
						),
					);
					return;
				}

				const repoUrl = projectId ? null : await getGitRemote();
				if (!repoUrl && !projectId) {
					console.error(
						chalk.red(
							"Error: Could not detect git remote URL or linked project. Run `vem link <projectId>` or set a git remote.",
						),
					);
					return;
				}

				const targetLabel = repoUrl || projectId || "project";
				console.log(
					chalk.blue(`⬇ Finding latest snapshot for ${targetLabel}...`),
				);
				const query = new URLSearchParams();
				if (repoUrl) query.set("repo_url", repoUrl);
				if (projectId) query.set("project_id", projectId);
				const res = await fetch(`${API_URL}/snapshots/latest?${query}`, {
					headers: {
						Authorization: `Bearer ${key}`,
						...(await buildDeviceHeaders(configService)),
					},
				});

				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
						expected_repo_url?: string;
					};
					if (res.status === 404) {
						const message =
							typeof data.error === "string"
								? data.error
								: "Project not found. It may have been deleted. Run `vem unlink` then `vem link` to reconnect.";
						console.log(chalk.yellow(message));
						if (message.toLowerCase().includes("no snapshots")) {
							console.log(
								chalk.gray(
									"Tip: push a snapshot first (`vem push`) and wait for verification if needed.",
								),
							);
						}
						return;
					}
					if (res.status === 409) {
						if (data.expected_repo_url) {
							console.error(
								chalk.yellow(
									`Repo URL mismatch. Expected ${data.expected_repo_url}. Update your git remote or project settings, then retry.`,
								),
							);
							return;
						}
						console.error(chalk.yellow(data.error || "Conflict detected."));
						return;
					}
					if (res.status === 403) {
						console.error(
							chalk.red(
								data.error ||
									"Device limit reached. Disconnect a device or upgrade your plan.",
							),
						);
						return;
					}
					throw new Error(
						`API Error ${res.status}: ${data.error || res.statusText}`,
					);
				}

				const data = (await res.json()) as { snapshot: any; version?: string };
				if (!data.snapshot) {
					console.log(chalk.yellow("No snapshot data in response."));
					return;
				}

				console.log(chalk.blue("📦 Unpacking snapshot..."));
				await syncService.unpack(data.snapshot);
				const localHash = await computeVemHash();
				await configService.setLastSyncedVemHash(localHash);
				if (data.version) {
					await configService.setLastVersion(data.version);
				}
				console.log(
					chalk.green(`\n✔ Synced to version ${data.version || "unknown"}\n`),
				);
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Pull Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Pull Failed:"), String(error));
				}
			}
		});

	program
		.command("pack")
		.description("Generate a vem_pack block for agent prompts")
		.option("--json", "Output raw JSON instead of a fenced block")
		.option("--full", "Include full snapshot content (default is compact)")
		.action(async (options) => {
			await trackCommandUsage("pack");
			try {
				await ensureVemFiles();
				const snapshot = options.full
					? await syncService.pack()
					: await syncService.packForAgent();
				const output = options.json
					? JSON.stringify(snapshot, null, 2)
					: formatVemPack(snapshot);
				console.log(output);

				// Show suggestion to use agent instead
				await showWorkflowHint("pack");
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Pack Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Pack Failed:"), String(error));
				}
			}
		});

	program
		.command("finalize")
		.description("Apply a vem_update v1 block to local memory artifacts")
		.option("-f, --file <path>", "Path to an agent response or update block")
		.action(async (options) => {
			await trackCommandUsage("finalize");
			try {
				let input = "";
				if (options.file) {
					input = await readFile(options.file, "utf-8");
				} else if (!process.stdin.isTTY) {
					input = await readStdin();
				} else {
					console.error(
						chalk.red(
							"Provide a vem_update block via --file or pipe it into stdin.",
						),
					);
					process.exitCode = 1;
					return;
				}

				const update = parseVemUpdateBlock(input);

				// ── Sandbox mode: POST directly to the API ─────────────────────────
				// When running inside a cloud sandbox container the env vars
				// VEM_TASK_RUN_ID and VEM_API_KEY are injected by the runner/dispatcher.
				// In this case skip all local .vem/ file operations (the workspace doesn't
				// exist in the container) and submit the parsed update directly to the API.
				const sandboxRunId = process.env.VEM_TASK_RUN_ID;
				const sandboxApiKey = process.env.VEM_API_KEY;
				const sandboxApiUrl =
					process.env.VEM_API_URL || "http://localhost:3002";

				if (sandboxRunId && sandboxApiKey) {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 30_000);
					let res: Response;
					try {
						res = await fetch(
							`${sandboxApiUrl}/task-runs/${sandboxRunId}/vem-update-structured`,
							{
								method: "POST",
								headers: {
									Authorization: `Bearer ${sandboxApiKey}`,
									"Content-Type": "application/json",
								},
								body: JSON.stringify({ update }),
								signal: controller.signal,
							},
						);
					} finally {
						clearTimeout(timeoutId);
					}
					if (!res.ok) {
						const errText = await res.text().catch(() => "");
						console.error(
							chalk.red("[vem finalize] API submission failed:"),
							res.status,
							errText,
						);
						process.exitCode = 1;
					} else {
						console.log(chalk.green("\n✔ vem update submitted to API\n"));
					}
					return;
				}

				// ── Local mode: write to .vem/ files and sync to cloud ─────────────
				const result = await applyVemUpdate(update);

				console.log(chalk.green("\n✔ vem update applied\n"));
				if (result.updatedTasks.length > 0) {
					console.log(
						chalk.gray(
							`Updated tasks: ${result.updatedTasks.map((task) => task.id).join(", ")}`,
						),
					);
				}
				if (result.newTasks.length > 0) {
					console.log(
						chalk.gray(
							`New tasks: ${result.newTasks.map((task) => task.id).join(", ")}`,
						),
					);
				}
				if (result.changelogLines.length > 0) {
					console.log(
						chalk.gray(`Changelog entries: ${result.changelogLines.length}`),
					);
				}
				if (result.newCycles.length > 0) {
					console.log(
						chalk.gray(
							`New cycles: ${result.newCycles.map((c) => c.name).join(", ")}`,
						),
					);
				}
				if (result.decisionsAppended) {
					console.log(chalk.gray("Decisions updated."));
				}
				if (result.currentStateUpdated) {
					console.log(chalk.gray("Current state updated."));
				} else {
					console.log(
						chalk.yellow(
							"No current_state provided; CURRENT_STATE.md was left unchanged.",
						),
					);
				}
				if (result.contextUpdated) {
					console.log(chalk.gray("Context updated."));
				}

				const configService = new ConfigService();
				const structuredSynced = await submitStructuredVemUpdateToRemote(
					configService,
					update,
				).catch((err: unknown) => {
					console.error(
						chalk.yellow("[vem finalize] structured sync failed:"),
						err instanceof Error ? err.message : String(err),
					);
					return false;
				});
				if (!structuredSynced) {
					await syncParsedTaskUpdatesToRemote(
						configService,
						update,
						result,
					).catch((err: unknown) => {
						console.error(
							chalk.yellow("[vem finalize] syncParsed failed:"),
							err instanceof Error ? err.message : String(err),
						);
					});
				}
				const synced = await syncProjectMemoryToRemote().catch(() => false);
				if (synced) {
					console.log(chalk.gray("✔ Synced to cloud."));
				}
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Finalize Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Finalize Failed:"), String(error));
				}
				process.exitCode = 1;
			}
		});
	// ── vem review submit ───────────────────────────────────────────────────────
	// Used by AI agents running inside a cloud sandbox to submit a vem_review
	// JSON block directly to the API — the same way `vem finalize` submits
	// vem_update blocks. Requires VEM_TASK_RUN_ID + VEM_API_KEY env vars.
	const reviewCmd = program
		.command("review")
		.description("Manage cycle validation reviews");

	reviewCmd
		.command("submit")
		.description(
			"Submit a vem_review block to the API from a cloud sandbox run",
		)
		.option(
			"-f, --file <path>",
			"Path to a file containing the vem_review JSON block",
		)
		.action(async (options) => {
			await trackCommandUsage("review submit");
			try {
				let input = "";
				if (options.file) {
					input = await readFile(options.file, "utf-8");
				} else if (!process.stdin.isTTY) {
					input = await readStdin();
				} else {
					console.error(
						chalk.red(
							"Provide a vem_review JSON block via --file or pipe it into stdin.",
						),
					);
					process.exitCode = 1;
					return;
				}

				// Accept a bare JSON object or one wrapped in a ```json / ```vem_review fence.
				const JSON_FENCE = /```(?:vem_review|json)\s*([\s\S]*?)```/i;
				const fenceMatch = JSON_FENCE.exec(input);
				const rawJson = fenceMatch ? fenceMatch[1] : input;

				let parsedJson: unknown;
				try {
					parsedJson = JSON.parse(rawJson.trim());
				} catch {
					console.error(
						chalk.red("\n✖ Review Submit Failed: input is not valid JSON\n"),
					);
					process.exitCode = 1;
					return;
				}

				const result = VemReviewSchema.safeParse(parsedJson);
				if (!result.success) {
					console.error(
						chalk.red("\n✖ Review Submit Failed: invalid vem_review payload"),
						result.error.flatten(),
					);
					process.exitCode = 1;
					return;
				}

				const sandboxRunId = process.env.VEM_TASK_RUN_ID;
				const sandboxApiKey = process.env.VEM_API_KEY;
				const sandboxApiUrl =
					process.env.VEM_API_URL || "http://localhost:3002";

				if (!sandboxRunId || !sandboxApiKey) {
					console.error(
						chalk.red(
							"\n✖ Review Submit Failed: VEM_TASK_RUN_ID and VEM_API_KEY must be set.\n" +
								"  This command is intended for use inside a cloud sandbox container.\n",
						),
					);
					process.exitCode = 1;
					return;
				}

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 30_000);
				const url = `${sandboxApiUrl}/task-runs/${sandboxRunId}/vem-review-structured`;
				console.error(chalk.dim(`[vem review submit] Posting to: ${url}`));
				let res: Response;
				try {
					res = await fetch(url, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${sandboxApiKey}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ review: result.data }),
						signal: controller.signal,
					});
				} finally {
					clearTimeout(timeoutId);
				}

				if (!res.ok) {
					const errText = await res.text().catch(() => "");
					console.error(
						chalk.red("[vem review submit] API submission failed:"),
						res.status,
						errText,
					);
					process.exitCode = 1;
				} else {
					console.log(chalk.green("\n✔ vem review submitted to API\n"));
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				const cause =
					error instanceof Error && error.cause instanceof Error
						? ` → ${error.cause.message}`
						: "";
				console.error(chalk.red(`\n✖ Review Submit Failed: ${msg}${cause}\n`));
				process.exitCode = 1;
			}
		});

	program
		.command("queue")
		.description("Manage offline snapshot queue")
		.option("--list", "List queued snapshots", true)
		.option("--retry", "Retry pushing all queued snapshots")
		.option("--clear", "Clear the queue")
		.action(async (options) => {
			try {
				const configService = new ConfigService();

				if (options.clear) {
					const queue = await syncService.getQueue();
					for (const item of queue) {
						await syncService.removeFromQueue(item.id);
					}
					console.log(chalk.green("\n✔ Queue cleared\n"));
					return;
				}

				if (options.retry) {
					const key = await ensureAuthenticated(configService);
					await processQueue(syncService, configService, key);
					return;
				}

				const queue = await syncService.getQueue();
				if (queue.length === 0) {
					console.log(chalk.gray("\nOffline queue is empty.\n"));
					return;
				}

				console.log(chalk.bold(`\n📦 Offline Queue (${queue.length} items)\n`));
				const table = new Table({
					head: ["ID", "Time", "Repo", "Version"],
					style: { head: ["cyan"] },
				});

				queue.forEach((item) => {
					const date = new Date(parseInt(item.id.split("-")[0], 10));
					table.push([
						chalk.gray(item.id),
						date.toLocaleString(),
						item.payload.repo_url || "unknown",
						item.payload.base_version || "none",
					]);
				});

				console.log(table.toString());
				console.log(
					chalk.gray("\nUse `vem queue --retry` to push these snapshots.\n"),
				);
			} catch (error: any) {
				console.error(chalk.red("Queue Error:"), error.message);
			}
		});

	program
		.command("archive")
		.description("Archive old memory files to keep context small")
		.option("--all", "Archive decisions, changelogs, and tasks")
		.option("--decisions", "Archive decisions only")
		.option("--changelog", "Archive changelog only")
		.option("--tasks", "Archive completed tasks only")
		.option(
			"--older-than <days>",
			"Archive items older than this many days (default: 30)",
			(val) => parseInt(val, 10),
		)
		.option(
			"--keep <count>",
			"Keep at least this many recent items (default: 20)",
			(val) => parseInt(val, 10),
		)
		.action(async (options) => {
			await trackCommandUsage("archive");
			try {
				await ensureVemFiles();

				const keepCount = options.keep ?? 20;
				const olderThanDays = options.olderThan ?? 30;

				// Defaults if no specific target selected
				const all =
					options.all ||
					(!options.decisions && !options.changelog && !options.tasks);

				console.log(chalk.bold("\n🗄️  Archiving Memory...\n"));
				console.log(
					chalk.gray(
						`Criteria: Keep ${keepCount} items OR younger than ${olderThanDays} days.`,
					),
				);

				if (all || options.decisions) {
					const decisionsLog = new ScalableLogService(DECISIONS_DIR);
					const count = await decisionsLog.archiveEntries({
						keepCount,
						olderThanDays,
					});
					if (count > 0) {
						console.log(chalk.green(`✔ Archived ${count} decision(s)`));
					} else {
						console.log(chalk.gray("Decisions: Nothing to archive"));
					}
				}

				if (all || options.changelog) {
					const changelogLog = new ScalableLogService(CHANGELOG_DIR);
					const count = await changelogLog.archiveEntries({
						keepCount,
						olderThanDays,
					});
					if (count > 0) {
						console.log(chalk.green(`✔ Archived ${count} changelog entry(s)`));
					} else {
						console.log(chalk.gray("Changelog: Nothing to archive"));
					}
				}

				if (all || options.tasks) {
					// For tasks, we only archive "done" tasks
					const count = await taskService.archiveTasks({
						status: "done",
						olderThanDays,
					});
					if (count > 0) {
						console.log(chalk.green(`✔ Archived ${count} completed task(s)`));
					} else {
						console.log(chalk.gray("Tasks: Nothing to archive"));
					}
				}

				console.log("");
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Archive Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Archive Failed:"), String(error));
				}
				process.exit(1);
			}
		});
}
