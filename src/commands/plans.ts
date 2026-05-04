import fs from "node:fs";
import { ConfigService } from "@vem/core";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

import {
	API_URL,
	buildDeviceHeaders,
	trackCommandUsage,
	tryAuthenticatedKey,
} from "../runtime.js";

interface ProjectPlan {
	id: string;
	project_id: string;
	task_run_id: string | null;
	created_by: string | null;
	source: "agent" | "human";
	title: string;
	body: string | null;
	status: "pending" | "approved" | "rejected" | "done";
	approved_by: string | null;
	approved_at: string | null;
	plan_branch_name: string | null;
	created_at: string;
	updated_at: string;
}

const STATUS_CHALK: Record<ProjectPlan["status"], (s: string) => string> = {
	pending: (s) => chalk.yellow(s),
	approved: (s) => chalk.green(s),
	rejected: (s) => chalk.red(s),
	done: (s) => chalk.gray(s),
};

export function registerPlanCommands(program: Command) {
	const configService = new ConfigService();

	const planCmd = program.command("plan").description("Manage project plans");

	// ── vem plan list ──────────────────────────────────────────────────────────

	planCmd
		.command("list")
		.description("List plans for the current project")
		.option(
			"--status <status>",
			"Filter by status: pending|approved|rejected|done",
		)
		.option("--json", "Output as JSON")
		.action(async (opts) => {
			await trackCommandUsage("plan:list");

			const apiKey = await tryAuthenticatedKey(configService);
			if (!apiKey) {
				console.error(chalk.red("Not authenticated. Run `vem login` first."));
				process.exit(1);
			}

			const projectId = await configService.getProjectId();
			if (!projectId) {
				console.error(
					chalk.red("No project configured. Run `vem setup` first."),
				);
				process.exit(1);
			}

			const params = opts.status
				? `?status=${encodeURIComponent(opts.status)}`
				: "";
			const deviceHeaders = await buildDeviceHeaders(configService);

			let plans: ProjectPlan[];
			try {
				const res = await fetch(
					`${API_URL}/projects/${projectId}/project-plans${params}`,
					{
						headers: {
							Authorization: `Bearer ${apiKey}`,
							...deviceHeaders,
						},
					},
				);
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				const data = await res.json();
				plans = data.plans ?? [];
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to list plans: ${err instanceof Error ? err.message : err}`,
					),
				);
				process.exit(1);
			}

			if (opts.json) {
				console.log(JSON.stringify(plans, null, 2));
				return;
			}

			if (plans.length === 0) {
				console.log(chalk.gray("No plans found."));
				return;
			}

			const table = new Table({
				head: ["ID", "Title", "Status", "Source", "Created"].map((h) =>
					chalk.bold(h),
				),
				style: { head: [], border: [] },
				colWidths: [10, 40, 10, 8, 14],
				wordWrap: true,
			});

			for (const plan of plans) {
				const statusLabel = STATUS_CHALK[plan.status](
					plan.status.charAt(0).toUpperCase() + plan.status.slice(1),
				);
				table.push([
					plan.id.slice(0, 8),
					plan.title,
					statusLabel,
					plan.source,
					new Date(plan.created_at).toLocaleDateString(),
				]);
			}

			console.log(table.toString());
		});

	// ── vem plan get ──────────────────────────────────────────────────────────

	planCmd
		.command("get <plan-id>")
		.description("Show the full content of a plan")
		.option("--json", "Output as JSON")
		.action(async (planId, opts) => {
			await trackCommandUsage("plan:get");

			const apiKey = await tryAuthenticatedKey(configService);
			if (!apiKey) {
				console.error(chalk.red("Not authenticated. Run `vem login` first."));
				process.exit(1);
			}

			const deviceHeaders = await buildDeviceHeaders(configService);

			let plan: ProjectPlan;
			try {
				const res = await fetch(`${API_URL}/project-plans/${planId}`, {
					headers: {
						Authorization: `Bearer ${apiKey}`,
						...deviceHeaders,
					},
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				const data = await res.json();
				plan = data.plan;
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to get plan: ${err instanceof Error ? err.message : err}`,
					),
				);
				process.exit(1);
			}

			if (opts.json) {
				console.log(JSON.stringify(plan, null, 2));
				return;
			}

			const statusFn = STATUS_CHALK[plan.status] ?? ((s: string) => s);

			console.log();
			console.log(chalk.bold(plan.title));
			console.log(
				chalk.gray(
					`${statusFn(plan.status)}  ·  ${plan.source}  ·  ${new Date(plan.created_at).toLocaleDateString()}`,
				),
			);
			if (plan.task_run_id) {
				console.log(chalk.gray(`Run: ${plan.task_run_id}`));
			}
			console.log();
			if (plan.body) {
				console.log(plan.body);
			} else {
				console.log(chalk.gray("(no content)"));
			}
			console.log();
		});

	// ── vem plan create ───────────────────────────────────────────────────────

	planCmd
		.command("create")
		.description("Create a new plan manually")
		.requiredOption("--title <title>", "Plan title")
		.option("--body <body>", "Plan body (markdown text)")
		.option("--file <path>", "Path to a markdown file to use as the plan body")
		.action(async (opts) => {
			await trackCommandUsage("plan:create");

			const apiKey = await tryAuthenticatedKey(configService);
			if (!apiKey) {
				console.error(chalk.red("Not authenticated. Run `vem login` first."));
				process.exit(1);
			}

			const projectId = await configService.getProjectId();
			if (!projectId) {
				console.error(
					chalk.red("No project configured. Run `vem setup` first."),
				);
				process.exit(1);
			}

			let body: string | undefined = opts.body;

			if (opts.file) {
				try {
					body = fs.readFileSync(opts.file, "utf-8");
				} catch (err) {
					console.error(
						chalk.red(
							`Failed to read file: ${err instanceof Error ? err.message : err}`,
						),
					);
					process.exit(1);
				}
			}

			const deviceHeaders = await buildDeviceHeaders(configService);

			let plan: ProjectPlan;
			try {
				const res = await fetch(
					`${API_URL}/projects/${projectId}/project-plans`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${apiKey}`,
							...deviceHeaders,
						},
						body: JSON.stringify({
							title: opts.title,
							body,
							source: "human",
						}),
					},
				);
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				const data = await res.json();
				plan = data.plan;
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to create plan: ${err instanceof Error ? err.message : err}`,
					),
				);
				process.exit(1);
			}

			console.log(chalk.green(`✓ Plan created: ${plan.id}`));
			console.log(chalk.bold(plan.title));
			console.log(
				chalk.gray(`Status: ${plan.status}  ·  Source: ${plan.source}`),
			);
		});

	planCmd
		.command("run-tasks <plan-id>")
		.description(
			"Queue all linked tasks from a plan for agent execution (shared PR branch)",
		)
		.option(
			"--backend <backend>",
			"Execution backend (local_sandbox, local_runner, sandbox_job)",
			"local_sandbox",
		)
		.option("--yes", "Skip confirmation prompt")
		.action(async (planId: string, opts) => {
			await trackCommandUsage("plan:run-tasks");

			const apiKey = await tryAuthenticatedKey(configService);
			if (!apiKey) {
				console.error(chalk.red("Not authenticated. Run `vem login` first."));
				process.exit(1);
			}

			const projectId = await configService.getProjectId();
			if (!projectId) {
				console.error(
					chalk.red("No project configured. Run `vem setup` first."),
				);
				process.exit(1);
			}

			const validBackends = ["local_sandbox", "local_runner", "sandbox_job"];
			if (!validBackends.includes(opts.backend)) {
				console.error(
					chalk.red(
						`Invalid backend: ${opts.backend}. Use one of: ${validBackends.join(", ")}`,
					),
				);
				process.exit(1);
			}

			const deviceHeaders = await buildDeviceHeaders(configService);

			// Fetch plan info
			let plan: ProjectPlan;
			try {
				const res = await fetch(`${API_URL}/project-plans/${planId}`, {
					headers: { Authorization: `Bearer ${apiKey}`, ...deviceHeaders },
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				const data = await res.json();
				plan = data.plan;
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to fetch plan: ${err instanceof Error ? err.message : err}`,
					),
				);
				process.exit(1);
			}

			if (plan.status !== "approved") {
				console.error(
					chalk.red(
						`Plan is not approved (status: ${plan.status}). Only approved plans can have tasks run.`,
					),
				);
				process.exit(1);
			}

			console.log(chalk.bold(`\n${plan.title}`));
			console.log(chalk.gray(`Plan ID: ${plan.id}`));
			if (plan.plan_branch_name) {
				console.log(chalk.cyan(`Shared branch: ${plan.plan_branch_name}`));
			} else {
				console.log(
					chalk.cyan("A shared branch will be created for all task runs."),
				);
			}
			console.log(chalk.gray(`Backend: ${opts.backend}\n`));

			if (!opts.yes) {
				const { default: readline } = await import("node:readline");
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});
				const confirmed = await new Promise<boolean>((resolve) => {
					rl.question(
						chalk.yellow("Queue all linked tasks for agent execution? (y/N) "),
						(answer) => {
							rl.close();
							resolve(answer.trim().toLowerCase() === "y");
						},
					);
				});
				if (!confirmed) {
					console.log(chalk.gray("Cancelled."));
					process.exit(0);
				}
			}

			// Queue all tasks
			let result: {
				queued: number;
				skipped: number;
				task_run_ids: string[];
				plan_branch_name: string | null;
				warning?: string;
				errors: string[];
			};
			try {
				const res = await fetch(
					`${API_URL}/project-plans/${planId}/run-tasks`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${apiKey}`,
							...deviceHeaders,
						},
						body: JSON.stringify({ execution_backend: opts.backend }),
					},
				);
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				result = await res.json();
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to queue tasks: ${err instanceof Error ? err.message : err}`,
					),
				);
				process.exit(1);
			}

			if (result.queued > 0) {
				console.log(
					chalk.green(
						`✓ Queued ${result.queued} task${result.queued !== 1 ? "s" : ""} for agent execution`,
					),
				);
			}
			if (result.skipped > 0) {
				console.log(
					chalk.gray(
						`  ${result.skipped} task${result.skipped !== 1 ? "s" : ""} skipped (already running or done)`,
					),
				);
			}
			if (result.plan_branch_name) {
				console.log(chalk.cyan(`  Shared branch: ${result.plan_branch_name}`));
			}
			if (result.warning) {
				console.log(chalk.yellow(`  ⚠ ${result.warning}`));
			}
			if (result.errors.length > 0) {
				console.log(chalk.red(`  ${result.errors.length} error(s):`));
				for (const e of result.errors) {
					console.log(chalk.red(`    - ${e}`));
				}
			}
		});

	planCmd
		.command("cancel-tasks <plan-id>")
		.description(
			"Cancel all active task runs for a plan, optionally deleting the shared branch",
		)
		.option("--delete-branch", "Also delete the shared GitHub PR branch")
		.option("--yes", "Skip confirmation prompt")
		.action(async (planId: string, opts) => {
			await trackCommandUsage("plan:cancel-tasks");

			const apiKey = await tryAuthenticatedKey(configService);
			if (!apiKey) {
				console.error(chalk.red("Not authenticated. Run `vem login` first."));
				process.exit(1);
			}

			const projectId = await configService.getProjectId();
			if (!projectId) {
				console.error(
					chalk.red("No project configured. Run `vem setup` first."),
				);
				process.exit(1);
			}

			const deviceHeaders = await buildDeviceHeaders(configService);

			// Fetch plan info
			let plan: ProjectPlan;
			try {
				const res = await fetch(`${API_URL}/project-plans/${planId}`, {
					headers: { Authorization: `Bearer ${apiKey}`, ...deviceHeaders },
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				const data = await res.json();
				plan = data.plan;
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to fetch plan: ${err instanceof Error ? err.message : err}`,
					),
				);
				process.exit(1);
			}

			console.log(chalk.bold(`\n${plan.title}`));
			console.log(chalk.gray(`Plan ID: ${plan.id}`));
			if (plan.plan_branch_name) {
				console.log(chalk.gray(`Shared branch: ${plan.plan_branch_name}`));
			}
			if (opts.deleteBranch && !plan.plan_branch_name) {
				console.log(chalk.yellow("  ⚠ No shared branch found on this plan."));
			}
			console.log();

			if (!opts.yes) {
				const { default: readline } = await import("node:readline");
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});
				const prompt = opts.deleteBranch
					? chalk.yellow(
							"Cancel all active runs AND delete the shared branch? (y/N) ",
						)
					: chalk.yellow("Cancel all active task runs for this plan? (y/N) ");
				const confirmed = await new Promise<boolean>((resolve) => {
					rl.question(prompt, (answer) => {
						rl.close();
						resolve(answer.trim().toLowerCase() === "y");
					});
				});
				if (!confirmed) {
					console.log(chalk.gray("Cancelled."));
					process.exit(0);
				}
			}

			let result: {
				cancelled: number;
				branch_deleted: boolean;
				errors: string[];
				message: string;
			};
			try {
				const res = await fetch(
					`${API_URL}/project-plans/${planId}/cancel-tasks`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${apiKey}`,
							...deviceHeaders,
						},
						body: JSON.stringify({ delete_branch: opts.deleteBranch ?? false }),
					},
				);
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error ?? `HTTP ${res.status}`,
					);
				}
				result = await res.json();
			} catch (err) {
				console.error(
					chalk.red(`Failed: ${err instanceof Error ? err.message : err}`),
				);
				process.exit(1);
			}

			if (result.cancelled > 0) {
				console.log(
					chalk.green(
						`✓ ${result.cancelled} task run${result.cancelled !== 1 ? "s" : ""} cancelled`,
					),
				);
			} else {
				console.log(chalk.gray(result.message));
			}
			if (result.branch_deleted) {
				console.log(chalk.red("  Shared branch deleted"));
			}
			if (result.errors.length > 0) {
				console.log(chalk.red(`  ${result.errors.length} error(s):`));
				for (const e of result.errors) {
					console.log(chalk.red(`    - ${e}`));
				}
			}
		});
}
