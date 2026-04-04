import type { Cycle } from "@vem/schemas";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

import { cycleService, taskService, trackCommandUsage } from "../runtime.js";

const APPETITE_LABELS: Record<string, string> = {
	small: "~1 week",
	medium: "~2 weeks",
	large: "~4–6 weeks",
};

const STATUS_LABEL: Record<Cycle["status"], string> = {
	planned: chalk.gray("PLANNED"),
	active: chalk.cyan("ACTIVE"),
	closed: chalk.green("CLOSED"),
};

export function registerCycleCommands(program: Command) {
	const cycleCmd = program
		.command("cycle")
		.description("Manage goal cycles (Context-Flow)");

	cycleCmd
		.command("list")
		.description("List all cycles")
		.action(async () => {
			await trackCommandUsage("cycle list");
			try {
				const cycles = await cycleService.getCycles();
				if (cycles.length === 0) {
					console.log(
						chalk.gray(
							"\n  No cycles yet. Create one with: vem cycle create\n",
						),
					);
					return;
				}

				const table = new Table({
					head: ["ID", "Status", "Name", "Goal", "Appetite", "Start"],
					style: { head: ["cyan"] },
					colWidths: [12, 10, 24, 40, 12, 14],
					wordWrap: true,
				});

				for (const c of cycles) {
					table.push([
						chalk.white(c.id),
						STATUS_LABEL[c.status] ?? chalk.gray(c.status),
						c.name,
						chalk.gray(c.goal.length > 38 ? `${c.goal.slice(0, 38)}…` : c.goal),
						c.appetite
							? chalk.gray(APPETITE_LABELS[c.appetite] ?? c.appetite)
							: chalk.gray("—"),
						c.start_at
							? chalk.white(
									new Date(c.start_at).toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									}),
								)
							: chalk.gray("—"),
					]);
				}

				console.log(chalk.bold("\n🔄  Cycles\n"));
				console.log(table.toString());
				console.log();
			} catch (error: any) {
				console.error(chalk.red(`Failed to list cycles: ${error.message}`));
			}
		});

	cycleCmd
		.command("create [name]")
		.description("Create a new goal cycle")
		.option(
			"--goal <text>",
			"The outcome this cycle is working towards (required)",
		)
		.option(
			"--appetite <size>",
			"Time budget: small (~1w), medium (~2w), large (~4-6w)",
		)
		.option("--start-at <iso>", "Start date ISO string (YYYY-MM-DD)")
		.action(async (name, options) => {
			await trackCommandUsage("cycle create");
			try {
				const cycleName =
					typeof name === "string" && name.trim().length > 0
						? name.trim()
						: undefined;
				const goalInput =
					typeof options.goal === "string" ? options.goal.trim() : undefined;
				const appetiteInput =
					typeof options.appetite === "string"
						? options.appetite.trim()
						: undefined;

				if (!cycleName || !goalInput) {
					console.error(
						chalk.red(
							'\n✖ Both a name and --goal are required.\n  Example: vem cycle create "Auth hardening" --goal "Harden auth flows and add MFA" --appetite medium\n',
						),
					);
					process.exitCode = 1;
					return;
				}

				const validAppetites = new Set(["small", "medium", "large"]);
				if (appetiteInput && !validAppetites.has(appetiteInput)) {
					console.error(
						chalk.red(
							`\n✖ Invalid appetite "${appetiteInput}". Use: small, medium, large\n`,
						),
					);
					process.exitCode = 1;
					return;
				}

				const startAt =
					typeof options.startAt === "string" && options.startAt.trim()
						? new Date(
								options.startAt.length === 10
									? `${options.startAt}T00:00:00.000Z`
									: options.startAt,
							).toISOString()
						: undefined;

				const cycle = await cycleService.createCycle({
					name: cycleName,
					goal: goalInput,
					appetite: appetiteInput as Cycle["appetite"],
					start_at: startAt,
				});

				console.log(chalk.green(`\n✔ Cycle created: ${cycle.id}\n`));
				console.log(`  ${chalk.white(cycle.name)}`);
				console.log(`  ${chalk.gray("Goal:")} ${cycle.goal}`);
				if (cycle.appetite) {
					console.log(
						`  ${chalk.gray("Appetite:")} ${APPETITE_LABELS[cycle.appetite] ?? cycle.appetite}`,
					);
				}
				console.log(
					chalk.gray(
						`\n  Tip: Start it with \`vem cycle start ${cycle.id}\` then assign tasks with \`vem task update <id> --cycle ${cycle.id}\`\n`,
					),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to create cycle: ${error.message}`));
			}
		});

	cycleCmd
		.command("start <id>")
		.description("Mark a cycle as active")
		.action(async (id) => {
			await trackCommandUsage("cycle start");
			try {
				const cycle = await cycleService.getCycle(id);
				if (!cycle) {
					console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
					process.exitCode = 1;
					return;
				}
				if (cycle.status === "active") {
					console.log(chalk.yellow(`\n  Cycle ${id} is already active.\n`));
					return;
				}
				const existing = await cycleService.getActiveCycle();
				if (existing && existing.id !== id) {
					console.error(
						chalk.yellow(
							`\n⚠  Another cycle is already active: ${existing.id} (${existing.name})\n  Close it first with: vem cycle close ${existing.id}\n`,
						),
					);
					process.exitCode = 1;
					return;
				}
				const updated = await cycleService.updateCycle(id, {
					status: "active",
				});
				console.log(chalk.cyan(`\n✔ Cycle ${id} is now active\n`));
				console.log(`  ${chalk.white(updated.name)}`);
				console.log(`  ${chalk.gray("Goal:")} ${updated.goal}`);
				console.log();
			} catch (error: any) {
				console.error(chalk.red(`Failed to start cycle: ${error.message}`));
			}
		});

	cycleCmd
		.command("close <id>")
		.description("Close a cycle")
		.action(async (id) => {
			await trackCommandUsage("cycle close");
			try {
				const cycle = await cycleService.getCycle(id);
				if (!cycle) {
					console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
					process.exitCode = 1;
					return;
				}
				if (cycle.status === "closed") {
					console.log(chalk.yellow(`\n  Cycle ${id} is already closed.\n`));
					return;
				}
				const updated = await cycleService.updateCycle(id, {
					status: "closed",
				});
				console.log(chalk.green(`\n✔ Cycle ${id} closed\n`));

				// Show a brief summary of tasks in this cycle
				const tasks = await taskService.getTasks();
				const cycleTasks = tasks.filter(
					(t) => (t as any).cycle_id === id && !t.deleted_at,
				);
				if (cycleTasks.length > 0) {
					const done = cycleTasks.filter((t) => t.status === "done").length;
					const total = cycleTasks.length;
					console.log(
						`  ${chalk.gray("Tasks:")} ${chalk.green(String(done))} done / ${chalk.white(String(total))} total`,
					);
				}
				console.log(
					chalk.gray(
						`  Closed: ${new Date(updated.closed_at!).toLocaleDateString()}\n`,
					),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to close cycle: ${error.message}`));
			}
		});

	cycleCmd
		.command("focus [id]")
		.description(
			"Show focused view: active cycle goal + its tasks (defaults to active cycle)",
		)
		.action(async (id) => {
			await trackCommandUsage("cycle focus");
			try {
				let cycle: Cycle | null = null;
				if (id) {
					cycle = await cycleService.getCycle(id);
					if (!cycle) {
						console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
						process.exitCode = 1;
						return;
					}
				} else {
					cycle = await cycleService.getActiveCycle();
					if (!cycle) {
						console.log(
							chalk.yellow(
								"\n  No active cycle. Start one with: vem cycle start <id>\n",
							),
						);
						return;
					}
				}

				console.log(chalk.bold(`\n🎯  ${cycle.id}: ${cycle.name}\n`));
				console.log(
					`  ${chalk.gray("Status:")} ${STATUS_LABEL[cycle.status] ?? chalk.gray(cycle.status)}`,
				);
				console.log(`  ${chalk.gray("Goal:")}   ${chalk.white(cycle.goal)}`);
				if (cycle.appetite) {
					console.log(
						`  ${chalk.gray("Appetite:")} ${APPETITE_LABELS[cycle.appetite] ?? cycle.appetite}`,
					);
				}
				if (cycle.start_at) {
					console.log(
						`  ${chalk.gray("Started:")} ${new Date(cycle.start_at).toLocaleDateString()}`,
					);
				}

				const tasks = await taskService.getTasks();
				const cycleTasks = tasks.filter(
					(t) => (t as any).cycle_id === cycle!.id && !t.deleted_at,
				);

				if (cycleTasks.length === 0) {
					console.log(
						chalk.gray(
							`\n  No tasks assigned to this cycle yet.\n  Assign with: vem task update <id> --cycle ${cycle.id}\n`,
						),
					);
					return;
				}

				const statusOrder: Record<string, number> = {
					"in-progress": 0,
					"in-review": 1,
					ready: 2,
					todo: 3,
					blocked: 4,
					done: 5,
				};
				cycleTasks.sort(
					(a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9),
				);

				const table = new Table({
					head: ["ID", "Status", "Title", "Priority", "Score"],
					style: { head: ["cyan"] },
					colWidths: [12, 10, 44, 10, 8],
					wordWrap: true,
				});

				const fmtStatus = (s: string) => {
					switch (s) {
						case "in-progress":
							return chalk.blue("IN PROG");
						case "in-review":
							return chalk.magenta("IN REVW");
						case "ready":
							return chalk.cyan("READY");
						case "blocked":
							return chalk.yellow("BLOCKED");
						case "done":
							return chalk.green("DONE");
						default:
							return chalk.gray("TODO");
					}
				};

				for (const t of cycleTasks) {
					const score = (t as any).impact_score;
					table.push([
						chalk.white(t.id),
						fmtStatus(t.status),
						t.title,
						t.priority
							? t.priority === "high" || t.priority === "critical"
								? chalk.red(t.priority)
								: chalk.white(t.priority)
							: chalk.gray("—"),
						score !== undefined
							? chalk.yellow(String(Math.round(score)))
							: chalk.gray("—"),
					]);
				}

				const done = cycleTasks.filter((t) => t.status === "done").length;
				console.log(
					`\n  ${chalk.white(String(done))}/${chalk.white(String(cycleTasks.length))} tasks done\n`,
				);
				console.log(table.toString());
				console.log();
			} catch (error: any) {
				console.error(
					chalk.red(`Failed to show cycle focus: ${error.message}`),
				);
			}
		});
}
