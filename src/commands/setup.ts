import path from "node:path";

import {
	ConfigService,
	computeSnapshotHash,
	ensureVemDir,
	ensureVemFiles,
	getRepoRoot,
	isVemInitialized,
	KNOWN_AGENT_INSTRUCTION_FILES,
	type UsageStats,
} from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import fs from "fs-extra";
import prompts from "prompts";

import {
	API_URL,
	buildDeviceHeaders,
	computeVemHash,
	getCommits,
	getGitHash,
	hasUncommittedChanges,
	installGitHook,
	metricsService,
	performPush,
	syncService,
	taskService,
	trackCommandUsage,
	tryAuthenticatedKey,
	validateProject,
} from "../runtime.js";
import { runInteractiveLinkFlow } from "./project.js";

const COMMAND_BASELINE = [
	"quickstart",
	"agent",
	"task add",
	"task start",
	"task done",
	"push",
	"search",
	"ask",
	"finalize",
	"archive",
	"status",
	"doctor",
] as const;

const REQUIRED_GITIGNORE_ENTRIES = [".vem/"] as const;
const VEM_AGENT_ENFORCEMENT_MARKER = "## vem Working Rules (Enforced)";
const VEM_AGENT_ENFORCEMENT_BLOCK = `${VEM_AGENT_ENFORCEMENT_MARKER}

All AI agents in this repository must use \`vem\` as the source of truth for task and memory updates.

### 1) Start-of-session protocol
1. Read current work context first:
   - \`vem task list\`
   - \`vem context show\`
2. If working a task, keep notes in task context (not project context):
   - \`vem task context <id> --set "<text>"\`
   - \`vem task context <id> --append "<text>"\`

### 2) During implementation
1. Keep task updates atomic and evidence-based.
2. Use task context for ephemeral notes (blockers, hypotheses, links, iteration notes).
3. Record major architecture decisions with \`vem decision add\`.

### 3) Completion protocol (required)
When an implementation run produces a \`vem_update\` block, you must immediately finalize it.

1. Produce a complete \`vem_update\` payload (context/current_state/changelog/decisions/tasks as applicable).
2. Run finalize immediately using:
   \`\`\`sh
   cat <<'EOF' | vem finalize --file /dev/stdin
   { ...vem_update JSON... }
   EOF
   \`\`\`
3. For completed tasks, include evidence and retain a concise \`task_context_summary\`.

### 4) Finalize reliability rules (critical)
- Always use the global \`vem\` command (never a local file path).
- Never suppress errors (\`2>/dev/null\`, silent fallbacks, etc.).
- Never mask failure with \`|| echo ...\` or similar patterns.
- Pass the complete, exact \`vem_update\` JSON payload.
- If \`vem finalize\` fails, surface the real error and fix/retry; do not treat the run as complete.
`;

async function ensureVemGitignoreEntry(): Promise<void> {
	const repoRoot = await getRepoRoot();
	const gitignorePath = path.join(repoRoot, ".gitignore");
	if (!(await fs.pathExists(gitignorePath))) {
		await fs.writeFile(
			gitignorePath,
			`${REQUIRED_GITIGNORE_ENTRIES.join("\n")}\n`,
			"utf-8",
		);
		return;
	}

	const content = await fs.readFile(gitignorePath, "utf-8");
	const entries = content.split(/\r?\n/).map((line) => line.trim());
	const missingEntries = REQUIRED_GITIGNORE_ENTRIES.filter(
		(entry) => !entries.includes(entry),
	);
	if (missingEntries.length === 0) {
		return;
	}

	const separator = content.endsWith("\n") ? "" : "\n";
	await fs.appendFile(
		gitignorePath,
		`${separator}${missingEntries.join("\n")}\n`,
		"utf-8",
	);
}

type AgentInstructionUpdateResult = {
	createdAgentsFile: boolean;
	updatedFiles: string[];
};

type AgentInstructionPayload = {
	path: string;
	content: string;
};

async function ensureAgentInstructionPolicy(): Promise<AgentInstructionUpdateResult> {
	const repoRoot = await getRepoRoot();
	const existingFiles: string[] = [];

	for (const file of KNOWN_AGENT_INSTRUCTION_FILES) {
		if (await fs.pathExists(path.join(repoRoot, file))) {
			existingFiles.push(file);
		}
	}

	let createdAgentsFile = false;
	let targets: string[] = [];
	if (existingFiles.length === 0) {
		await fs.writeFile(
			path.join(repoRoot, "AGENTS.md"),
			"# AGENTS\n\nThis repository uses `vem` for agent workflows.\n",
			"utf-8",
		);
		createdAgentsFile = true;
		targets = ["AGENTS.md"];
	} else if (existingFiles.includes("AGENTS.md")) {
		targets = ["AGENTS.md"];
	} else {
		targets = existingFiles;
	}

	const updatedFiles: string[] = [];
	for (const relativePath of targets) {
		const absolutePath = path.join(repoRoot, relativePath);
		const content = await fs.readFile(absolutePath, "utf-8");
		if (content.includes(VEM_AGENT_ENFORCEMENT_MARKER)) {
			continue;
		}
		const separator = content.endsWith("\n") ? "" : "\n";
		await fs.appendFile(
			absolutePath,
			`${separator}\n${VEM_AGENT_ENFORCEMENT_BLOCK}`,
			"utf-8",
		);
		updatedFiles.push(relativePath);
	}

	return {
		createdAgentsFile,
		updatedFiles,
	};
}

async function collectAgentInstructionPayload(): Promise<
	AgentInstructionPayload[]
> {
	const repoRoot = await getRepoRoot();
	const payload: AgentInstructionPayload[] = [];

	for (const relativePath of KNOWN_AGENT_INSTRUCTION_FILES) {
		const absolutePath = path.join(repoRoot, relativePath);
		if (!(await fs.pathExists(absolutePath))) continue;
		const stat = await fs.stat(absolutePath);
		if (!stat.isFile()) continue;

		payload.push({
			path: relativePath,
			content: await fs.readFile(absolutePath, "utf-8"),
		});
	}

	return payload;
}

async function syncAgentInstructionsToCloud(
	configService: ConfigService,
	projectId: string,
	apiKey: string,
) {
	const instructions = await collectAgentInstructionPayload();
	const response = await fetch(
		`${API_URL}/projects/${projectId}/instructions`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(configService)),
			},
			body: JSON.stringify({ instructions }),
		},
	);

	if (!response.ok) {
		const data = await response
			.json()
			.catch(() => ({ error: response.statusText }));
		const message =
			typeof data?.error === "string" ? data.error : response.statusText;
		throw new Error(message);
	}

	return instructions.length;
}

const getSortedCommandEntries = (stats: UsageStats) =>
	Object.entries(stats.commandCounts).sort((a, b) => b[1] - a[1]);

const formatRelativeTime = (timestamp: number) => {
	const elapsed = Date.now() - timestamp;
	if (elapsed < 60_000) return "just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
	return `${Math.floor(elapsed / 86_400_000)} day(s) ago`;
};

const renderUsageInsights = (stats: UsageStats, detailed = false) => {
	const entries = getSortedCommandEntries(stats);
	console.log(chalk.bold("\n📈 Command Insights\n"));

	if (entries.length === 0) {
		console.log(chalk.gray("  No command usage recorded yet."));
		console.log(chalk.gray("  Start with: vem quickstart"));
		return;
	}

	const rows = detailed ? entries : entries.slice(0, 6);
	console.log(chalk.gray(`  Commands tracked: ${entries.length}`));
	rows.forEach(([command, count], index) => {
		console.log(
			`  ${chalk.gray(`${index + 1}.`)} ${chalk.white(command)} ${chalk.gray(`(${count})`)}`,
		);
	});
	if (!detailed && entries.length > rows.length) {
		console.log(chalk.gray(`  ...and ${entries.length - rows.length} more`));
	}

	const neverUsed = COMMAND_BASELINE.filter(
		(command) => (stats.commandCounts[command] || 0) === 0,
	);
	if (neverUsed.length > 0) {
		console.log(chalk.gray("\n  Suggested next commands:"));
		neverUsed.slice(0, 3).forEach((command) => {
			console.log(`    ${chalk.cyan(command)}`);
		});
	}

	if (stats.lastPush) {
		console.log(
			chalk.gray(`\n  Last push: ${formatRelativeTime(stats.lastPush)}`),
		);
	}
	if (stats.lastAgentRun) {
		console.log(
			chalk.gray(
				`  Last agent session: ${formatRelativeTime(stats.lastAgentRun)}`,
			),
		);
	}
};

export function registerSetupCommands(program: Command) {
	program
		.command("init")
		.description("Initialize vem in the current repository")
		.action(async () => {
			try {
				if (await hasUncommittedChanges()) {
					console.log(
						chalk.yellow(
							"\n⚠ Uncommitted changes detected in this workspace.\n",
						),
					);
					const proceed = await prompts({
						type: "confirm",
						name: "confirmInit",
						message: "Continue with `vem init` anyway?",
						initial: false,
					});
					if (!proceed.confirmInit) {
						console.log(chalk.yellow("Initialization cancelled.\n"));
						return;
					}
				}

				const dir = await ensureVemDir();
				await ensureVemFiles();
				await ensureVemGitignoreEntry();
				const configService = new ConfigService();
				const initHash = await computeVemHash();
				await configService.setLastSyncedVemHash(initHash);
				const agentInstructions = await ensureAgentInstructionPolicy();
				console.log(chalk.green(`\n✔ vem initialized at ${dir}\n`));
				if (agentInstructions.createdAgentsFile) {
					console.log(
						chalk.gray(
							"Created AGENTS.md because no agent instruction files were found.",
						),
					);
				}
				if (agentInstructions.updatedFiles.length > 0) {
					console.log(
						chalk.gray(
							`Updated agent instructions: ${agentInstructions.updatedFiles.join(", ")}`,
						),
					);
				}

				await installGitHook();

				const projectId = await configService.getProjectId();
				const apiKey = await tryAuthenticatedKey(configService);

				// If authenticated but not linked, offer to link now
				let resolvedProjectId = projectId;
				if (apiKey && !projectId) {
					const { doLink } = await prompts({
						type: "confirm",
						name: "doLink",
						message: "Link this repo to a vem cloud project now?",
						initial: true,
					});
					if (doLink) {
						try {
							resolvedProjectId = await runInteractiveLinkFlow(
								apiKey,
								configService,
							);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.log(chalk.yellow(`⚠ Link skipped: ${msg}`));
						}
					} else {
						console.log(
							chalk.gray(
								"Tip: Run `vem link` at any time to connect this repo to a project.",
							),
						);
					}
				}

				if (apiKey && resolvedProjectId) {
					try {
						const syncedCount = await syncAgentInstructionsToCloud(
							configService,
							resolvedProjectId,
							apiKey,
						);
						console.log(
							chalk.gray(
								`Synced ${syncedCount} agent instruction file${syncedCount === 1 ? "" : "s"} to cloud memory.`,
							),
						);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						console.log(
							chalk.yellow(`⚠ Agent instruction sync skipped: ${message}`),
						);
					}

					// Auto-push full snapshot so all local state (tasks, context,
					// decisions, changelog) is immediately in sync with the cloud project.
					const gitHash = getGitHash();
					if (!gitHash) {
						console.log(
							chalk.gray(
								"Tip: Run `vem push` after your first commit to sync local state to the cloud.",
							),
						);
					} else {
						try {
							console.log(chalk.blue("📦 Syncing local state to cloud..."));
							const snapshot = await syncService.pack();
							const snapshotHash = computeSnapshotHash(snapshot);
							const vemHash = await computeVemHash();
							const commits = await getCommits(50);
							const payload = {
								...snapshot,
								commits,
								project_id: resolvedProjectId,
								git_hash: gitHash,
								snapshot_hash: snapshotHash,
							};
							const result = await performPush(payload, apiKey, configService);
							if (result.success) {
								if (vemHash) {
									await configService.setLastPushState({ gitHash, vemHash });
									await configService.setLastSyncedVemHash(vemHash);
								}
								console.log(chalk.green("✔ Local state synced to cloud.\n"));
							} else {
								console.log(
									chalk.yellow(
										`⚠ Auto-sync skipped: ${result.error ?? "unknown error"}`,
									),
								);
							}
						} catch (error) {
							const message =
								error instanceof Error ? error.message : String(error);
							console.log(chalk.yellow(`⚠ Auto-sync skipped: ${message}`));
						}
					}
				} else if (!apiKey) {
					console.log(
						chalk.gray(
							"Tip: Use the web dashboard project settings to run reindexing after `vem login` + `vem link`.",
						),
					);
				}
			} catch (error) {
				console.error(chalk.red("\n✖ Failed to initialize vem:"), error);
				process.exit(1);
			}
		});

	program
		.command("quickstart")
		.description("Interactive guide to powerful VEM workflows")
		.action(async () => {
			await trackCommandUsage("quickstart");

			console.log(chalk.bold.cyan("\n🚀 VEM Quickstart Guide\n"));
			console.log("Let's set up a powerful agent-driven workflow!\n");
			const configService = new ConfigService();

			// Check if initialized
			if (!(await isVemInitialized())) {
				console.log(chalk.yellow("Step 1: Initialize VEM\n"));
				const initResponse = await prompts({
					type: "confirm",
					name: "init",
					message: "Initialize .vem/ in this repository?",
					initial: true,
				});

				if (!initResponse.init) {
					console.log(chalk.yellow("Quickstart cancelled."));
					return;
				}

				// Run init
				try {
					await ensureVemDir();
					await ensureVemFiles();
					await ensureVemGitignoreEntry();
					const initHash = await computeVemHash();
					await configService.setLastSyncedVemHash(initHash);
					console.log(chalk.green("✓ VEM initialized\n"));
				} catch (error: any) {
					console.error(chalk.red("Failed to initialize:"), error.message);
					return;
				}
			} else {
				console.log(chalk.green("✓ VEM already initialized\n"));
			}

			// Check authentication
			let isAuthenticated = false;
			try {
				const key = await configService.getApiKey();
				isAuthenticated = !!key;
			} catch {
				isAuthenticated = false;
			}

			if (!isAuthenticated) {
				console.log(chalk.yellow("Step 2: Authenticate\n"));
				console.log("Get your API key from: https://vem.dev/keys\n");

				const authResponse = await prompts({
					type: "text",
					name: "apiKey",
					message: "Paste your API key:",
				});

				if (!authResponse.apiKey) {
					console.log(chalk.yellow("Quickstart cancelled."));
					return;
				}

				await configService.setApiKey(authResponse.apiKey);
				console.log(chalk.green("✓ Authenticated\n"));
			} else {
				console.log(chalk.green("✓ Already authenticated\n"));
			}

			// Check if linked
			const projectId = await configService.getProjectId().catch(() => null);
			if (!projectId) {
				console.log(chalk.yellow("Step 3: Link to project\n"));
				console.log("This connects your local .vem/ to cloud sync.\n");

				const linkResponse = await prompts({
					type: "confirm",
					name: "link",
					message: "Link to a project now?",
					initial: true,
				});

				if (linkResponse.link) {
					console.log(chalk.cyan("\nRun: vem link"));
					console.log(chalk.gray("(You can select or create a project)\n"));
				}
			} else {
				console.log(chalk.green(`✓ Linked to project: ${projectId}\n`));
			}

			// Introduce task workflow
			console.log(chalk.bold.cyan("\n📋 Task-Driven Workflow\n"));
			console.log(
				"Tasks help you track work and provide context to AI agents.\n",
			);

			const taskResponse = await prompts({
				type: "confirm",
				name: "createTask",
				message: "Create your first task?",
				initial: true,
			});

			if (taskResponse.createTask) {
				const taskDetails = await prompts([
					{
						type: "text",
						name: "title",
						message: "Task title:",
						initial: "Set up VEM workflow",
					},
					{
						type: "text",
						name: "description",
						message: "Description (optional):",
					},
				]);

				if (taskDetails.title) {
					const task = await taskService.addTask(
						taskDetails.title,
						taskDetails.description || "",
						"medium",
					);
					console.log(chalk.green(`\n✓ Created task: ${task.id}`));
				}
			}

			// Introduce agent workflow
			console.log(chalk.bold.cyan("\n🤖 Agent-Driven Development\n"));
			console.log("The 'vem agent' command wraps AI tools with:\n");
			console.log("  • Automatic context injection");
			console.log("  • Task tracking");
			console.log("  • Strict memory enforcement");
			console.log("  • Validation workflows\n");

			const agentResponse = await prompts({
				type: "confirm",
				name: "launchAgent",
				message: "Launch an agent session now?",
				initial: false,
			});

			if (agentResponse.launchAgent) {
				console.log(chalk.cyan("\n🚀 Launching agent...\n"));
				// Would need to refactor agent command into a callable function
				// For now, just show the command
				console.log(chalk.white("Run: vem agent\n"));
			}

			// Summary
			console.log(chalk.bold.cyan("\n✨ Quick Reference\n"));
			console.log(
				chalk.white("  vem agent") +
					chalk.gray("         # Start AI-assisted work"),
			);
			console.log(
				chalk.white("  vem task list") + chalk.gray("     # View tasks"),
			);
			console.log(
				chalk.white("  vem task add") + chalk.gray("      # Create task"),
			);
			console.log(
				chalk.white("  vem push") + chalk.gray("          # Sync to cloud"),
			);
			console.log(
				chalk.white("  vem search") + chalk.gray("        # Query memory"),
			);
			console.log(
				chalk.white("  vem status") +
					chalk.gray("        # Check power score\n"),
			);

			console.log(chalk.green("🎉 You're ready to use VEM powerfully!\n"));
		});

	program
		.command("status")
		.description("Show current project status")
		.action(async () => {
			await trackCommandUsage("status");
			try {
				await ensureVemFiles();
				const configService = new ConfigService();

				console.log(chalk.bold("\n📊 vem Status\n"));

				// Check Login Status
				const apiKey = await configService.getApiKey();
				if (apiKey) {
					try {
						// Verify with API
						const response = await fetch(`${API_URL}/verify`, {
							headers: {
								Authorization: `Bearer ${apiKey}`,
								...(await buildDeviceHeaders(configService)),
							},
						});

						if (response.ok) {
							const data = (await response.json()) as { userId?: string };
							console.log(
								`Login Status: ${chalk.green("Logged In")} (User: ${data.userId})`,
							);
							console.log(
								chalk.gray("               (Run `vem logout` to sign out)"),
							);
						} else {
							console.log(
								`Login Status: ${chalk.red(
									"Invalid Session",
								)} (Run \`vem login\` to fix)`,
							);
						}
					} catch (_err) {
						// Network error or offline
						console.log(
							`Login Status: ${chalk.yellow(
								"Logged In (Offline/Unverified)",
							)} (Cannot reach API)`,
						);
					}
				} else {
					console.log(
						`Login Status: ${chalk.red(
							"Not Logged In",
						)} (Run \`vem login\` options)`,
					);
				}

				// Check Project Link Status
				const projectId = await configService.getProjectId();
				if (projectId) {
					if (apiKey) {
						const check = await validateProject(
							projectId,
							apiKey,
							configService,
						);
						if (check.valid) {
							const label = check.name
								? `${check.name} (${projectId})`
								: projectId;
							console.log(`Linked Project: ${chalk.green(label)}`);
						} else {
							console.log(
								`Linked Project: ${chalk.red(projectId)} ${chalk.red("(not found — project may have been deleted)")}`,
							);
							console.log(
								chalk.gray(
									"               Run `vem unlink` then `vem link` to fix.",
								),
							);
						}
					} else {
						console.log(
							`Linked Project: ${chalk.yellow(projectId)} (unverified — not logged in)`,
						);
					}
				} else {
					console.log(
						`Linked Project: ${chalk.yellow("Not Linked")} (Run \`vem link\`)`,
					);
				}

				// Task Status (if initialized locally)
				try {
					const tasks = await taskService.getTasks();
					const active = tasks.filter(
						(t: any) => t.status !== "done" && !t.deleted_at,
					).length;
					const completed = tasks.filter(
						(t: any) => t.status === "done" && !t.deleted_at,
					).length;

					console.log(`\nLocal Tasks:`);
					console.log(`  Open:      ${chalk.yellow(active)}`);
					console.log(`  Completed: ${chalk.green(completed)}`);
				} catch (_err) {
					// Likely not initialized locally or other error
					console.log(
						`\nLocal Tasks:   ${chalk.gray("Not initialized (Run `vem init`)")}`,
					);
				}

				// Power Feature Usage
				const stats = await metricsService.getStats();
				console.log(chalk.bold("\n⚡ Power Feature Usage\n"));

				const scoreColor =
					stats.powerScore >= 70
						? chalk.green
						: stats.powerScore >= 40
							? chalk.yellow
							: chalk.gray;

				console.log(`  Power Score: ${scoreColor(`${stats.powerScore}/100`)}`);

				const features = [
					{
						name: "Agent-driven workflow",
						used: (stats.commandCounts.agent || 0) > 0,
						points: 30,
					},
					{
						name: "Strict memory enforcement",
						used: stats.featureFlags.strict_memory,
						points: 20,
					},
					{
						name: "Task-driven work",
						used: stats.featureFlags.task_driven,
						points: 20,
					},
					{
						name: "Finalize automation",
						used: (stats.commandCounts.finalize || 0) > 0,
						points: 15,
					},
					{
						name: "Context search",
						used:
							(stats.commandCounts.search || 0) > 0 ||
							(stats.commandCounts.ask || 0) > 0,
						points: 10,
					},
					{
						name: "Archive management",
						used: (stats.commandCounts.archive || 0) > 0,
						points: 5,
					},
				];

				console.log(chalk.gray("\n  Features:"));
				for (const feature of features) {
					const icon = feature.used ? chalk.green("✓") : chalk.gray("○");
					const name = feature.used
						? chalk.white(feature.name)
						: chalk.gray(feature.name);
					const pts = feature.used
						? chalk.green(`+${feature.points}`)
						: chalk.gray(`+${feature.points}`);
					console.log(`    ${icon} ${name} ${pts}`);
				}

				if (stats.powerScore < 40) {
					console.log(
						chalk.yellow(
							"\n  💡 Tip: Try 'vem agent' to unlock powerful workflows",
						),
					);
				} else if (stats.powerScore < 70) {
					console.log(
						chalk.cyan(
							"\n  💡 You're on your way! Keep using task-driven workflows",
						),
					);
				} else {
					console.log(
						chalk.green("\n  🎉 Excellent! You're using VEM like a pro"),
					);
				}

				// Recent Activity
				if (stats.lastAgentRun) {
					const timeSince = Date.now() - stats.lastAgentRun;
					const days = Math.floor(timeSince / (1000 * 60 * 60 * 24));
					console.log(chalk.bold("\n📅 Recent Activity\n"));
					console.log(
						`  Last agent session: ${days === 0 ? "today" : `${days} days ago`}`,
					);
				}

				renderUsageInsights(stats, false);

				console.log("");
			} catch (error: any) {
				console.error(chalk.red("\n✖ Failed to check status:"), error.message);
			}
		});

	program
		.command("insights")
		.description("Show detailed usage metrics and workflow insights")
		.option("--json", "Output raw usage metrics as JSON")
		.action(async (options: { json?: boolean }) => {
			await trackCommandUsage("insights");
			try {
				await ensureVemFiles();
				const stats = await metricsService.getStats();

				if (options.json) {
					console.log(JSON.stringify(stats, null, 2));
					return;
				}

				console.log(chalk.bold("\n📊 vem Insights\n"));
				console.log(`Power Score: ${chalk.cyan(`${stats.powerScore}/100`)}`);
				renderUsageInsights(stats, true);
				console.log("");
			} catch (error: any) {
				console.error(chalk.red("\n✖ Failed to load insights:"), error.message);
			}
		});
}
