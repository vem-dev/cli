import {
	ConfigService,
	CycleRetrospectiveService,
	CycleValidationService,
	DECISIONS_DIR,
	ScalableLogService,
	SensorsService,
	ValidationRulesService,
} from "@vem/core";
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

const validationService = new CycleValidationService();
const retroService = new CycleRetrospectiveService();
const sensorsService = new SensorsService();
const rulesService = new ValidationRulesService();
const decisionsLog = new ScalableLogService(DECISIONS_DIR);

/** Load decisions from .vem/decisions/ and parse enforcement_pattern from markdown content */
async function loadDecisionsForDrift(): Promise<
	Array<{ id: string; title: string; enforcement_pattern?: string }>
> {
	const entries = await decisionsLog.getAllEntries();
	return entries
		.map((entry) => {
			const match = entry.content.match(/^enforcement_pattern:\s*(.+)$/m);
			return {
				id: entry.id,
				title: entry.title,
				enforcement_pattern: match ? match[1].trim() : undefined,
			};
		})
		.filter((d) => d.enforcement_pattern !== undefined);
}

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
	const dbId = asTrimmedString(record.db_id);
	return {
		id,
		...(dbId ? { db_id: dbId } : {}),
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
		.description(
			"Close a cycle (runs pre-flight validation and generates retrospective)",
		)
		.option("--strict", "Abort close if pre-flight validation fails")
		.option("--force", "Skip pre-flight validation and close immediately")
		.action(async (id, options: { strict?: boolean; force?: boolean }) => {
			await trackCommandUsage("cycle close");
			try {
				// ── Phase 0: Load cycle + tasks (needed for pre-flight + retro) ──────
				const remoteAuth = await resolveRemoteAuth();

				let preflightTasks: Array<{
					id: string;
					title: string;
					status: string;
					evidence?: string;
					blocked_reason?: string;
				}> = [];

				let remoteCycleData: Awaited<ReturnType<typeof getRemoteCycle>> | null =
					null;
				let remoteTasksData: Awaited<
					ReturnType<typeof getRemoteCycleTasks>
				> | null = null;

				if (remoteAuth) {
					remoteCycleData = await getRemoteCycle(remoteAuth, id);
					if (!remoteCycleData.ok) {
						if (remoteCycleData.reason === "project_missing") {
							showProjectMissingMessage();
							process.exitCode = 1;
							return;
						}
						if (remoteCycleData.status === 404) {
							console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
							process.exitCode = 1;
							return;
						}
						warnFallbackToLocal(remoteCycleData.message);
						remoteCycleData = null;
					} else {
						if (remoteCycleData.data.status === "closed") {
							console.log(chalk.yellow(`\n  Cycle ${id} is already closed.\n`));
							return;
						}
						remoteTasksData = await getRemoteCycleTasks(remoteAuth, id);
						if (remoteTasksData.ok) {
							preflightTasks = remoteTasksData.data.map((t) => ({
								id: t.id,
								title: t.title,
								status: t.status,
								evidence: undefined,
							}));
						}
					}
				}

				// Local cycle lookup if no remote
				let localCycle: Awaited<ReturnType<typeof cycleService.getCycle>> =
					null;
				let localTasksForCycle: Awaited<
					ReturnType<typeof taskService.getTasks>
				> = [];
				if (!remoteCycleData?.ok) {
					localCycle = await cycleService.getCycle(id);
					if (!localCycle) {
						console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
						process.exitCode = 1;
						return;
					}
					if (localCycle.status === "closed") {
						console.log(chalk.yellow(`\n  Cycle ${id} is already closed.\n`));
						return;
					}
					const allTasks = await taskService.getTasks();
					localTasksForCycle = allTasks.filter(
						(t) => t.cycle_id === id && !t.deleted_at,
					);
					preflightTasks = localTasksForCycle.map((t) => ({
						id: t.id,
						title: t.title,
						status: t.status,
						evidence: t.evidence ?? undefined,
					}));
				}

				// ── Phase 1: Pre-flight (before close) ─────────────────────────────
				let preflightPassed = true;
				if (!options.force && preflightTasks.length > 0) {
					const rules = await rulesService.readRules();
					console.log(chalk.gray("\n  Running pre-flight checks..."));
					const decisions = await loadDecisionsForDrift();
					const preflight = await validationService.runPreflight(
						preflightTasks,
						[],
						decisions,
						validationService.getGitDiffSince(),
						rules,
					);

					const hasErrors = preflight.errors.length > 0;
					const hasWarnings = preflight.warnings.length > 0;
					const overallStatus = hasErrors
						? "fail"
						: hasWarnings
							? "warn"
							: "pass";

					const statusDisplay = {
						pass: chalk.green("PASS"),
						warn: chalk.yellow("WARN"),
						fail: chalk.red("FAIL"),
					}[overallStatus];
					console.log(`  Pre-flight: ${statusDisplay}`);

					if (hasErrors) {
						for (const err of preflight.errors) {
							console.log(`    ${chalk.red("✗")} ${err}`);
						}
					} else if (hasWarnings) {
						for (const w of preflight.warnings.slice(0, 5)) {
							console.log(`    ${chalk.yellow("⚠")} ${w}`);
						}
					}

					if (options.strict && hasErrors) {
						console.error(
							chalk.red(
								`\n  ✖ Pre-flight failed. Fix errors or use --force to skip.\n`,
							),
						);
						process.exitCode = 1;
						return;
					}
					preflightPassed = overallStatus === "pass";
				}

				// ── Phase 2: Close the cycle ────────────────────────────────────────
				let closedAt: string | null = null;
				const cycleName = remoteCycleData?.ok
					? remoteCycleData.data.name
					: (localCycle?.name ?? id);
				const cycleGoal = remoteCycleData?.ok
					? (remoteCycleData.data.goal ?? "")
					: (localCycle?.goal ?? "");
				const appetite = remoteCycleData?.ok
					? (remoteCycleData.data.appetite ?? "medium")
					: (localCycle?.appetite ?? "medium");
				const startedAt = remoteCycleData?.ok
					? remoteCycleData.data.created_at
					: (localCycle?.created_at ?? new Date().toISOString());

				if (remoteCycleData?.ok && remoteAuth) {
					const remoteClose = await updateRemoteCycleStatus(
						remoteAuth,
						id,
						"closed",
					);
					if (remoteClose.ok) {
						await cacheRemoteCycle(remoteClose.data);
						closedAt = remoteClose.data.closed_at ?? new Date().toISOString();
						console.log(
							chalk.green(`\n✔ Cycle ${remoteClose.data.id} closed\n`),
						);
						if (remoteTasksData?.ok && remoteTasksData.data.length > 0) {
							const done = remoteTasksData.data.filter(
								(t) => t.status === "done",
							).length;
							const total = remoteTasksData.data.length;
							console.log(
								`  ${chalk.gray("Tasks:")} ${chalk.green(String(done))} done / ${chalk.white(String(total))} total`,
							);
						}
						console.log(
							chalk.gray(
								`  Closed: ${new Date(closedAt).toLocaleDateString()}\n`,
							),
						);
					} else {
						if (remoteClose.reason === "project_missing") {
							showProjectMissingMessage();
							process.exitCode = 1;
							return;
						}
						warnFallbackToLocal(remoteClose.message);
						// fall through to local
					}
				}

				if (!closedAt && localCycle) {
					const updated = await cycleService.updateCycle(id, {
						status: "closed",
					});
					closedAt = updated.closed_at ?? new Date().toISOString();
					console.log(chalk.green(`\n✔ Cycle ${id} closed\n`));
					if (localTasksForCycle.length > 0) {
						const done = localTasksForCycle.filter(
							(t) => t.status === "done",
						).length;
						const total = localTasksForCycle.length;
						console.log(
							`  ${chalk.gray("Tasks:")} ${chalk.green(String(done))} done / ${chalk.white(String(total))} total`,
						);
					}
					console.log(
						chalk.gray(
							`  Closed: ${new Date(closedAt).toLocaleDateString()}\n`,
						),
					);
				}

				// ── Phase 3: Retrospective ──────────────────────────────────────────
				if (closedAt && preflightTasks.length > 0) {
					try {
						const retro = retroService.build({
							cycleId: id,
							cycleName,
							cycleGoal,
							appetite,
							startedAt:
								typeof startedAt === "string"
									? startedAt
									: new Date().toISOString(),
							closedAt,
							tasks: preflightTasks.map((t) => ({
								id: t.id,
								title: t.title,
								status: t.status,
								evidence: t.evidence ?? undefined,
								cycle_id: id,
							})),
							decisions: [],
							totalValidationRuns: 0,
							lastValidationStatus: preflightPassed ? "pass" : "warn",
							openIssues: 0,
							resolvedIssues: 0,
						});
						// Save to changelog
						const retroPath = await retroService
							.saveToChangelog(retro)
							.catch(() => null);
						const duration = retro.leadTimeDays ?? 0;
						const target = retro.targetDays;
						const variance = target != null ? duration - target : null;
						const doneCnt = retro.completedTasks.length;
						const deferCnt = retro.deferredTasks.length;
						console.log(chalk.bold("  📋 Retrospective Summary\n"));
						console.log(
							`  Duration: ${duration} days${target != null ? ` (target: ${target})` : ""}`,
						);
						console.log(`  Velocity: ${doneCnt} done / ${deferCnt} deferred`);
						if (variance !== null) {
							const sign = variance >= 0 ? "+" : "";
							const color = variance > 0 ? chalk.yellow : chalk.green;
							console.log(`  vs appetite: ${color(`${sign}${variance} days`)}`);
						}
						if (retroPath) {
							console.log(chalk.gray(`  Saved: ${retroPath}`));
						}
						console.log();
					} catch {
						// Retro is non-critical — don't fail the close
					}
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

	cycleCmd
		.command("validate <id>")
		.description(
			"Run full validation for a cycle: pre-flight checks + AI review (Phase 1 + 2)",
		)
		.option("--skip-sensors", "Skip feedback sensor checks")
		.option("--skip-ai", "Skip Phase 2 AI review (pre-flight only)")
		.option(
			"--backend <backend>",
			"Execution backend for AI review: cloud|local (default: from cycle config)",
		)
		.option("--strict", "Exit with error code if any check fails or warns")
		.action(
			async (
				id: string,
				options: {
					skipSensors?: boolean;
					skipAi?: boolean;
					backend?: string;
					strict?: boolean;
				},
			) => {
				await trackCommandUsage("cycle validate");
				try {
					const rules = await rulesService.readRules();
					const remoteAuth = await resolveRemoteAuth();

					// Resolve cycle UUID upfront (POST /runs requires UUID)
					let cycleDbId: string | undefined;

					let cycleTasks: Array<{
						id: string;
						title: string;
						status: string;
						evidence?: string;
					}> = [];

					if (remoteAuth) {
						const cycleResult = await getRemoteCycle(remoteAuth, id);
						if (cycleResult.ok) {
							cycleDbId = cycleResult.data.db_id;
						}
						const tasksResult = await getRemoteCycleTasks(remoteAuth, id);
						if (tasksResult.ok) {
							cycleTasks = tasksResult.data.map((t) => ({
								id: t.id,
								title: t.title,
								status: t.status,
								evidence: undefined,
							}));
						}
					}

					if (cycleTasks.length === 0) {
						const localTasks = await taskService.getTasks();
						cycleTasks = localTasks
							.filter((t) => t.cycle_id === id && !t.deleted_at)
							.map((t) => ({
								id: t.id,
								title: t.title,
								status: t.status,
								evidence: t.evidence,
							}));
					}

					let sensorResults: import("@vem/core").SensorResult[] = [];
					if (!options.skipSensors && rules.run_sensors_on_validate) {
						const config = await sensorsService.readConfig();
						if (config.sensors.length > 0) {
							console.log(chalk.gray("  Running sensors..."));
							sensorResults = await sensorsService.runSensors();
						}
					}

					const gitDiff = validationService.getGitDiffSince();
					const decisions = await loadDecisionsForDrift();

					const preflight = await validationService.runPreflight(
						cycleTasks,
						sensorResults,
						decisions,
						gitDiff,
						rules,
					);

					console.log(chalk.bold(`\n🔍  Preflight Validation: ${id}\n`));
					console.log(
						`  ${chalk.gray("Tasks:")} ${chalk.white(String(preflight.doneTasks))}/${chalk.white(String(preflight.totalTasks))} done`,
					);
					if (preflight.blockedTasks > 0) {
						console.log(
							`  ${chalk.yellow(`⚠  ${preflight.blockedTasks} task(s) blocked`)}`,
						);
					}

					if (sensorResults.length > 0) {
						const passed = sensorResults.filter((r) => r.passed).length;
						const statusColor =
							passed === sensorResults.length ? chalk.green : chalk.yellow;
						console.log(
							`  ${chalk.gray("Sensors:")} ${statusColor(`${passed}/${sensorResults.length} passed`)}`,
						);
						for (const s of sensorResults.filter((r) => !r.passed)) {
							console.log(
								`    ${chalk.red("✗")} ${s.name}: exit ${s.exitCode}`,
							);
							const lines = s.output
								.split("\n")
								.filter((l) => l.trim())
								.slice(0, 4);
							for (const line of lines) {
								console.log(`      ${chalk.gray(line)}`);
							}
						}
					}

					if (preflight.driftViolations.length > 0) {
						console.log(
							`  ${chalk.yellow(`⚠  Architecture drift: ${preflight.driftViolations.length} violation(s)`)}`,
						);
						for (const v of preflight.driftViolations.slice(0, 3)) {
							console.log(
								`    ${chalk.red("✗")} ${chalk.white(v.decisionId)}: ${v.file}:${v.line}`,
							);
						}
					}

					if (preflight.errors.length > 0) {
						console.log(chalk.red("\n  Errors:"));
						for (const err of preflight.errors) {
							console.log(`    ${chalk.red("✗")} ${err}`);
						}
					}
					if (preflight.warnings.length > 0 && preflight.errors.length === 0) {
						console.log(chalk.yellow("\n  Warnings:"));
						for (const w of preflight.warnings.slice(0, 5)) {
							console.log(`    ${chalk.yellow("⚠")} ${w}`);
						}
					}

					const overallStatus =
						preflight.errors.length > 0
							? "fail"
							: preflight.warnings.length > 0
								? "warn"
								: "pass";

					const statusDisplay = {
						pass: chalk.green("PASS"),
						warn: chalk.yellow("WARN"),
						fail: chalk.red("FAIL"),
					}[overallStatus];

					console.log(chalk.bold(`\n  Status: ${statusDisplay}\n`));

					await validationService.saveReport({
						cycleId: id,
						ranAt: new Date().toISOString(),
						preflight,
						overallStatus,
					});

					if (options.strict && overallStatus !== "pass") {
						process.exitCode = 1;
						return;
					}

					// ── Phase 2: AI Review ──────────────────────────────────────────
					if (!options.skipAi && remoteAuth) {
						// Build sensor summary to inject into validation_instructions
						let sensorSummary = "";
						if (sensorResults.length > 0) {
							const failedSensors = sensorResults.filter((r) => !r.passed);
							const passedSensors = sensorResults.filter((r) => r.passed);
							const lines: string[] = [
								`\n\n---\n## Pre-flight Sensor Results (${passedSensors.length}/${sensorResults.length} passed)`,
							];
							for (const s of sensorResults) {
								const icon = s.passed ? "✓" : "✗";
								lines.push(`${icon} ${s.name}: exit ${s.exitCode}`);
								if (!s.passed) {
									for (const line of s.output
										.split("\n")
										.filter((l) => l.trim())
										.slice(0, 6)) {
										lines.push(`  ${line}`);
									}
								}
							}
							if (failedSensors.length > 0) {
								lines.push(
									`\nNote: ${failedSensors.length} sensor(s) failed. Please review the output above.`,
								);
							}
							sensorSummary = lines.join("\n");
						}

						console.log(chalk.gray("\n  Triggering AI review run..."));
						try {
							const backend =
								options.backend === "cloud" || options.backend === "local"
									? options.backend
									: undefined;

							// Use cycle UUID (db_id) for API write operations
							const cycleUuidForApi = cycleDbId ?? id;

							const runResult = await requestRemoteJson<{
								run?: { id?: string };
							}>(
								remoteAuth,
								`/projects/${remoteAuth.projectId}/cycles/${cycleUuidForApi}/runs`,
								{
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										...(sensorSummary
											? { validation_instructions: sensorSummary }
											: {}),
										...(backend ? { execution_backend: backend } : {}),
									}),
								},
							);

							if (runResult.ok) {
								const runId = runResult.data.run?.id;
								console.log(
									chalk.green(
										`  ✔ AI review run started${runId ? `: ${runId}` : ""}`,
									),
								);
								console.log(
									chalk.gray(
										`  View results in the web dashboard or run: vem cycle health ${id}\n`,
									),
								);

								// Post preflight summary to the new run so the web UI can display it
								if (runId) {
									try {
										await requestRemoteJson(
											remoteAuth,
											`/projects/${remoteAuth.projectId}/cycles/${cycleUuidForApi}/runs/${runId}/preflight`,
											{
												method: "PATCH",
												headers: { "Content-Type": "application/json" },
												body: JSON.stringify({
													ranAt: new Date().toISOString(),
													taskStats: {
														total: preflight.totalTasks,
														done: preflight.doneTasks,
														blocked: preflight.blockedTasks,
													},
													sensorResults: sensorResults.map((s) => ({
														name: s.name,
														passed: s.passed,
														exitCode: s.exitCode,
														output: s.output
															.split("\n")
															.filter((l) => l.trim())
															.slice(0, 10)
															.join("\n"),
													})),
													driftViolations: preflight.driftViolations.map(
														(v) => ({
															decision: v.decisionId,
															pattern: v.pattern ?? "",
															file: v.file,
															line: String(v.line),
															match: v.match,
														}),
													),
												}),
											},
										);
									} catch {
										// Non-critical — preflight was already saved locally
									}
								}
							} else {
								console.log(
									chalk.yellow(
										`  ⚠ Could not start AI review: ${runResult.message}\n`,
									),
								);
							}
						} catch (runErr) {
							console.log(
								chalk.yellow(
									`  ⚠ AI review skipped: ${getErrorMessage(runErr)}\n`,
								),
							);
						}
					} else if (options.skipAi) {
						console.log(chalk.gray("  AI review skipped (--skip-ai).\n"));
						// Still store preflight summary to DB so web UI can display it
						if (remoteAuth && cycleDbId) {
							try {
								await requestRemoteJson(
									remoteAuth,
									`/projects/${remoteAuth.projectId}/cycles/${cycleDbId}/preflight`,
									{
										method: "PATCH",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({
											ranAt: new Date().toISOString(),
											taskStats: {
												total: preflight.totalTasks,
												done: preflight.doneTasks,
												blocked: preflight.blockedTasks,
											},
											sensorResults: sensorResults.map((s) => ({
												name: s.name,
												passed: s.passed,
												exitCode: s.exitCode,
												output: s.output
													.split("\n")
													.filter((l) => l.trim())
													.slice(0, 10)
													.join("\n"),
											})),
											driftViolations: preflight.driftViolations.map((v) => ({
												decision: v.decisionId,
												pattern: v.pattern ?? "",
												file: v.file,
												line: String(v.line),
												match: v.match,
											})),
										}),
									},
								);
							} catch {
								// Non-critical — preflight was already saved locally
							}
						}
					} else {
						console.log(
							chalk.gray("  Not linked to a project — AI review skipped.\n"),
						);
					}
				} catch (error) {
					console.error(
						chalk.red(`Failed to validate cycle: ${getErrorMessage(error)}`),
					);
					process.exitCode = 1;
				}
			},
		);

	cycleCmd
		.command("health [id]")
		.description("Show health snapshot for the active or given cycle")
		.action(async (id?: string) => {
			await trackCommandUsage("cycle health");
			try {
				let cycle: {
					id: string;
					name: string;
					goal: string;
					appetite?: string;
					start_at?: string;
				} | null = null;
				const remoteAuth = await resolveRemoteAuth();

				if (id) {
					if (remoteAuth) {
						const result = await getRemoteCycle(remoteAuth, id);
						if (result.ok) cycle = result.data;
						else if (result.reason === "project_missing") {
							showProjectMissingMessage();
							process.exitCode = 1;
							return;
						}
					}
					if (!cycle) cycle = await cycleService.getCycle(id);
				} else {
					if (remoteAuth) {
						const result = await getRemoteCycles(remoteAuth);
						if (result.ok)
							cycle = result.data.find((c) => c.status === "active") ?? null;
					}
					if (!cycle) cycle = await cycleService.getActiveCycle();
				}

				if (!cycle) {
					console.log(chalk.yellow("\n  No active cycle found.\n"));
					return;
				}

				let tasks: Array<{ id: string; title: string; status: string }> = [];
				if (remoteAuth) {
					const tasksResult = await getRemoteCycleTasks(remoteAuth, cycle.id);
					if (tasksResult.ok) tasks = tasksResult.data;
				}
				if (tasks.length === 0) {
					const localTasks = await taskService.getTasks();
					tasks = localTasks
						.filter((t) => t.cycle_id === cycle!.id && !t.deleted_at)
						.map((t) => ({ id: t.id, title: t.title, status: t.status }));
				}

				const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
					acc[t.status] = (acc[t.status] ?? 0) + 1;
					return acc;
				}, {});

				console.log(chalk.bold(`\n🏥  Cycle Health: ${cycle.id}\n`));
				console.log(`  ${chalk.white(cycle.name)}`);
				console.log(`  ${chalk.gray("Goal:")} ${cycle.goal}`);

				if (cycle.appetite) {
					const appetiteDays: Record<string, number> = {
						small: 7,
						medium: 14,
						large: 42,
					};
					const target = appetiteDays[cycle.appetite];
					if (target && cycle.start_at) {
						const elapsed = Math.round(
							(Date.now() - new Date(cycle.start_at).getTime()) /
								(1000 * 60 * 60 * 24),
						);
						const pct = Math.min(100, Math.round((elapsed / target) * 100));
						const bar =
							"█".repeat(Math.floor(pct / 5)) +
							"░".repeat(20 - Math.floor(pct / 5));
						console.log(
							`  ${chalk.gray("Progress:")} ${bar} ${chalk.white(`${pct}%`)} (day ${elapsed}/${target})`,
						);
					}
				}

				console.log(`\n  ${chalk.bold("Tasks:")}`);
				for (const [status, count] of Object.entries(byStatus)) {
					const icon =
						status === "done"
							? chalk.green("✓")
							: status === "blocked"
								? chalk.red("▲")
								: status === "in-progress"
									? chalk.cyan("⬡")
									: chalk.gray("○");
					console.log(`    ${icon}  ${count}  ${status}`);
				}

				const report = await validationService.loadReport(cycle.id);
				if (report) {
					const statusDisplay =
						report.overallStatus === "pass"
							? chalk.green("PASS")
							: report.overallStatus === "warn"
								? chalk.yellow("WARN")
								: chalk.red("FAIL");
					console.log(
						`\n  ${chalk.bold("Last Validation:")} ${statusDisplay} — ${new Date(report.ranAt).toLocaleString()}`,
					);
					const pf = report.preflight;
					if (pf.errors.length > 0) {
						console.log(chalk.red(`    ✗ ${pf.errors[0]}`));
					}
					if (pf.warnings.length > 0) {
						console.log(
							chalk.yellow(`    ⚠ ${pf.warnings.slice(0, 2).join(" | ")}`),
						);
					}
				}

				console.log();
			} catch (error) {
				console.error(
					chalk.red(`Failed to get cycle health: ${getErrorMessage(error)}`),
				);
			}
		});

	cycleCmd
		.command("retrospective <id>")
		.description("Generate a retrospective for a closed cycle")
		.action(async (id: string) => {
			await trackCommandUsage("cycle retrospective");
			try {
				const remoteAuth = await resolveRemoteAuth();
				let cycle: {
					id: string;
					name: string;
					goal: string;
					appetite?: string;
					start_at?: string;
					closed_at?: string;
				} | null = null;

				if (remoteAuth) {
					const result = await getRemoteCycle(remoteAuth, id);
					if (result.ok) cycle = result.data;
					else if (result.reason === "project_missing") {
						showProjectMissingMessage();
						process.exitCode = 1;
						return;
					}
				}
				if (!cycle) cycle = await cycleService.getCycle(id);
				if (!cycle) {
					console.error(chalk.red(`\n✖ Cycle ${id} not found.\n`));
					process.exitCode = 1;
					return;
				}

				const localTasks = await taskService.getTasks();
				const decisions: Array<{
					id: string;
					title: string;
					created_at?: string;
				}> = [];

				const retro = retroService.build({
					cycleId: cycle.id,
					cycleName: cycle.name,
					cycleGoal: cycle.goal,
					appetite: cycle.appetite,
					startedAt: cycle.start_at,
					closedAt: cycle.closed_at,
					tasks: localTasks.map((t) => ({
						id: t.id,
						title: t.title,
						status: t.status,
						evidence: t.evidence,
						cycle_id: t.cycle_id,
						deleted_at: t.deleted_at,
					})),
					decisions,
					totalValidationRuns: 0,
					lastValidationStatus: undefined,
					openIssues: 0,
					resolvedIssues: 0,
				});

				const filePath = await retroService.saveToChangelog(retro);

				console.log(chalk.bold(`\n📋  Retrospective: ${cycle.name}\n`));
				console.log(
					`  ${chalk.gray("Completed:")} ${chalk.green(String(retro.completedTasks.length))} tasks`,
				);
				console.log(
					`  ${chalk.gray("Deferred:")} ${chalk.yellow(String(retro.deferredTasks.length))} tasks`,
				);
				if (retro.leadTimeDays !== undefined) {
					const vs = retro.targetDays
						? ` (target ${retro.targetDays} days)`
						: "";
					console.log(
						`  ${chalk.gray("Duration:")} ${retro.leadTimeDays} days${vs}`,
					);
				}
				console.log(chalk.gray(`\n  Saved to: ${filePath}\n`));
			} catch (error) {
				console.error(
					chalk.red(
						`Failed to generate retrospective: ${getErrorMessage(error)}`,
					),
				);
			}
		});
}
