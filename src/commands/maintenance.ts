import { execSync } from "node:child_process";
import path from "node:path";
import { ConfigService, CURRENT_STATE_FILE, getVemDir } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import fs from "fs-extra";

import {
	API_URL,
	buildDeviceHeaders,
	trackCommandUsage,
	tryAuthenticatedKey,
} from "../runtime.js";

export function registerMaintenanceCommands(program: Command) {
	const getCurrentStateFromLocalCache = async () => {
		try {
			const vemDir = await getVemDir();
			const currentStatePath = path.join(vemDir, CURRENT_STATE_FILE);
			if (!(await fs.pathExists(currentStatePath))) return "";
			return await fs.readFile(currentStatePath, "utf-8");
		} catch {
			return "";
		}
	};

	const writeCurrentStateToLocalCache = async (content: string) => {
		const vemDir = await getVemDir();
		const currentStatePath = path.join(vemDir, CURRENT_STATE_FILE);
		await fs.writeFile(currentStatePath, content, "utf-8");
	};

	const resolveRemoteProjectAuth = async () => {
		const configService = new ConfigService();
		const [apiKey, projectId] = await Promise.all([
			tryAuthenticatedKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return null;
		return { configService, apiKey, projectId };
	};

	const decisionCmd = program
		.command("decision")
		.description("Manage architectural decisions");

	decisionCmd
		.command("add <title>")
		.description("Record an architectural decision")
		.option("--context <text>", "Why this decision was needed")
		.option("--decision <text>", "What was decided")
		.option(
			"--tasks <ids>",
			"Comma-separated task IDs (e.g., TASK-001,TASK-002)",
		)
		.action(
			async (
				title: string,
				options: { context?: string; decision?: string; tasks?: string },
			) => {
				try {
					if (!options.context || !options.decision) {
						console.error(
							chalk.red("\n✖ Both --context and --decision are required.\n"),
						);
						console.log(chalk.gray("Example:"));
						console.log(
							chalk.gray('  vem decision add "Use Zod for validation" \\'),
						);
						console.log(
							chalk.gray('    --context "Need runtime type checking" \\'),
						);
						console.log(
							chalk.gray(
								'    --decision "Chose Zod over Yup for better TypeScript inference" \\',
							),
						);
						console.log(chalk.gray("    --tasks TASK-042,TASK-043"));
						return;
					}

					const relatedTasks = options.tasks
						? options.tasks
								.split(",")
								.map((t) => t.trim())
								.filter(Boolean)
						: undefined;

					let savedToCloud = false;
					const remoteAuth = await resolveRemoteProjectAuth();
					if (remoteAuth) {
						const response = await fetch(
							`${API_URL}/projects/${remoteAuth.projectId}/decisions`,
							{
								method: "POST",
								headers: {
									Authorization: `Bearer ${remoteAuth.apiKey}`,
									"Content-Type": "application/json",
									...(await buildDeviceHeaders(remoteAuth.configService)),
								},
								body: JSON.stringify({
									title,
									context: options.context,
									decision: options.decision,
									related_tasks: relatedTasks ?? [],
								}),
							},
						);
						if (!response.ok) {
							const payload = await response.json().catch(() => ({}));
							throw new Error(
								payload.error || "Failed to store decision in cloud",
							);
						}
						savedToCloud = true;
					}

					const configService = new ConfigService();
					await configService.recordDecision(
						title,
						options.context,
						options.decision,
						relatedTasks,
					);

					console.log(
						chalk.green(
							`\n✔ Decision recorded${savedToCloud ? " (cloud + local cache)" : " (local cache)"}: ${title}`,
						),
					);
					if (relatedTasks && relatedTasks.length > 0) {
						console.log(
							chalk.gray(`  Related tasks: ${relatedTasks.join(", ")}`),
						);
					}
					console.log();
				} catch (error: any) {
					console.error(
						chalk.red(`\n✖ Failed to record decision: ${error.message}\n`),
					);
				}
			},
		);

	const contextCmd = program
		.command("context")
		.description("Manage project context and current state");

	contextCmd
		.command("show")
		.description("Show project context and current state")
		.action(async () => {
			try {
				const remoteAuth = await resolveRemoteProjectAuth();
				if (remoteAuth) {
					const response = await fetch(
						`${API_URL}/projects/${remoteAuth.projectId}/context`,
						{
							headers: {
								Authorization: `Bearer ${remoteAuth.apiKey}`,
								...(await buildDeviceHeaders(remoteAuth.configService)),
							},
						},
					);
					if (response.ok) {
						const payload = (await response.json()) as {
							context?: string;
							current_state?: string;
							decisions?: string;
							source?: string;
						};
						console.log(chalk.bold("\nProject Context"));
						console.log(chalk.gray(`Source: ${payload.source || "db"}`));
						console.log(payload.context || "");
						console.log(chalk.bold("\nCurrent State"));
						console.log(payload.current_state || "");
						if (payload.decisions && payload.decisions.trim().length > 0) {
							console.log(chalk.bold("\nDecisions"));
							console.log(payload.decisions);
						}
						console.log("");
						return;
					}
				}

				const configService = new ConfigService();
				const [context, currentState] = await Promise.all([
					configService.getContext(),
					getCurrentStateFromLocalCache(),
				]);
				console.log(chalk.bold("\nProject Context (local cache)"));
				console.log(context || "");
				console.log(chalk.bold("\nCurrent State (local cache)"));
				console.log(currentState || "");
				console.log("");
			} catch (error: any) {
				console.error(
					chalk.red(`\n✖ Failed to read context: ${error.message}\n`),
				);
			}
		});

	contextCmd
		.command("set")
		.description("Set project context and/or current state")
		.option("--context <text>", "Full CONTEXT.md content")
		.option("--current-state <text>", "Full CURRENT_STATE.md content")
		.action(async (options: { context?: string; currentState?: string }) => {
			try {
				if (
					options.context === undefined &&
					options.currentState === undefined
				) {
					console.error(
						chalk.red(
							"\n✖ Provide at least one of --context or --current-state.\n",
						),
					);
					return;
				}

				let savedToCloud = false;
				const remoteAuth = await resolveRemoteProjectAuth();
				if (remoteAuth) {
					const response = await fetch(
						`${API_URL}/projects/${remoteAuth.projectId}/context`,
						{
							method: "PUT",
							headers: {
								Authorization: `Bearer ${remoteAuth.apiKey}`,
								"Content-Type": "application/json",
								...(await buildDeviceHeaders(remoteAuth.configService)),
							},
							body: JSON.stringify({
								...(options.context !== undefined
									? { context: options.context }
									: {}),
								...(options.currentState !== undefined
									? { current_state: options.currentState }
									: {}),
							}),
						},
					);
					if (response.ok) {
						savedToCloud = true;
					} else {
						const payload = await response.json().catch(() => ({}));
						console.log(
							chalk.yellow(
								`Cloud context update failed; continuing with local cache only: ${payload.error || response.statusText}`,
							),
						);
					}
				}

				const configService = new ConfigService();
				if (options.context !== undefined) {
					await configService.updateContext(options.context);
				}
				if (options.currentState !== undefined) {
					await writeCurrentStateToLocalCache(options.currentState);
				}

				console.log(
					chalk.green(
						`\n✔ Context updated${savedToCloud ? " (cloud + local cache)" : " (local cache)"}\n`,
					),
				);
			} catch (error: any) {
				console.error(
					chalk.red(`\n✖ Failed to update context: ${error.message}\n`),
				);
			}
		});

	// Diff command
	program
		.command("diff")
		.description("Show differences between local and cloud state")
		.option("--detailed", "Show detailed content diffs")
		.option("--json", "Output as JSON")
		.action(async (options: { detailed?: boolean; json?: boolean }) => {
			try {
				const { DiffService } = await import("@vem/core");
				const diffService = new DiffService();

				const result = await diffService.compareWithLastPush();

				if (options.json) {
					console.log(JSON.stringify(result, null, 2));
					return;
				}

				console.log(chalk.bold("\nVEM Diff (local vs. cloud)"));
				console.log(chalk.gray("─".repeat(50)));

				// Tasks
				if (result.tasks.added.length > 0 || result.tasks.modified.length > 0) {
					console.log(chalk.bold("\nTasks:"));
					for (const id of result.tasks.added) {
						console.log(chalk.green(`  + ${id} (new)`));
					}
					for (const mod of result.tasks.modified) {
						console.log(chalk.yellow(`  ~ ${mod.id} (${mod.changes})`));
					}
				}

				// Decisions
				if (result.decisions.added.length > 0) {
					console.log(chalk.bold("\nDecisions:"));
					console.log(
						chalk.green(`  + ${result.decisions.added.length} new decisions`),
					);
				}

				// Changelog
				if (result.changelog.added.length > 0) {
					console.log(chalk.bold("\nChangelog:"));
					console.log(
						chalk.green(`  + ${result.changelog.added.length} new entries`),
					);
				}

				// Current State
				if (result.currentState.changed) {
					console.log(chalk.bold("\nCurrent State:"));
					console.log(
						chalk.yellow(
							`  ~ Modified locally (${result.currentState.lineCount} lines)`,
						),
					);
				}

				// Summary
				console.log(chalk.gray(`\n${"─".repeat(50)}`));
				console.log(
					chalk.bold(`Summary: ${result.summary.totalChanges} changes`),
				);
				if (result.summary.totalChanges > 0) {
					console.log(chalk.gray("Run: vem push\n"));
				} else {
					console.log(chalk.gray("No changes to push\n"));
				}
			} catch (error: any) {
				console.error(
					chalk.red(`\n✖ Failed to generate diff: ${error.message}\n`),
				);
			}
		});

	// Doctor command
	program
		.command("doctor")
		.description("Run health checks on VEM setup")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const { DoctorService } = await import("@vem/core");
				const doctorService = new DoctorService();

				const results = await doctorService.runAllChecks();

				if (options.json) {
					console.log(JSON.stringify(results, null, 2));
					process.exit(
						results.some((r) => r.status === "fail")
							? 2
							: results.some((r) => r.status === "warn")
								? 1
								: 0,
					);
					return;
				}

				console.log(chalk.bold("\nVEM Health Check"));
				console.log(chalk.gray("─".repeat(50)));

				let hasErrors = false;
				let hasWarnings = false;

				for (const result of results) {
					let icon = "";
					let color: (s: string) => string;

					if (result.status === "pass") {
						icon = "✓";
						color = chalk.green;
					} else if (result.status === "warn") {
						icon = "⚠";
						color = chalk.yellow;
						hasWarnings = true;
					} else {
						icon = "✗";
						color = chalk.red;
						hasErrors = true;
					}

					console.log(color(`${icon} ${result.name}`));
					console.log(chalk.gray(`  ${result.message}`));

					if (result.fix) {
						console.log(chalk.gray(`  → ${result.fix}`));
					}
				}

				console.log(chalk.gray("─".repeat(50)));

				if (hasErrors) {
					console.log(chalk.red("\n✗ Issues found that need attention\n"));
					process.exit(2);
				} else if (hasWarnings) {
					console.log(chalk.yellow("\n⚠ Minor issues found\n"));
					process.exit(1);
				} else {
					console.log(chalk.green("\n✓ All checks passed\n"));
					process.exit(0);
				}
			} catch (error: any) {
				console.error(
					chalk.red(`\n✖ Failed to run health checks: ${error.message}\n`),
				);
				process.exit(2);
			}
		});

	// Summarize command
	program
		.command("summarize")
		.description("Analyze current changes and suggest VEM memory updates")
		.option("--staged", "Analyze only staged changes")
		.action(async (options: { staged?: boolean }) => {
			await trackCommandUsage("summarize");
			try {
				const configService = new ConfigService();
				const key = await tryAuthenticatedKey(configService);
				const projectId = await configService.getProjectId();

				if (!key || !projectId) {
					console.error(
						chalk.red("\n✖ Authentication or project link missing.\n"),
					);
					return;
				}

				console.log(chalk.blue("Analyzing local changes..."));
				const diffCmd = options.staged ? "git diff --cached" : "git diff HEAD";
				const diff = execSync(diffCmd).toString();

				if (!diff.trim()) {
					console.log(chalk.yellow("No changes detected to summarize."));
					return;
				}

				const res = await fetch(`${API_URL}/projects/${projectId}/summarize`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${key}`,
						"Content-Type": "application/json",
						...(await buildDeviceHeaders(configService)),
					},
					body: JSON.stringify({ diff }),
				});

				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(data.error || "Summarization request failed");
				}

				const { suggestions } = await res.json();

				console.log(chalk.bold("\n✨ AI-Suggested Memory Updates"));
				console.log(chalk.gray("─".repeat(50)));

				if (suggestions.changelog) {
					console.log(chalk.cyan("\n[Changelog]"));
					console.log(suggestions.changelog);
				}

				if (suggestions.decisions?.length > 0) {
					console.log(chalk.cyan("\n[Decisions]"));
					suggestions.decisions.forEach((d: any) => {
						console.log(chalk.bold(`- ${d.title}`));
						console.log(chalk.gray(`  ${d.decision}`));
					});
				}

				if (suggestions.context_updates) {
					console.log(chalk.cyan("\n[Context Updates]"));
					console.log(suggestions.context_updates);
				}

				if (suggestions.current_state_updates) {
					console.log(chalk.cyan("\n[Current State Updates]"));
					console.log(suggestions.current_state_updates);
				}

				console.log(chalk.gray(`\n${"─".repeat(50)}`));
				console.log(
					chalk.gray(
						"Tip: Use these suggestions to update your .vem/ files before pushing.\n",
					),
				);
			} catch (error: any) {
				console.error(
					chalk.red(`\n✖ Failed to generate summary: ${error.message}\n`),
				);
			}
		});
}
