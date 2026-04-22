import { ConfigService } from "@vem/core";
import type { Cycle } from "@vem/schemas";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

import {
	API_URL,
	buildDeviceHeaders,
	cycleService,
	taskService,
	trackCommandUsage,
	tryAuthenticatedKey,
} from "../runtime.js";

const APPETITE_LABELS: Record<string, string> = {
	small: "~1 week",
	medium: "~2 weeks",
	large: "~4–6 weeks",
};

const STATUS_LABEL: Record<Cycle["status"], string> = {
	planned: chalk.gray("PLANNED"),
	active: chalk.cyan("ACTIVE"),
	closed: chalk.green("CLOSED"),
	archived: chalk.gray("ARCHIVED"),
};

type RemoteAuthContext = {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
};

type RemoteTask = {
	id: string;
	title: string;
	status: string;
	priority?: string;
	impact_score?: number;
};

type RemoteResult<T> =
	| { ok: true; data: T }
	| {
			ok: false;
			reason: "project_missing" | "network" | "http" | "auth";
			message: string;
			status?: number;
	  };

const STATUS_ORDER: Record<string, number> = {
	"in-progress": 0,
	"in-review": 1,
	ready: 2,
	todo: 3,
	blocked: 4,
	done: 5,
};

const VALID_APPETITES = new Set(["small", "medium", "large"]);
const VALID_CYCLE_STATUSES = new Set([
	"planned",
	"active",
	"closed",
	"archived",
]);

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asIso(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return undefined;
	return parsed.toISOString();
}

function normalizeRemoteCycle(input: unknown): Cycle | null {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	const id = asTrimmedString(record.id);
	const name = asTrimmedString(record.name);
	const goal = asTrimmedString(record.goal);
	const statusRaw = asTrimmedString(record.status);
	if (!id || !name || !goal || !statusRaw) return null;
	if (!VALID_CYCLE_STATUSES.has(statusRaw)) return null;
	const appetiteRaw = asTrimmedString(record.appetite);
	const appetite =
		appetiteRaw && VALID_APPETITES.has(appetiteRaw) ? appetiteRaw : undefined;
	const now = new Date().toISOString();
	return {
		id,
		name,
		goal,
		appetite: appetite as Cycle["appetite"],
		status: statusRaw as Cycle["status"],
		start_at: asIso(record.start_at),
		closed_at: asIso(record.closed_at),
		created_at: asIso(record.created_at) ?? now,
		updated_at: asIso(record.updated_at) ?? now,
	};
}

function normalizeRemoteTask(input: unknown): RemoteTask | null {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	const id = asTrimmedString(record.id);
	const title = asTrimmedString(record.title);
	const status = asTrimmedString(record.status);
	if (!id || !title || !status) return null;
	const impactRaw = record.impact_score;
	return {
		id,
		title,
		status,
		priority: asTrimmedString(record.priority),
		impact_score:
			typeof impactRaw === "number" && Number.isFinite(impactRaw)
				? impactRaw
				: undefined,
	};
}

function formatTaskStatus(status: string): string {
	switch (status) {
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
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function renderCycleList(cycles: Cycle[]) {
	if (cycles.length === 0) {
		console.log(
			chalk.gray("\n  No cycles yet. Create one with: vem cycle create\n"),
		);
		return;
	}

	const table = new Table({
		head: ["ID", "Status", "Name", "Goal", "Appetite", "Start"],
		style: { head: ["cyan"] },
		colWidths: [12, 10, 24, 40, 12, 14],
		wordWrap: true,
	});

	for (const cycle of cycles) {
		table.push([
			chalk.white(cycle.id),
			STATUS_LABEL[cycle.status] ?? chalk.gray(cycle.status),
			cycle.name,
			chalk.gray(
				cycle.goal.length > 38 ? `${cycle.goal.slice(0, 38)}…` : cycle.goal,
			),
			cycle.appetite
				? chalk.gray(APPETITE_LABELS[cycle.appetite] ?? cycle.appetite)
				: chalk.gray("—"),
			cycle.start_at
				? chalk.white(
						new Date(cycle.start_at).toLocaleDateString(undefined, {
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
}

function renderCycleFocus(cycle: Cycle, tasks: RemoteTask[]) {
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

	if (tasks.length === 0) {
		console.log(
			chalk.gray(
				`\n  No tasks assigned to this cycle yet.\n  Assign with: vem task update <id> --cycle ${cycle.id}\n`,
			),
		);
		return;
	}

	const sortedTasks = [...tasks].sort(
		(a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
	);

	const table = new Table({
		head: ["ID", "Status", "Title", "Priority", "Score"],
		style: { head: ["cyan"] },
		colWidths: [12, 10, 44, 10, 8],
		wordWrap: true,
	});

	for (const task of sortedTasks) {
		table.push([
			chalk.white(task.id),
			formatTaskStatus(task.status),
			task.title,
			task.priority
				? task.priority === "high" || task.priority === "critical"
					? chalk.red(task.priority)
					: chalk.white(task.priority)
				: chalk.gray("—"),
			task.impact_score !== undefined
				? chalk.yellow(String(Math.round(task.impact_score)))
				: chalk.gray("—"),
		]);
	}

	const done = sortedTasks.filter((task) => task.status === "done").length;
	console.log(
		`\n  ${chalk.white(String(done))}/${chalk.white(String(sortedTasks.length))} tasks done\n`,
	);
	console.log(table.toString());
	console.log();
}

export function registerCycleCommands(program: Command) {
	const cycleCmd = program
		.command("cycle")
		.description("Manage goal cycles (Context-Flow)");

	const resolveRemoteAuth = async (): Promise<RemoteAuthContext | null> => {
		const configService = new ConfigService();
		const [apiKey, projectId] = await Promise.all([
			tryAuthenticatedKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return null;
		return { configService, apiKey, projectId };
	};

	const requestRemoteJson = async <T>(
		auth: RemoteAuthContext,
		path: string,
		init?: RequestInit,
	): Promise<RemoteResult<T>> => {
		try {
			const response = await fetch(`${API_URL}${path}`, {
				...init,
				headers: {
					...(init?.headers || {}),
					Authorization: `Bearer ${auth.apiKey}`,
					...(await buildDeviceHeaders(auth.configService)),
				},
			});

			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				[key: string]: unknown;
			};
			if (!response.ok) {
				const message = body.error || response.statusText || "Request failed";
				if (response.status === 401 || response.status === 403) {
					return {
						ok: false,
						reason: "auth",
						message,
						status: response.status,
					};
				}
				if (
					response.status === 404 &&
					message.toLowerCase().includes("project")
				) {
					return {
						ok: false,
						reason: "project_missing",
						message,
						status: response.status,
					};
				}
				return {
					ok: false,
					reason: "http",
					message,
					status: response.status,
				};
			}
			return { ok: true, data: body as T };
		} catch (error) {
			return {
				ok: false,
				reason: "network",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};

	const warnFallbackToLocal = (message?: string) => {
		console.log(
			chalk.yellow(
				`⚠ Cloud cycle service unavailable, using local .vem/cycles fallback${message ? ` (${message})` : ""}.`,
			),
		);
	};

	const showProjectMissingMessage = () => {
		console.error(
			chalk.red(
				"Linked project not found. Run `vem unlink` then `vem link` to reconnect.",
			),
		);
	};

	const cacheRemoteCycles = async (cycles: Cycle[]) => {
		try {
			await cycleService.replaceCycles(cycles);
		} catch {
			// cache update should not block command success
		}
	};

	const cacheRemoteCycle = async (cycle: Cycle) => {
		try {
			await cycleService.upsertCycle(cycle);
		} catch {
			// cache update should not block command success
		}
	};

	const getRemoteCycles = async (
		auth: RemoteAuthContext,
	): Promise<RemoteResult<Cycle[]>> => {
		const result = await requestRemoteJson<{ cycles?: unknown[] }>(
			auth,
			`/projects/${auth.projectId}/cycles`,
		);
		if (!result.ok) return result;
		const cycles = Array.isArray(result.data.cycles)
			? result.data.cycles
					.map((entry) => normalizeRemoteCycle(entry))
					.filter((entry): entry is Cycle => Boolean(entry))
			: [];
		return { ok: true, data: cycles };
	};

	const getRemoteCycle = async (
		auth: RemoteAuthContext,
		id: string,
	): Promise<RemoteResult<Cycle>> => {
		const result = await requestRemoteJson<{ cycle?: unknown }>(
			auth,
			`/projects/${auth.projectId}/cycles/${encodeURIComponent(id)}`,
		);
		if (!result.ok) return result;
		const cycle = normalizeRemoteCycle(result.data.cycle);
		if (!cycle) {
			return { ok: false, reason: "http", message: "Malformed cycle response" };
		}
		return { ok: true, data: cycle };
	};

	const createRemoteCycle = async (
		auth: RemoteAuthContext,
		payload: {
			name: string;
			goal: string;
			appetite?: Cycle["appetite"];
			start_at?: string;
		},
	): Promise<RemoteResult<Cycle>> => {
		const result = await requestRemoteJson<{ cycle?: unknown }>(
			auth,
			`/projects/${auth.projectId}/cycles`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
		if (!result.ok) return result;
		const cycle = normalizeRemoteCycle(result.data.cycle);
		if (!cycle) {
			return { ok: false, reason: "http", message: "Malformed cycle response" };
		}
		return { ok: true, data: cycle };
	};

	const updateRemoteCycleStatus = async (
		auth: RemoteAuthContext,
		id: string,
		status: Cycle["status"],
	): Promise<RemoteResult<Cycle>> => {
		const result = await requestRemoteJson<{ cycle?: unknown }>(
			auth,
			`/projects/${auth.projectId}/cycles/${encodeURIComponent(id)}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status }),
			},
		);
		if (!result.ok) return result;
		const cycle = normalizeRemoteCycle(result.data.cycle);
		if (!cycle) {
			return { ok: false, reason: "http", message: "Malformed cycle response" };
		}
		return { ok: true, data: cycle };
	};

	const getRemoteCycleTasks = async (
		auth: RemoteAuthContext,
		id: string,
	): Promise<RemoteResult<RemoteTask[]>> => {
		const result = await requestRemoteJson<{ tasks?: unknown[] }>(
			auth,
			`/projects/${auth.projectId}/cycles/${encodeURIComponent(id)}/tasks`,
		);
		if (!result.ok) return result;
		const tasks = Array.isArray(result.data.tasks)
			? result.data.tasks
					.map((entry) => normalizeRemoteTask(entry))
					.filter((entry): entry is RemoteTask => Boolean(entry))
			: [];
		return { ok: true, data: tasks };
	};

	cycleCmd
		.command("list")
		.description("List all cycles")
		.action(async () => {
			await trackCommandUsage("cycle list");
			try {
				const remoteAuth = await resolveRemoteAuth();
				if (remoteAuth) {
					const remoteCycles = await getRemoteCycles(remoteAuth);
					if (remoteCycles.ok) {
						await cacheRemoteCycles(remoteCycles.data);
						renderCycleList(remoteCycles.data);
						return;
					}
					if (remoteCycles.reason === "project_missing") {
						showProjectMissingMessage();
					} else {
						warnFallbackToLocal(remoteCycles.message);
					}
				}

				const cycles = await cycleService.getCycles();
				renderCycleList(cycles);
			} catch (error) {
				console.error(
					chalk.red(`Failed to list cycles: ${getErrorMessage(error)}`),
				);
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

				const remoteAuth = await resolveRemoteAuth();
				if (remoteAuth) {
					const remoteCreate = await createRemoteCycle(remoteAuth, {
						name: cycleName,
						goal: goalInput,
						appetite: appetiteInput as Cycle["appetite"],
						start_at: startAt,
					});
					if (remoteCreate.ok) {
						await cacheRemoteCycle(remoteCreate.data);
						const cycle = remoteCreate.data;
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
						return;
					}
					if (remoteCreate.reason === "project_missing") {
						showProjectMissingMessage();
						process.exitCode = 1;
						return;
					}
					warnFallbackToLocal(remoteCreate.message);
				}

				const localCycle = await cycleService.createCycle({
					name: cycleName,
					goal: goalInput,
					appetite: appetiteInput as Cycle["appetite"],
					start_at: startAt,
				});

				console.log(chalk.green(`\n✔ Cycle created: ${localCycle.id}\n`));
				console.log(`  ${chalk.white(localCycle.name)}`);
				console.log(`  ${chalk.gray("Goal:")} ${localCycle.goal}`);
				if (localCycle.appetite) {
					console.log(
						`  ${chalk.gray("Appetite:")} ${APPETITE_LABELS[localCycle.appetite] ?? localCycle.appetite}`,
					);
				}
				console.log(
					chalk.gray(
						`\n  Tip: Start it with \`vem cycle start ${localCycle.id}\` then assign tasks with \`vem task update <id> --cycle ${localCycle.id}\`\n`,
					),
				);
			} catch (error) {
				console.error(
					chalk.red(`Failed to create cycle: ${getErrorMessage(error)}`),
				);
			}
		});

	cycleCmd
		.command("start <id>")
		.description("Mark a cycle as active")
		.action(async (id) => {
			await trackCommandUsage("cycle start");
			try {
				const remoteAuth = await resolveRemoteAuth();
				if (remoteAuth) {
					const cycleResult = await getRemoteCycle(remoteAuth, id);
					if (cycleResult.ok) {
						if (cycleResult.data.status === "active") {
							console.log(chalk.yellow(`\n  Cycle ${id} is already active.\n`));
							return;
						}
						const remoteStart = await updateRemoteCycleStatus(
							remoteAuth,
							id,
							"active",
						);
						if (remoteStart.ok) {
							await cacheRemoteCycle(remoteStart.data);
							const updated = remoteStart.data;
							console.log(
								chalk.cyan(`\n✔ Cycle ${updated.id} is now active\n`),
							);
							console.log(`  ${chalk.white(updated.name)}`);
							console.log(`  ${chalk.gray("Goal:")} ${updated.goal}`);
							console.log();
							return;
						}
						if (remoteStart.reason === "project_missing") {
							showProjectMissingMessage();
							process.exitCode = 1;
							return;
						}
						if (remoteStart.status === 409) {
							console.error(chalk.yellow(`\n⚠  ${remoteStart.message}\n`));
							process.exitCode = 1;
							return;
						}
						warnFallbackToLocal(remoteStart.message);
					} else if (cycleResult.reason === "project_missing") {
						showProjectMissingMessage();
						process.exitCode = 1;
						return;
					} else if (cycleResult.status === 404) {
						console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
						process.exitCode = 1;
						return;
					} else {
						warnFallbackToLocal(cycleResult.message);
					}
				}

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
			} catch (error) {
				console.error(
					chalk.red(`Failed to start cycle: ${getErrorMessage(error)}`),
				);
			}
		});

	cycleCmd
		.command("close <id>")
		.description("Close a cycle")
		.action(async (id) => {
			await trackCommandUsage("cycle close");
			try {
				const remoteAuth = await resolveRemoteAuth();
				if (remoteAuth) {
					const cycleResult = await getRemoteCycle(remoteAuth, id);
					if (cycleResult.ok) {
						if (cycleResult.data.status === "closed") {
							console.log(chalk.yellow(`\n  Cycle ${id} is already closed.\n`));
							return;
						}
						const remoteClose = await updateRemoteCycleStatus(
							remoteAuth,
							id,
							"closed",
						);
						if (remoteClose.ok) {
							await cacheRemoteCycle(remoteClose.data);
							const updated = remoteClose.data;
							console.log(chalk.green(`\n✔ Cycle ${updated.id} closed\n`));
							const remoteTasks = await getRemoteCycleTasks(remoteAuth, id);
							if (remoteTasks.ok && remoteTasks.data.length > 0) {
								const done = remoteTasks.data.filter(
									(task) => task.status === "done",
								).length;
								const total = remoteTasks.data.length;
								console.log(
									`  ${chalk.gray("Tasks:")} ${chalk.green(String(done))} done / ${chalk.white(String(total))} total`,
								);
							}
							if (updated.closed_at) {
								console.log(
									chalk.gray(
										`  Closed: ${new Date(updated.closed_at).toLocaleDateString()}\n`,
									),
								);
							} else {
								console.log();
							}
							return;
						}
						if (remoteClose.reason === "project_missing") {
							showProjectMissingMessage();
							process.exitCode = 1;
							return;
						}
						warnFallbackToLocal(remoteClose.message);
					} else if (cycleResult.reason === "project_missing") {
						showProjectMissingMessage();
						process.exitCode = 1;
						return;
					} else if (cycleResult.status === 404) {
						console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
						process.exitCode = 1;
						return;
					} else {
						warnFallbackToLocal(cycleResult.message);
					}
				}

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

				const tasks = await taskService.getTasks();
				const cycleTasks = tasks.filter(
					(task) => task.cycle_id === id && !task.deleted_at,
				);
				if (cycleTasks.length > 0) {
					const done = cycleTasks.filter(
						(task) => task.status === "done",
					).length;
					const total = cycleTasks.length;
					console.log(
						`  ${chalk.gray("Tasks:")} ${chalk.green(String(done))} done / ${chalk.white(String(total))} total`,
					);
				}
				if (updated.closed_at) {
					console.log(
						chalk.gray(
							`  Closed: ${new Date(updated.closed_at).toLocaleDateString()}\n`,
						),
					);
				} else {
					console.log();
				}
			} catch (error) {
				console.error(
					chalk.red(`Failed to close cycle: ${getErrorMessage(error)}`),
				);
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
				const remoteAuth = await resolveRemoteAuth();
				if (remoteAuth) {
					let cycle: Cycle | null = null;
					if (id) {
						const cycleResult = await getRemoteCycle(remoteAuth, id);
						if (!cycleResult.ok) {
							if (cycleResult.reason === "project_missing") {
								showProjectMissingMessage();
								process.exitCode = 1;
								return;
							}
							if (cycleResult.status === 404) {
								console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
								process.exitCode = 1;
								return;
							}
							warnFallbackToLocal(cycleResult.message);
						} else {
							cycle = cycleResult.data;
						}
					} else {
						const cyclesResult = await getRemoteCycles(remoteAuth);
						if (!cyclesResult.ok) {
							if (cyclesResult.reason === "project_missing") {
								showProjectMissingMessage();
								process.exitCode = 1;
								return;
							}
							warnFallbackToLocal(cyclesResult.message);
						} else {
							cycle =
								cyclesResult.data.find((entry) => entry.status === "active") ??
								null;
							await cacheRemoteCycles(cyclesResult.data);
						}
					}

					if (cycle) {
						await cacheRemoteCycle(cycle);
						const tasksResult = await getRemoteCycleTasks(remoteAuth, cycle.id);
						if (!tasksResult.ok) {
							warnFallbackToLocal(tasksResult.message);
						} else {
							renderCycleFocus(cycle, tasksResult.data);
							return;
						}
					}
				}

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

				const tasks = await taskService.getTasks();
				const cycleTasks = tasks
					.filter((task) => task.cycle_id === cycle?.id && !task.deleted_at)
					.map((task) => ({
						id: task.id,
						title: task.title,
						status: task.status,
						priority: task.priority,
						impact_score: task.impact_score,
					}));

				renderCycleFocus(cycle, cycleTasks);
			} catch (error) {
				console.error(
					chalk.red(`Failed to show cycle focus: ${getErrorMessage(error)}`),
				);
			}
		});
}
