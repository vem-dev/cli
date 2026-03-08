import {
	type AgentSession,
	CHANGELOG_DIR,
	listAllAgentSessions,
	readCopilotSessionDetail,
	ScalableLogService,
	TaskService,
} from "@vem/core";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import prompts from "prompts";

import { getGitHash, trackCommandUsage } from "../runtime.js";

function formatDate(iso: string): string {
	if (!iso) return "—";
	const d = new Date(iso);
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

async function getCurrentGitRoot(): Promise<string | undefined> {
	try {
		const { execSync } = await import("node:child_process");
		return execSync("git rev-parse --show-toplevel", {
			encoding: "utf-8",
		}).trim();
	} catch {
		return undefined;
	}
}

export function registerSessionsCommands(program: Command) {
	const sessionsCmd = program
		.command("sessions")
		.description("Browse and import Copilot CLI agent sessions");

	// vem sessions — list recent sessions for current repo
	sessionsCmd
		.command("list", { isDefault: true })
		.description(
			"List recent agent sessions for this repository (Copilot, Claude, Gemini)",
		)
		.option("-n, --limit <number>", "Number of sessions to show", "20")
		.option("-b, --branch <branch>", "Filter by branch")
		.option("--all", "Show sessions from all repositories")
		.option(
			"--source <sources>",
			"Comma-separated sources to include: copilot,claude,gemini",
		)
		.action(async (opts) => {
			await trackCommandUsage("sessions.list");

			const gitRoot = opts.all ? undefined : await getCurrentGitRoot();
			const sources = opts.source
				? (opts.source.split(",").map((s: string) => s.trim()) as (
						| "copilot"
						| "claude"
						| "gemini"
					)[])
				: undefined;

			let sessions = await listAllAgentSessions(gitRoot, sources);

			if (opts.branch) {
				sessions = sessions.filter((s) => s.branch === opts.branch);
			}

			const limit = Number.parseInt(opts.limit, 10) || 20;
			sessions = sessions.slice(0, limit);

			if (sessions.length === 0) {
				console.log(chalk.gray("No agent sessions found for this repository."));
				return;
			}

			const sourceColor = (src: string) => {
				if (src === "copilot") return chalk.blue(src);
				if (src === "claude") return chalk.yellow(src);
				if (src === "gemini") return chalk.cyan(src);
				return chalk.gray(src);
			};

			const table = new Table({
				head: [
					chalk.bold("Source"),
					chalk.bold("ID"),
					chalk.bold("Summary"),
					chalk.bold("Branch"),
					chalk.bold("Updated"),
				],
				colWidths: [10, 12, 42, 18, 18],
				style: { head: [], border: ["gray"] },
			});

			for (const s of sessions) {
				table.push([
					sourceColor(s.source),
					chalk.gray(`${s.id.slice(0, 8)}…`),
					s.summary || chalk.gray("(no summary)"),
					chalk.cyan(s.branch || "—"),
					chalk.gray(formatDate(s.updated_at)),
				]);
			}

			console.log(table.toString());
			console.log(
				chalk.gray(
					`\nShowing ${sessions.length} session(s). Use ${chalk.white("vem sessions import <id>")} to import a session into project memory.`,
				),
			);
		});

	// vem sessions import <id> — interactive import into .vem/
	sessionsCmd
		.command("import <id>")
		.description("Import an agent session into vem project memory")
		.action(async (id: string) => {
			await trackCommandUsage("sessions.import");

			// Support partial id (prefix match) — search across all sources
			const gitRoot = await getCurrentGitRoot();
			let session: AgentSession | null = null;

			if (id.length < 36) {
				const all = await listAllAgentSessions(gitRoot);
				const match = all.find((s) => s.id.startsWith(id));
				if (!match) {
					console.error(chalk.red(`No session found matching prefix: ${id}`));
					process.exit(1);
				}
				session = match;
				console.log(
					chalk.gray(`Resolved to ${match.source} session: ${match.id}`),
				);
			} else {
				// Full id — try to find it across all sources
				const all = await listAllAgentSessions(gitRoot);
				session = all.find((s) => s.id === id) ?? null;

				// Fall back to Copilot detail reader for full intents
				if (!session) {
					const detail = await readCopilotSessionDetail(id);
					if (detail) {
						session = {
							id: detail.id,
							source: "copilot",
							summary: detail.summary,
							branch: detail.branch,
							repository: detail.repository,
							git_root: detail.git_root,
							cwd: detail.cwd,
							created_at: detail.created_at,
							updated_at: detail.updated_at,
							intents: detail.intents,
							user_messages: detail.user_messages,
						};
					}
				}
			}

			if (!session) {
				console.error(chalk.red(`Session not found: ${id}`));
				process.exit(1);
			}

			console.log(chalk.bold("\n📋 Session Summary"));
			console.log(chalk.white(`  ID:       ${session.id}`));
			console.log(chalk.white(`  Source:   ${session.source}`));
			console.log(chalk.white(`  Branch:   ${session.branch || "—"}`));
			console.log(chalk.white(`  Updated:  ${formatDate(session.updated_at)}`));
			console.log(
				chalk.white(`  Summary:  ${session.summary || "(no summary)"}`),
			);

			if (session.intents.length > 0) {
				console.log(chalk.bold("\n🎯 Intents recorded in this session:"));
				for (const intent of session.intents) {
					console.log(chalk.gray(`  • ${intent}`));
				}
			}

			if (session.user_messages.length > 0) {
				console.log(chalk.bold("\n💬 First user message:"));
				const preview = session.user_messages[0].slice(0, 200);
				console.log(
					chalk.gray(
						`  ${preview}${session.user_messages[0].length > 200 ? "…" : ""}`,
					),
				);
			}

			console.log();

			// Ask: add changelog entry?
			const { addChangelog } = await prompts({
				type: "confirm",
				name: "addChangelog",
				message: "Add session summary as a changelog entry?",
				initial: !!session.summary,
			});

			if (addChangelog) {
				const changelogEntry = session.summary
					? `${session.source} agent session (${session.branch || "unknown branch"}): ${session.summary}`
					: `${session.source} agent session (${session.branch || "unknown branch"}) on ${formatDate(session.updated_at)}`;

				const changelogLog = new ScalableLogService(CHANGELOG_DIR);
				const gitHash = getGitHash();
				await changelogLog.addEntry(
					"Session Import",
					`- ${changelogEntry}`,
					gitHash ? { commitHash: gitHash } : undefined,
				);
				console.log(chalk.green("✓ Changelog entry added."));
			}

			// Ask: link to a task?
			const taskService = new TaskService();
			const tasks = await taskService.getTasks();
			const activeTasks = tasks.filter(
				(t) => !t.deleted_at && t.status !== "done",
			);

			if (activeTasks.length > 0) {
				const { linkTask } = await prompts({
					type: "confirm",
					name: "linkTask",
					message: "Link this session to an active task (add evidence)?",
					initial: false,
				});

				if (linkTask) {
					const { taskId } = await prompts({
						type: "select",
						name: "taskId",
						message: "Which task?",
						choices: activeTasks.slice(0, 20).map((t) => ({
							title: `${t.id} — ${t.title}`,
							value: t.id,
						})),
					});

					if (taskId) {
						const evidenceLine = `Agent session ${session.id.slice(0, 8)}: ${session.summary || session.intents.slice(0, 2).join(", ") || "session imported"}`;
						const existingTask = await taskService.getTask(taskId);
						const existingSessions = (existingTask?.sessions as any[]) || [];
						const alreadyAttached = existingSessions.some(
							(s: any) => s.id === session.id,
						);
						const sessionRef = !alreadyAttached
							? {
									id: session.id,
									source: session.source,
									started_at: session.created_at,
									...(session.summary ? { summary: session.summary } : {}),
								}
							: null;
						await taskService.updateTask(taskId, {
							evidence: [evidenceLine],
							...(sessionRef
								? { sessions: [...existingSessions, sessionRef] }
								: {}),
						});
						console.log(
							chalk.green(`✓ Linked to task ${taskId} with evidence.`),
						);
					}
				}
			}

			console.log(chalk.bold("\n✅ Done."));
		});
}
