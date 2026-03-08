import {
	ConfigService,
	listAllAgentSessions,
	type TaskSessionRef,
} from "@vem/core";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import prompts from "prompts";

import {
	API_URL,
	buildDeviceHeaders,
	parseCommaList,
	resolveActorName,
	taskService,
	trackCommandUsage,
	tryAuthenticatedKey,
} from "../runtime.js";

export function registerTaskCommands(program: Command) {
	const taskCmd = program.command("task").description("Manage tasks");

	const formatTaskStatusLabel = (status: string, deletedAt?: string) => {
		if (deletedAt) return chalk.red("DELETED");
		switch (status) {
			case "in-progress":
				return chalk.blue("IN PROG");
			case "blocked":
				return chalk.yellow("BLOCKED");
			case "done":
				return chalk.green("DONE");
			default:
				return chalk.gray("TODO");
		}
	};

	const formatTaskPriority = (priority?: string) =>
		priority === "high" || priority === "critical"
			? chalk.red(priority)
			: chalk.white(priority || "");

	const ADD_TASK_BACK_VALUE = "__vem_back__";
	const ADD_TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
	type AddTaskPriority = (typeof ADD_TASK_PRIORITIES)[number];
	type PromptResult<T> =
		| { kind: "next"; value: T }
		| { kind: "back" }
		| { kind: "cancel" };

	type DisplayTask = {
		id: string;
		db_id?: string;
		title: string;
		status: "todo" | "in-progress" | "blocked" | "done";
		assignee?: string;
		priority?: string;
		tags?: string[];
		type?: string;
		estimate_hours?: number;
		depends_on?: string[];
		blocked_by?: string[];
		recurrence_rule?: string;
		owner_id?: string;
		reviewer_id?: string;
		parent_id?: string;
		subtask_order?: number;
		description?: string;
		task_context?: string;
		task_context_summary?: string;
		related_decisions?: string[];
		evidence?: string[];
		actions?: Array<{
			type: string;
			reasoning?: string | null;
			actor?: string | null;
			created_at: string;
		}>;
		created_at?: string;
		updated_at?: string;
		due_at?: string;
		github_issue_number?: number;
		deleted_at?: string;
		validation_steps?: string[];
	};

	const TASK_STATUS_VALUES = new Set<DisplayTask["status"]>([
		"todo",
		"in-progress",
		"blocked",
		"done",
	]);

	const asTrimmedString = (value: unknown): string | undefined => {
		if (typeof value !== "string") return undefined;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	};

	const asStringArray = (value: unknown): string[] | undefined => {
		if (!Array.isArray(value)) return undefined;
		const items = value
			.map((entry) => asTrimmedString(entry))
			.filter((entry): entry is string => Boolean(entry));
		return items.length > 0 ? items : [];
	};

	const asFiniteNumber = (value: unknown): number | undefined => {
		if (typeof value !== "number") return undefined;
		return Number.isFinite(value) ? value : undefined;
	};

	const asIsoLikeString = (value: unknown): string | undefined => {
		const raw = asTrimmedString(value);
		if (!raw) return undefined;
		const parsed = new Date(raw);
		return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
	};

	const asTaskStatus = (value: unknown): DisplayTask["status"] | undefined => {
		if (typeof value !== "string") return undefined;
		return TASK_STATUS_VALUES.has(value as DisplayTask["status"])
			? (value as DisplayTask["status"])
			: undefined;
	};

	const asTaskActions = (
		value: unknown,
	): DisplayTask["actions"] | undefined => {
		if (!Array.isArray(value)) return undefined;
		const actions = value
			.map((entry) => {
				if (!entry || typeof entry !== "object") return null;
				const record = entry as Record<string, unknown>;
				const type = asTrimmedString(record.type);
				const createdAt = asIsoLikeString(record.created_at);
				if (!type || !createdAt) return null;
				const reasoning =
					record.reasoning === null ? null : asTrimmedString(record.reasoning);
				const actor =
					record.actor === null ? null : asTrimmedString(record.actor);
				return {
					type,
					reasoning,
					actor,
					created_at: createdAt,
				};
			})
			.filter(Boolean) as NonNullable<DisplayTask["actions"]>;
		return actions.length > 0 ? actions : [];
	};

	const normalizeRemoteTask = (input: unknown): DisplayTask | null => {
		if (!input || typeof input !== "object") return null;
		const record = input as Record<string, unknown>;

		const id = asTrimmedString(record.id);
		const title = asTrimmedString(record.title);
		const status = asTaskStatus(record.status);

		if (!id || !title || !status) return null;

		return {
			id,
			db_id: asTrimmedString(record.db_id),
			title,
			status,
			assignee: asTrimmedString(record.assignee),
			priority: asTrimmedString(record.priority),
			tags: asStringArray(record.tags),
			type: asTrimmedString(record.type),
			estimate_hours: asFiniteNumber(record.estimate_hours),
			depends_on: asStringArray(record.depends_on),
			blocked_by: asStringArray(record.blocked_by),
			recurrence_rule: asTrimmedString(record.recurrence_rule),
			owner_id: asTrimmedString(record.owner_id),
			reviewer_id: asTrimmedString(record.reviewer_id),
			parent_id: asTrimmedString(record.parent_id),
			subtask_order: asFiniteNumber(record.subtask_order),
			description: asTrimmedString(record.description),
			task_context: asTrimmedString(record.task_context),
			task_context_summary: asTrimmedString(record.task_context_summary),
			related_decisions: asStringArray(record.related_decisions),
			evidence: asStringArray(record.evidence),
			actions: asTaskActions(record.actions),
			created_at: asIsoLikeString(record.created_at),
			updated_at: asIsoLikeString(record.updated_at),
			due_at: asIsoLikeString(record.due_at),
			github_issue_number: asFiniteNumber(record.github_issue_number),
			deleted_at: asIsoLikeString(record.deleted_at),
			validation_steps: asStringArray(record.validation_steps),
		};
	};

	const getRemoteTasks = async (options?: {
		id?: string;
		includeActions?: boolean;
		includeDeleted?: boolean;
	}): Promise<DisplayTask[] | null> => {
		try {
			const configService = new ConfigService();
			const [apiKey, projectId] = await Promise.all([
				tryAuthenticatedKey(configService),
				configService.getProjectId(),
			]);
			if (!apiKey || !projectId) return null;

			const query = new URLSearchParams();
			if (options?.id) query.set("id", options.id);
			if (options?.includeActions) query.set("include_actions", "true");
			if (options?.includeDeleted) query.set("include_deleted", "true");

			const suffix = query.toString();
			const response = await fetch(
				`${API_URL}/projects/${projectId}/tasks${suffix ? `?${suffix}` : ""}`,
				{
					headers: {
						Authorization: `Bearer ${apiKey}`,
						...(await buildDeviceHeaders(configService)),
					},
				},
			);

			if (!response.ok) return null;
			const body = (await response.json()) as { tasks?: unknown };
			if (!Array.isArray(body.tasks)) return null;

			return body.tasks
				.map((task) => normalizeRemoteTask(task))
				.filter((task): task is DisplayTask => Boolean(task));
		} catch {
			return null;
		}
	};

	const getDisplayTasks = async (options?: {
		id?: string;
		includeActions?: boolean;
		includeDeleted?: boolean;
	}): Promise<DisplayTask[]> => {
		const remoteTasks = await getRemoteTasks(options);
		if (remoteTasks) return remoteTasks;
		const localTasks = options?.id
			? [await taskService.getTask(options.id)].filter(
					(task): task is NonNullable<typeof task> => Boolean(task),
				)
			: await taskService.getTasks();
		return localTasks as DisplayTask[];
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

	const getRemoteTaskContext = async (
		taskId: string,
	): Promise<{
		task_context?: string;
		task_context_summary?: string;
	} | null> => {
		try {
			const auth = await resolveRemoteProjectAuth();
			if (!auth) return null;
			const response = await fetch(
				`${API_URL}/projects/${auth.projectId}/tasks/${encodeURIComponent(taskId)}/context`,
				{
					headers: {
						Authorization: `Bearer ${auth.apiKey}`,
						...(await buildDeviceHeaders(auth.configService)),
					},
				},
			);
			if (!response.ok) return null;
			const body = (await response.json()) as {
				task_context?: unknown;
				task_context_summary?: unknown;
			};
			return {
				task_context:
					typeof body.task_context === "string" ? body.task_context : undefined,
				task_context_summary:
					typeof body.task_context_summary === "string"
						? body.task_context_summary
						: undefined,
			};
		} catch {
			return null;
		}
	};

	const updateRemoteTaskContext = async (
		taskId: string,
		payload: {
			task_context?: string | null;
			task_context_summary?: string | null;
		},
	): Promise<boolean> => {
		try {
			const auth = await resolveRemoteProjectAuth();
			if (!auth) return false;
			const response = await fetch(
				`${API_URL}/projects/${auth.projectId}/tasks/${encodeURIComponent(taskId)}/context`,
				{
					method: "PUT",
					headers: {
						Authorization: `Bearer ${auth.apiKey}`,
						"Content-Type": "application/json",
						...(await buildDeviceHeaders(auth.configService)),
					},
					body: JSON.stringify(payload),
				},
			);
			if (!response.ok) return false;
			return true;
		} catch {
			return false;
		}
	};

	const getRemoteTaskById = async (
		taskId: string,
	): Promise<DisplayTask | null> => {
		const remoteTasks = await getRemoteTasks({
			id: taskId,
			includeDeleted: true,
		});
		if (!remoteTasks || remoteTasks.length === 0) {
			return null;
		}
		return (
			remoteTasks.find((task) => task.id === taskId) ?? remoteTasks[0] ?? null
		);
	};

	const updateRemoteTaskMeta = async (
		taskId: string,
		patch: {
			status?: DisplayTask["status"];
			evidence?: string[];
			sessions?: unknown[];
			tags?: string[];
			type?: string;
			estimate_hours?: number;
			depends_on?: string[];
			blocked_by?: string[];
			recurrence_rule?: string;
			owner_id?: string;
			reviewer_id?: string;
			parent_id?: string;
			subtask_order?: number;
			due_at?: string;
			validation_steps?: string[];
			deleted_at?: string;
			reasoning?: string;
			actor?: string;
		},
	): Promise<boolean> => {
		try {
			const auth = await resolveRemoteProjectAuth();
			if (!auth) return false;

			const remoteTask = await getRemoteTaskById(taskId);
			if (!remoteTask?.db_id) return false;

			const payload: Record<string, unknown> = {
				title: remoteTask.title,
				description: remoteTask.description ?? null,
				status: remoteTask.status,
				priority: remoteTask.priority ?? "medium",
				tags: remoteTask.tags ?? [],
				type: remoteTask.type ?? null,
				estimate_hours: remoteTask.estimate_hours ?? null,
				depends_on: remoteTask.depends_on ?? [],
				blocked_by: remoteTask.blocked_by ?? [],
				recurrence_rule: remoteTask.recurrence_rule ?? null,
				owner_id: remoteTask.owner_id ?? null,
				reviewer_id: remoteTask.reviewer_id ?? null,
				parent_id: remoteTask.parent_id ?? null,
				subtask_order: remoteTask.subtask_order ?? null,
				due_at: remoteTask.due_at ?? null,
				validation_steps: remoteTask.validation_steps ?? [],
				evidence: remoteTask.evidence ?? [],
				deleted_at: remoteTask.deleted_at ?? null,
			};

			if (patch.status !== undefined) payload.status = patch.status;
			if (patch.evidence !== undefined) payload.evidence = patch.evidence;
			if (patch.tags !== undefined) payload.tags = patch.tags;
			if (patch.type !== undefined) payload.type = patch.type;
			if (patch.estimate_hours !== undefined) {
				payload.estimate_hours = patch.estimate_hours;
			}
			if (patch.depends_on !== undefined) payload.depends_on = patch.depends_on;
			if (patch.blocked_by !== undefined) payload.blocked_by = patch.blocked_by;
			if (patch.recurrence_rule !== undefined) {
				payload.recurrence_rule = patch.recurrence_rule;
			}
			if (patch.owner_id !== undefined) payload.owner_id = patch.owner_id;
			if (patch.reviewer_id !== undefined)
				payload.reviewer_id = patch.reviewer_id;
			if (patch.parent_id !== undefined) payload.parent_id = patch.parent_id;
			if (patch.subtask_order !== undefined) {
				payload.subtask_order = patch.subtask_order;
			}
			if (patch.due_at !== undefined) payload.due_at = patch.due_at;
			if (patch.validation_steps !== undefined) {
				payload.validation_steps = patch.validation_steps;
			}
			if (patch.deleted_at !== undefined) payload.deleted_at = patch.deleted_at;
			if (patch.sessions !== undefined) payload.sessions = patch.sessions;
			if (patch.reasoning !== undefined) payload.reasoning = patch.reasoning;
			if (patch.actor !== undefined) payload.actor = patch.actor;

			const response = await fetch(
				`${API_URL}/tasks/${encodeURIComponent(remoteTask.db_id)}/meta`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${auth.apiKey}`,
						"Content-Type": "application/json",
						...(await buildDeviceHeaders(auth.configService)),
					},
					body: JSON.stringify(payload),
				},
			);

			return response.ok;
		} catch {
			return false;
		}
	};

	const createRemoteTask = async (payload: {
		title: string;
		description?: string;
		priority: "low" | "medium" | "high" | "critical";
		tags?: string[];
		type?: "feature" | "bug" | "chore";
		estimate_hours?: number;
		depends_on?: string[];
		blocked_by?: string[];
		recurrence_rule?: string;
		owner_id?: string;
		reviewer_id?: string;
		parent_id?: string;
		subtask_order?: number;
		due_at?: string;
		validation_steps?: string[];
	}): Promise<DisplayTask | null> => {
		try {
			const auth = await resolveRemoteProjectAuth();
			if (!auth) return null;

			const createBody: Record<string, unknown> = {
				title: payload.title,
				priority: payload.priority,
			};
			if (payload.description !== undefined) {
				createBody.description = payload.description;
			}
			if (payload.type !== undefined) createBody.type = payload.type;
			if (payload.estimate_hours !== undefined) {
				createBody.estimate_hours = payload.estimate_hours;
			}
			if (payload.parent_id !== undefined)
				createBody.parent_id = payload.parent_id;
			if (payload.subtask_order !== undefined) {
				createBody.subtask_order = payload.subtask_order;
			}

			const response = await fetch(
				`${API_URL}/projects/${auth.projectId}/tasks`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${auth.apiKey}`,
						"Content-Type": "application/json",
						...(await buildDeviceHeaders(auth.configService)),
					},
					body: JSON.stringify(createBody),
				},
			);
			if (!response.ok) return null;

			const body = (await response.json()) as {
				task?: { external_id?: unknown };
			};
			const externalId = asTrimmedString(body.task?.external_id);
			if (!externalId) return null;

			const hasExtendedMetadata =
				payload.tags !== undefined ||
				payload.depends_on !== undefined ||
				payload.blocked_by !== undefined ||
				payload.recurrence_rule !== undefined ||
				payload.owner_id !== undefined ||
				payload.reviewer_id !== undefined ||
				payload.due_at !== undefined ||
				payload.validation_steps !== undefined;
			if (hasExtendedMetadata) {
				await updateRemoteTaskMeta(externalId, {
					tags: payload.tags,
					type: payload.type,
					estimate_hours: payload.estimate_hours,
					depends_on: payload.depends_on,
					blocked_by: payload.blocked_by,
					recurrence_rule: payload.recurrence_rule,
					owner_id: payload.owner_id,
					reviewer_id: payload.reviewer_id,
					parent_id: payload.parent_id,
					subtask_order: payload.subtask_order,
					due_at: payload.due_at,
					validation_steps: payload.validation_steps,
				});
			}

			return (
				(await getRemoteTaskById(externalId)) ?? {
					id: externalId,
					title: payload.title,
					status: "todo",
					priority: payload.priority,
				}
			);
		} catch {
			return null;
		}
	};

	const isBackInput = (value: string) => {
		const normalized = value.trim().toLowerCase();
		return (
			normalized === ":back" || normalized === "<" || normalized === "back"
		);
	};

	const normalizePriority = (value?: string): AddTaskPriority => {
		const normalized = value?.trim().toLowerCase();
		if (!normalized) return "medium";
		if (
			normalized === "low" ||
			normalized === "medium" ||
			normalized === "high" ||
			normalized === "critical"
		) {
			return normalized;
		}
		throw new Error(
			`Invalid priority "${value}". Use: ${ADD_TASK_PRIORITIES.join(", ")}.`,
		);
	};

	const parseDueAtIso = (value?: string): string | undefined => {
		if (!value || value.trim().length === 0) return undefined;
		const rawValue = value.trim();
		const parsed = new Date(
			rawValue.length === 10 ? `${rawValue}T00:00:00.000Z` : rawValue,
		);
		if (Number.isNaN(parsed.getTime())) {
			throw new Error(
				"due-at must be a valid ISO date or YYYY-MM-DD (e.g. 2026-02-12).",
			);
		}
		return parsed.toISOString();
	};

	const parseOptionalFloat = (
		value: string | undefined,
		fieldName: string,
	): number | undefined => {
		if (!value || value.trim().length === 0) return undefined;
		const parsed = Number.parseFloat(value);
		if (Number.isNaN(parsed)) {
			throw new Error(`${fieldName} must be a number`);
		}
		return parsed;
	};

	const parseOptionalInt = (
		value: string | undefined,
		fieldName: string,
	): number | undefined => {
		if (!value || value.trim().length === 0) return undefined;
		if (!/^-?\d+$/.test(value.trim())) {
			throw new Error(`${fieldName} must be an integer`);
		}
		return Number.parseInt(value, 10);
	};

	const TASK_CONTEXT_SUMMARY_MAX_CHARS = 1200;
	const summarizeTaskContext = (value: string): string => {
		const normalized = value.trim();
		if (normalized.length <= TASK_CONTEXT_SUMMARY_MAX_CHARS) return normalized;
		return `${normalized.slice(0, TASK_CONTEXT_SUMMARY_MAX_CHARS - 15).trimEnd()}\n...[truncated]`;
	};

	const promptTextWithBack = async ({
		message,
		initial,
		optional = false,
		allowBack = false,
		validate,
	}: {
		message: string;
		initial?: string;
		optional?: boolean;
		allowBack?: boolean;
		validate?: (value: string) => true | string;
	}): Promise<PromptResult<string | undefined>> => {
		let cancelled = false;
		const response = await prompts(
			{
				type: "text",
				name: "value",
				message,
				initial,
				validate: (input: string) => {
					if (allowBack && isBackInput(input)) return true;
					const trimmed = input.trim();
					if (!optional && trimmed.length === 0) {
						return "This field is required.";
					}
					return validate ? validate(trimmed) : true;
				},
			},
			{
				onCancel: () => {
					cancelled = true;
					return false;
				},
			},
		);

		if (cancelled) {
			return { kind: "cancel" };
		}

		const rawValue =
			typeof response.value === "string"
				? response.value
				: String(response.value || "");
		if (allowBack && isBackInput(rawValue)) {
			return { kind: "back" };
		}

		const value = rawValue.trim();
		if (optional && value.length === 0) {
			return { kind: "next", value: undefined };
		}

		return { kind: "next", value };
	};

	const promptSelectWithBack = async <T extends string>({
		message,
		choices,
		initial,
		allowBack = false,
	}: {
		message: string;
		choices: Array<{ title: string; value: T }>;
		initial?: T;
		allowBack?: boolean;
	}): Promise<PromptResult<T>> => {
		let cancelled = false;
		const response = await prompts(
			{
				type: "select",
				name: "value",
				message,
				initial:
					initial !== undefined
						? Math.max(
								choices.findIndex((choice) => choice.value === initial),
								0,
							)
						: 0,
				choices: allowBack
					? [...choices, { title: "← Back", value: ADD_TASK_BACK_VALUE as T }]
					: choices,
			},
			{
				onCancel: () => {
					cancelled = true;
					return false;
				},
			},
		);

		if (cancelled || response.value === undefined) {
			return { kind: "cancel" };
		}

		if (allowBack && response.value === ADD_TASK_BACK_VALUE) {
			return { kind: "back" };
		}

		return { kind: "next", value: response.value as T };
	};

	taskCmd
		.command("list")
		.description("List tasks")
		.option("--all", "Include completed tasks")
		.option("--deleted", "Show only deleted tasks")
		.option(
			"--status <status>",
			"Filter by status (todo, in-progress, blocked, done)",
		)
		.option("--done", "Show only completed tasks")
		.action(async (options) => {
			await trackCommandUsage("task list");
			const tasks = await getDisplayTasks({ includeDeleted: true });
			const status =
				typeof options.status === "string" ? options.status : undefined;
			const validStatuses = new Set(["todo", "in-progress", "blocked", "done"]);
			if (status && !validStatuses.has(status)) {
				console.error(
					chalk.red(
						`Invalid status "${status}". Use: todo, in-progress, blocked, done.`,
					),
				);
				process.exitCode = 1;
				return;
			}

			const filtered = status
				? tasks.filter((t) => t.status === status && !t.deleted_at)
				: options.deleted
					? tasks.filter((t) => t.deleted_at)
					: options.done
						? tasks.filter((t) => t.status === "done" && !t.deleted_at)
						: options.all
							? tasks
							: tasks.filter((t) => t.status !== "done" && !t.deleted_at);

			const table = new Table({
				head: ["ID", "Status", "Title", "Assignee", "Priority"],
				style: { head: ["cyan"] },
			});

			filtered.forEach((t) => {
				table.push([
					chalk.white(t.id),
					formatTaskStatusLabel(t.status, t.deleted_at),
					t.title,
					chalk.gray(t.assignee || "-"),
					formatTaskPriority(t.priority),
				]);
			});

			console.log(table.toString());
		});

	taskCmd
		.command("subtasks")
		.description("Show parent task and its subtasks")
		.requiredOption("--parent <id>", "Parent task ID")
		.action(async (options) => {
			const parentId = options.parent;
			const parent = await taskService.getTask(parentId);

			if (!parent) {
				console.error(chalk.red(`\n✖ Task ${parentId} not found.\n`));
				process.exitCode = 1;
				return;
			}

			const tasks = await taskService.getTasks();
			const subtasks = tasks
				.filter((t) => t.parent_id === parentId)
				.sort((a, b) => {
					const orderA =
						typeof a.subtask_order === "number" ? a.subtask_order : 9999;
					const orderB =
						typeof b.subtask_order === "number" ? b.subtask_order : 9999;
					if (orderA !== orderB) return orderA - orderB;
					return a.id.localeCompare(b.id);
				});

			const parentTable = new Table({
				head: ["ID", "Status", "Title", "Assignee", "Priority"],
				style: { head: ["cyan"] },
			});

			parentTable.push([
				chalk.white(parent.id),
				formatTaskStatusLabel(parent.status),
				parent.title,
				chalk.gray(parent.assignee || "-"),
				formatTaskPriority(parent.priority),
			]);

			console.log(chalk.bold("\nParent Task"));
			console.log(parentTable.toString());

			if (subtasks.length === 0) {
				console.log(chalk.gray("\nNo subtasks found."));
				return;
			}

			const subtaskTable = new Table({
				head: ["ID", "Status", "Title", "Assignee", "Priority", "Order"],
				style: { head: ["cyan"] },
			});

			subtasks.forEach((t) => {
				subtaskTable.push([
					chalk.white(t.id),
					formatTaskStatusLabel(t.status),
					t.title,
					chalk.gray(t.assignee || "-"),
					formatTaskPriority(t.priority),
					typeof t.subtask_order === "number" ? `#${t.subtask_order}` : "-",
				]);
			});

			console.log(chalk.bold("\nSubtasks"));
			console.log(subtaskTable.toString());
		});

	taskCmd
		.command("details")
		.description("Show task details")
		.requiredOption("--id <id>", "Task ID")
		.action(async (options) => {
			try {
				const [remoteTask] = await getDisplayTasks({
					id: options.id,
					includeActions: true,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(options.id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`\n✖ Task ${options.id} not found.\n`));
					process.exitCode = 1;
					return;
				}

				console.log(chalk.bold(`\n📋 Task Details: ${task.id}\n`));
				console.log(`${chalk.cyan("Title:")}       ${task.title}`);
				console.log(
					`${chalk.cyan("Status:")}      ${task.status.toUpperCase()}`,
				);
				console.log(
					`${chalk.cyan("Priority:")}    ${(task.priority || "medium").toUpperCase()}`,
				);

				if (task.assignee) {
					console.log(`${chalk.cyan("Assignee:")}    ${task.assignee}`);
				}

				if (task.github_issue_number) {
					console.log(
						`${chalk.cyan("GitHub Issue:")} #${task.github_issue_number}`,
					);
				}

				if (task.tags && task.tags.length > 0) {
					console.log(`${chalk.cyan("Tags:")}        ${task.tags.join(", ")}`);
				}

				if (task.type) {
					console.log(`${chalk.cyan("Type:")}        ${task.type}`);
				}

				if (typeof task.estimate_hours === "number") {
					console.log(`${chalk.cyan("Estimate:")}    ${task.estimate_hours}h`);
				}

				if (task.depends_on && task.depends_on.length > 0) {
					console.log(
						`${chalk.cyan("Depends On:")} ${task.depends_on.join(", ")}`,
					);
				}

				if (task.blocked_by && task.blocked_by.length > 0) {
					console.log(
						`${chalk.cyan("Blocked By:")} ${task.blocked_by.join(", ")}`,
					);
				}

				if (task.recurrence_rule) {
					console.log(`${chalk.cyan("Recurrence:")}  ${task.recurrence_rule}`);
				}

				if (task.owner_id) {
					console.log(`${chalk.cyan("Owner:")}       ${task.owner_id}`);
				}

				if (task.reviewer_id) {
					console.log(`${chalk.cyan("Reviewer:")}    ${task.reviewer_id}`);
				}

				if (task.deleted_at) {
					console.log(`${chalk.cyan("Deleted At:")}  ${task.deleted_at}`);
				}

				if (task.parent_id) {
					console.log(`${chalk.cyan("Parent Task:")} ${task.parent_id}`);
				}

				if (typeof task.subtask_order === "number") {
					console.log(`${chalk.cyan("Subtask Order:")} #${task.subtask_order}`);
				}

				if (task.due_at) {
					console.log(`${chalk.cyan("Due At:")}      ${task.due_at}`);
				}

				const createdAt = task.created_at ?? localTask?.created_at ?? "N/A";
				const updatedAt = task.updated_at ?? localTask?.updated_at ?? "N/A";
				console.log(`${chalk.cyan("Created At:")}  ${createdAt}`);
				console.log(`${chalk.cyan("Updated At:")}  ${updatedAt}`);

				if (task.description) {
					console.log(`\n${chalk.cyan("Description:")}\n${task.description}`);
				}

				const remoteContext = await getRemoteTaskContext(task.id);
				const effectiveTaskContext =
					remoteContext?.task_context ?? task.task_context ?? "";
				const effectiveTaskContextSummary =
					remoteContext?.task_context_summary ??
					task.task_context_summary ??
					"";
				const relatedDecisionSource =
					task.related_decisions && task.related_decisions.length > 0
						? task.related_decisions
						: (localTask?.related_decisions ?? []);
				const relatedDecisions = relatedDecisionSource
					.map((entry) => entry.trim())
					.filter(Boolean);

				console.log(`\n${chalk.cyan("Context:")}`);
				if (effectiveTaskContextSummary) {
					console.log(chalk.gray("  Summary:"));
					console.log(`  ${effectiveTaskContextSummary}`);
				}
				if (effectiveTaskContext) {
					console.log(chalk.gray("  Full context:"));
					console.log(`  ${effectiveTaskContext}`);
				}
				if (!effectiveTaskContextSummary && !effectiveTaskContext) {
					console.log(chalk.gray("  No context recorded."));
				}

				console.log(`\n${chalk.cyan("Decisions:")}`);
				if (relatedDecisions.length === 0) {
					console.log(chalk.gray("  No related decisions."));
				} else {
					for (const decision of relatedDecisions) {
						console.log(`  - ${decision}`);
					}
				}

				if (task.evidence && task.evidence.length > 0) {
					console.log(`\n${chalk.cyan("Evidence:")}`);
					task.evidence.forEach((e) => {
						console.log(`  - ${e}`);
					});
				}

				if (task.actions && task.actions.length > 0) {
					console.log(`\n${chalk.cyan("Actions:")}`);
					task.actions.forEach((a) => {
						const type = a.type.replace(/_/g, " ").toUpperCase();
						console.log(
							`  ${chalk.gray(`[${a.created_at}]`)} ${chalk.bold(type)}${
								a.reasoning ? `: ${a.reasoning}` : ""
							}`,
						);
					});
				}
				console.log("");
			} catch (error: any) {
				console.error(
					chalk.red(`\n✖ Failed to get task details: ${error.message}\n`),
				);
				process.exitCode = 1;
			}
		});

	taskCmd
		.command("context <id>")
		.description("View or update task context")
		.option("--set <text>", "Replace task context")
		.option("--append <text>", "Append to task context")
		.option("--clear", "Clear task context")
		.action(async (id, options) => {
			try {
				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}
				const remoteContext = await getRemoteTaskContext(id);

				const hasUpdate =
					options.set !== undefined ||
					options.append !== undefined ||
					options.clear;

				if (!hasUpdate) {
					const currentContext =
						remoteContext?.task_context ?? task.task_context ?? "";
					if (currentContext.trim().length > 0) {
						console.log(`\n${chalk.cyan("Task Context:")}\n${currentContext}`);
					} else {
						console.log(chalk.yellow("\nNo task context found.\n"));
					}
					const currentSummary =
						remoteContext?.task_context_summary ??
						task.task_context_summary ??
						"";
					if (currentSummary.trim().length > 0) {
						console.log(
							`\n${chalk.cyan("Task Context Summary:")}\n${currentSummary}\n`,
						);
					}
					return;
				}

				let nextContext =
					remoteContext?.task_context ?? (task.task_context || "");
				if (options.clear) {
					nextContext = "";
				} else if (options.set !== undefined) {
					nextContext = options.set;
				} else if (options.append !== undefined) {
					nextContext = [nextContext, options.append]
						.filter(Boolean)
						.join("\n");
				}

				const remoteUpdated = await updateRemoteTaskContext(id, {
					task_context: nextContext || null,
				});

				if (localTask) {
					await taskService.updateTask(id, { task_context: nextContext });
				}

				console.log(
					chalk.green(
						`\n✔ Updated context for ${id}${remoteUpdated ? " (cloud + local cache)" : " (local cache)"}\n`,
					),
				);
			} catch (error: any) {
				console.error(
					chalk.red(`Failed to update task context: ${error.message}`),
				);
			}
		});

	taskCmd
		.command("assign <id> [assignee]")
		.description("Assign a task to a user")
		.action(async (id, assignee) => {
			try {
				const configService = new ConfigService();
				const key = await tryAuthenticatedKey(configService);
				const projectId = await configService.getProjectId();

				// If no assignee provided, try to fetch collaborators and prompt
				if (!assignee && key && projectId) {
					console.log(chalk.blue("Fetching assignable users..."));
					const res = await fetch(
						`${API_URL}/projects/${projectId}/collaborators`,
						{
							headers: {
								Authorization: `Bearer ${key}`,
								...(await buildDeviceHeaders(configService)),
							},
						},
					);

					if (res.ok) {
						const { github, members } = (await res.json()) as {
							github: any[];
							members: any[];
						};
						const choices = [
							...members.map((m) => ({ title: m.user_id, value: m.user_id })),
							...github.map((g) => ({
								title: `${g.login} (GitHub)`,
								value: g.login,
							})),
						];

						if (choices.length > 0) {
							const response = await prompts({
								type: "select",
								name: "assignee",
								message: "Select assignee:",
								choices,
							});
							assignee = response.assignee;
						}
					}
				}

				if (!assignee) {
					const response = await prompts({
						type: "text",
						name: "assignee",
						message: "Enter assignee (User ID or GitHub username):",
					});
					assignee = response.assignee;
				}

				if (!assignee) {
					console.log(chalk.yellow("No assignee provided."));
					return;
				}

				// Local Update
				await taskService.updateTask(id, { assignee });
				console.log(chalk.green(`\n✔ Task ${id} assigned to ${assignee}\n`));

				// Remote Update if possible
				if (key && projectId) {
					// We need the database task UUID. We can't easily get it without searching or keeping track.
					// However, the CLI doesn't store DB UUIDs for tasks, only external IDs (TASK-001).
					// We'll rely on the next `push` to sync the assignment, OR we could implement an endpoint
					// that takes the external ID and projectId.
					// Actually, my `POST /tasks/:taskId/assign` currently takes the DB UUID.
					// I should probably add an endpoint for assigning by external ID.
					console.log(
						chalk.gray("Tip: Run `vem push` to sync assignment to cloud."),
					);
				}
			} catch (error: any) {
				console.error(chalk.red(`Failed to assign task: ${error.message}`));
			}
		});

	taskCmd
		.command("add [title]")
		.description("Create a new task (interactive when title is omitted)")
		.option(
			"-p, --priority <priority>",
			"Priority (low, medium, high, critical)",
		)
		.option("-d, --description <description>", "Task description")
		.option("--tags <tags>", "Comma-separated tags")
		.option("--type <type>", "Task type (feature, bug, chore)")
		.option("--estimate-hours <hours>", "Estimated hours (e.g. 2.5)")
		.option("--depends-on <ids>", "Comma-separated task IDs")
		.option("--blocked-by <ids>", "Comma-separated task IDs")
		.option("--recurrence <rule>", "Recurrence rule (weekly, monthly, cron)")
		.option("--owner <id>", "Owner ID")
		.option("--reviewer <id>", "Reviewer ID")
		.option("--parent <id>", "Parent task ID")
		.option("--order <number>", "Subtask order")
		.option("--due-at <iso>", "Due date ISO string (YYYY-MM-DD)")
		.option(
			"--validation <steps>",
			'Comma-separated validation steps (e.g. "pnpm build, pnpm test")',
		)
		.option("--actor <name>", "Actor name for task creation")
		.option("-r, --reasoning <reasoning>", "Reasoning for creation")
		.action(async (title, options) => {
			await trackCommandUsage("task add");
			try {
				let taskTitle =
					typeof title === "string" && title.trim().length > 0
						? title.trim()
						: undefined;
				let priorityInput =
					typeof options.priority === "string" ? options.priority : undefined;
				let descriptionInput =
					typeof options.description === "string"
						? options.description
						: undefined;
				let tagsInput =
					typeof options.tags === "string" ? options.tags : undefined;
				let typeInput =
					typeof options.type === "string" ? options.type : undefined;
				let estimateHoursInput =
					typeof options.estimateHours === "string"
						? options.estimateHours
						: undefined;
				let dependsOnInput =
					typeof options.dependsOn === "string" ? options.dependsOn : undefined;
				let blockedByInput =
					typeof options.blockedBy === "string" ? options.blockedBy : undefined;
				let recurrenceInput =
					typeof options.recurrence === "string"
						? options.recurrence
						: undefined;
				let ownerInput =
					typeof options.owner === "string" ? options.owner : undefined;
				let reviewerInput =
					typeof options.reviewer === "string" ? options.reviewer : undefined;
				let parentInput =
					typeof options.parent === "string" ? options.parent : undefined;
				let orderInput =
					typeof options.order === "string" ? options.order : undefined;
				let dueAtInput =
					typeof options.dueAt === "string" ? options.dueAt : undefined;
				let validationInput =
					typeof options.validation === "string"
						? options.validation
						: undefined;
				let actorInput =
					typeof options.actor === "string" ? options.actor : undefined;
				let reasoningInput =
					typeof options.reasoning === "string" ? options.reasoning : undefined;

				const runWizard = !taskTitle;
				if (runWizard) {
					if (!process.stdin.isTTY) {
						throw new Error("Title is required in non-interactive mode.");
					}

					console.log(chalk.cyan("\nTask creation wizard"));
					console.log(
						chalk.gray(
							"Fill required fields first, then optional fields. Type :back to go back.",
						),
					);

					let requiredStep = 0;
					let selectedPriority: AddTaskPriority =
						normalizePriority(priorityInput);

					while (requiredStep < 2) {
						if (requiredStep === 0) {
							const prompt = await promptTextWithBack({
								message: "Task title:",
								initial: taskTitle,
								optional: false,
							});
							if (prompt.kind === "cancel") {
								console.log(chalk.yellow("Task creation cancelled."));
								return;
							}
							if (prompt.kind === "next") {
								taskTitle = prompt.value;
								requiredStep = 1;
							}
							continue;
						}

						const priorityPrompt = await promptSelectWithBack<AddTaskPriority>({
							message: "Priority:",
							choices: ADD_TASK_PRIORITIES.map((priority) => ({
								title: priority,
								value: priority,
							})),
							initial: selectedPriority,
							allowBack: true,
						});
						if (priorityPrompt.kind === "cancel") {
							console.log(chalk.yellow("Task creation cancelled."));
							return;
						}
						if (priorityPrompt.kind === "back") {
							requiredStep = 0;
							continue;
						}
						selectedPriority = priorityPrompt.value;
						priorityInput = selectedPriority;
						requiredStep = 2;
					}

					const optionalMode = await promptSelectWithBack<"configure" | "skip">(
						{
							message: "Configure optional fields now?",
							choices: [
								{
									title: "Yes, step through optional fields",
									value: "configure",
								},
								{ title: "No, create task now", value: "skip" },
							],
							initial: "configure",
							allowBack: true,
						},
					);
					if (optionalMode.kind === "cancel") {
						console.log(chalk.yellow("Task creation cancelled."));
						return;
					}
					if (optionalMode.kind === "back") {
						const priorityPrompt = await promptSelectWithBack<AddTaskPriority>({
							message: "Priority:",
							choices: ADD_TASK_PRIORITIES.map((priority) => ({
								title: priority,
								value: priority,
							})),
							initial: normalizePriority(priorityInput),
							allowBack: true,
						});
						if (priorityPrompt.kind === "cancel") {
							console.log(chalk.yellow("Task creation cancelled."));
							return;
						}
						if (priorityPrompt.kind === "back") {
							const titlePrompt = await promptTextWithBack({
								message: "Task title:",
								initial: taskTitle,
								optional: false,
							});
							if (titlePrompt.kind !== "next") {
								console.log(chalk.yellow("Task creation cancelled."));
								return;
							}
							taskTitle = titlePrompt.value;
							const retryPriorityPrompt =
								await promptSelectWithBack<AddTaskPriority>({
									message: "Priority:",
									choices: ADD_TASK_PRIORITIES.map((priority) => ({
										title: priority,
										value: priority,
									})),
									initial: normalizePriority(priorityInput),
									allowBack: false,
								});
							if (retryPriorityPrompt.kind !== "next") {
								console.log(chalk.yellow("Task creation cancelled."));
								return;
							}
							priorityInput = retryPriorityPrompt.value;
						} else {
							priorityInput = priorityPrompt.value;
						}
					}

					if (
						optionalMode.kind === "next" &&
						optionalMode.value === "configure"
					) {
						const optionalPrompts: Array<{
							message: string;
							getInitial: () => string | undefined;
							setValue: (value: string | undefined) => void;
							validate?: (value: string) => true | string;
						}> = [
							{
								message: "Description (optional):",
								getInitial: () => descriptionInput,
								setValue: (value) => {
									descriptionInput = value;
								},
							},
							{
								message: "Tags (comma-separated, optional):",
								getInitial: () => tagsInput,
								setValue: (value) => {
									tagsInput = value;
								},
							},
							{
								message: "Type (feature, bug, chore; optional):",
								getInitial: () => typeInput,
								setValue: (value) => {
									typeInput = value;
								},
								validate: (value) => {
									if (!value) return true;
									const normalized = value.toLowerCase();
									if (
										normalized === "feature" ||
										normalized === "bug" ||
										normalized === "chore"
									) {
										return true;
									}
									return "Type must be feature, bug, or chore.";
								},
							},
							{
								message: "Estimate hours (optional):",
								getInitial: () => estimateHoursInput,
								setValue: (value) => {
									estimateHoursInput = value;
								},
								validate: (value) =>
									!value || !Number.isNaN(Number.parseFloat(value))
										? true
										: "Estimate must be a number.",
							},
							{
								message: "Depends on (comma-separated task IDs, optional):",
								getInitial: () => dependsOnInput,
								setValue: (value) => {
									dependsOnInput = value;
								},
							},
							{
								message: "Blocked by (comma-separated task IDs, optional):",
								getInitial: () => blockedByInput,
								setValue: (value) => {
									blockedByInput = value;
								},
							},
							{
								message: "Recurrence rule (weekly, monthly, cron; optional):",
								getInitial: () => recurrenceInput,
								setValue: (value) => {
									recurrenceInput = value;
								},
							},
							{
								message: "Owner ID (optional):",
								getInitial: () => ownerInput,
								setValue: (value) => {
									ownerInput = value;
								},
							},
							{
								message: "Reviewer ID (optional):",
								getInitial: () => reviewerInput,
								setValue: (value) => {
									reviewerInput = value;
								},
							},
							{
								message: "Parent task ID (optional):",
								getInitial: () => parentInput,
								setValue: (value) => {
									parentInput = value;
								},
							},
							{
								message: "Subtask order (integer, optional):",
								getInitial: () => orderInput,
								setValue: (value) => {
									orderInput = value;
								},
								validate: (value) =>
									!value || /^-?\d+$/.test(value)
										? true
										: "Order must be an integer.",
							},
							{
								message: "Due date (YYYY-MM-DD or ISO, optional):",
								getInitial: () => dueAtInput,
								setValue: (value) => {
									dueAtInput = value;
								},
								validate: (value) => {
									if (!value) return true;
									try {
										parseDueAtIso(value);
										return true;
									} catch (error: any) {
										return error.message;
									}
								},
							},
							{
								message:
									"Validation steps (comma-separated, optional; e.g. pnpm build, pnpm test):",
								getInitial: () => validationInput,
								setValue: (value) => {
									validationInput = value;
								},
							},
							{
								message: "Actor name (optional):",
								getInitial: () => actorInput,
								setValue: (value) => {
									actorInput = value;
								},
							},
							{
								message: "Reasoning for creation (optional):",
								getInitial: () => reasoningInput,
								setValue: (value) => {
									reasoningInput = value;
								},
							},
						];

						let optionalIndex = 0;
						while (optionalIndex < optionalPrompts.length) {
							const field = optionalPrompts[optionalIndex];
							const prompt = await promptTextWithBack({
								message: field.message,
								initial: field.getInitial(),
								optional: true,
								allowBack: true,
								validate: field.validate,
							});
							if (prompt.kind === "cancel") {
								console.log(chalk.yellow("Task creation cancelled."));
								return;
							}
							if (prompt.kind === "back") {
								if (optionalIndex === 0) {
									const gatePrompt = await promptSelectWithBack<
										"configure" | "skip"
									>({
										message: "Configure optional fields now?",
										choices: [
											{
												title: "Yes, step through optional fields",
												value: "configure",
											},
											{ title: "No, create task now", value: "skip" },
										],
										initial: "configure",
										allowBack: true,
									});
									if (gatePrompt.kind === "cancel") {
										console.log(chalk.yellow("Task creation cancelled."));
										return;
									}
									if (
										gatePrompt.kind === "next" &&
										gatePrompt.value === "skip"
									) {
										break;
									}
									if (gatePrompt.kind === "back") {
										const priorityPrompt =
											await promptSelectWithBack<AddTaskPriority>({
												message: "Priority:",
												choices: ADD_TASK_PRIORITIES.map((priority) => ({
													title: priority,
													value: priority,
												})),
												initial: normalizePriority(priorityInput),
												allowBack: true,
											});
										if (priorityPrompt.kind === "cancel") {
											console.log(chalk.yellow("Task creation cancelled."));
											return;
										}
										if (priorityPrompt.kind === "back") {
											const titlePrompt = await promptTextWithBack({
												message: "Task title:",
												initial: taskTitle,
												optional: false,
											});
											if (titlePrompt.kind !== "next") {
												console.log(chalk.yellow("Task creation cancelled."));
												return;
											}
											taskTitle = titlePrompt.value;
										} else {
											priorityInput = priorityPrompt.value;
										}
									}
									continue;
								}
								optionalIndex -= 1;
								continue;
							}

							field.setValue(prompt.value);
							optionalIndex += 1;
						}
					}
				}

				if (!taskTitle || taskTitle.trim().length === 0) {
					throw new Error("Task title is required.");
				}

				const priority = normalizePriority(priorityInput);
				const estimate = parseOptionalFloat(
					estimateHoursInput,
					"estimate-hours",
				);
				const subtaskOrder = parseOptionalInt(orderInput, "order");
				const dueAt = parseDueAtIso(dueAtInput);
				const normalizedType = typeInput?.trim().toLowerCase();
				if (
					normalizedType &&
					normalizedType !== "feature" &&
					normalizedType !== "bug" &&
					normalizedType !== "chore"
				) {
					throw new Error("type must be feature, bug, or chore.");
				}
				const taskType =
					normalizedType === "feature" ||
					normalizedType === "bug" ||
					normalizedType === "chore"
						? normalizedType
						: undefined;

				let validationSteps = parseCommaList(validationInput);
				if (
					validationSteps === undefined &&
					process.stdin.isTTY &&
					!validationInput &&
					!runWizard
				) {
					const wantsValidation = await prompts({
						type: "confirm",
						name: "add",
						message: "Add validation steps for this task?",
						initial: false,
					});
					if (wantsValidation.add) {
						const response = await prompts({
							type: "text",
							name: "steps",
							message:
								'Enter validation steps (comma-separated, e.g. "pnpm build, pnpm test"):',
						});
						validationSteps = parseCommaList(response.steps);
					}
				}

				const parsedTags = parseCommaList(tagsInput);
				const parsedDependsOn = parseCommaList(dependsOnInput);
				const parsedBlockedBy = parseCommaList(blockedByInput);
				const actorName = resolveActorName(actorInput);

				const remoteTask = await createRemoteTask({
					title: taskTitle,
					description: descriptionInput,
					priority,
					tags: parsedTags,
					type: taskType,
					estimate_hours: estimate,
					depends_on: parsedDependsOn,
					blocked_by: parsedBlockedBy,
					recurrence_rule: recurrenceInput,
					owner_id: ownerInput,
					reviewer_id: reviewerInput,
					parent_id: parentInput,
					subtask_order: subtaskOrder,
					due_at: dueAt,
					validation_steps: validationSteps,
				});

				if (remoteTask) {
					const localTask = await taskService.getTask(remoteTask.id);
					if (!localTask) {
						const cachedType =
							remoteTask.type === "feature" ||
							remoteTask.type === "bug" ||
							remoteTask.type === "chore"
								? remoteTask.type
								: undefined;
						await taskService.addTask(
							remoteTask.title,
							remoteTask.description,
							normalizePriority(remoteTask.priority),
							reasoningInput,
							{
								id: remoteTask.id,
								status: remoteTask.status,
								assignee: remoteTask.assignee,
								tags: remoteTask.tags,
								type: cachedType,
								estimate_hours: remoteTask.estimate_hours,
								depends_on: remoteTask.depends_on,
								blocked_by: remoteTask.blocked_by,
								recurrence_rule: remoteTask.recurrence_rule,
								owner_id: remoteTask.owner_id,
								reviewer_id: remoteTask.reviewer_id,
								parent_id: remoteTask.parent_id,
								subtask_order: remoteTask.subtask_order,
								due_at: remoteTask.due_at,
								task_context: remoteTask.task_context,
								task_context_summary: remoteTask.task_context_summary,
								evidence: remoteTask.evidence,
								validation_steps: remoteTask.validation_steps,
								actor: actorName,
							},
						);
					}
					console.log(
						chalk.green(
							`\n✔ Task created: ${remoteTask.id} (cloud + local cache)\n`,
						),
					);
					console.log(
						chalk.gray(
							`Tip: Start working with AI context via \`vem agent --task ${remoteTask.id}\``,
						),
					);
					return;
				}

				const task = await taskService.addTask(
					taskTitle,
					descriptionInput,
					priority,
					reasoningInput,
					{
						tags: parsedTags,
						type: taskType,
						estimate_hours: estimate,
						depends_on: parsedDependsOn,
						blocked_by: parsedBlockedBy,
						recurrence_rule: recurrenceInput,
						owner_id: ownerInput,
						reviewer_id: reviewerInput,
						parent_id: parentInput,
						subtask_order: subtaskOrder,
						due_at: dueAt,
						validation_steps: validationSteps,
						actor: actorName,
					},
				);
				console.log(
					chalk.green(`\n✔ Task created: ${task.id} (local cache)\n`),
				);
				console.log(
					chalk.gray(
						`Tip: Start working with AI context via \`vem agent --task ${task.id}\``,
					),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to create task: ${error.message}`));
			}
		});

	taskCmd
		.command("update <id>")
		.description("Update task metadata")
		.option("--tags <tags>", "Comma-separated tags")
		.option("--type <type>", "Task type (feature, bug, chore)")
		.option("--estimate-hours <hours>", "Estimated hours (e.g. 2.5)")
		.option("--depends-on <ids>", "Comma-separated task IDs")
		.option("--blocked-by <ids>", "Comma-separated task IDs")
		.option("--recurrence <rule>", "Recurrence rule (weekly, monthly, cron)")
		.option("--owner <id>", "Owner ID")
		.option("--reviewer <id>", "Reviewer ID")
		.option("--parent <id>", "Parent task ID")
		.option("--order <number>", "Subtask order")
		.option("--due-at <iso>", "Due date ISO string (YYYY-MM-DD)")
		.option(
			"--validation <steps>",
			"Set validation steps (comma-separated). Use empty string to clear.",
		)
		.option("--actor <name>", "Actor name for task update")
		.option("-r, --reasoning <reasoning>", "Reasoning for update")
		.action(async (id, options) => {
			try {
				const estimate =
					options.estimateHours !== undefined
						? Number.parseFloat(options.estimateHours)
						: undefined;
				if (estimate !== undefined && Number.isNaN(estimate)) {
					throw new Error("estimate-hours must be a number");
				}
				const dueAt =
					options.dueAt && options.dueAt.trim().length > 0
						? new Date(
								options.dueAt.length === 10
									? `${options.dueAt}T00:00:00.000Z`
									: options.dueAt,
							).toISOString()
						: undefined;

				const parsedTags = parseCommaList(options.tags);
				const parsedDependsOn = parseCommaList(options.dependsOn);
				const parsedBlockedBy = parseCommaList(options.blockedBy);
				const parsedValidation = parseCommaList(options.validation);
				const parsedOrder =
					options.order !== undefined
						? Number.parseInt(options.order, 10)
						: undefined;
				const actorName = resolveActorName(options.actor);

				const remoteUpdated = await updateRemoteTaskMeta(id, {
					tags: parsedTags,
					type: options.type,
					estimate_hours: estimate,
					depends_on: parsedDependsOn,
					blocked_by: parsedBlockedBy,
					recurrence_rule: options.recurrence,
					owner_id: options.owner,
					reviewer_id: options.reviewer,
					parent_id: options.parent,
					subtask_order: parsedOrder,
					due_at: dueAt,
					validation_steps: parsedValidation,
				});

				const localTask = await taskService.getTask(id);
				if (localTask) {
					await taskService.updateTask(id, {
						tags: parsedTags,
						type: options.type,
						estimate_hours: estimate,
						depends_on: parsedDependsOn,
						blocked_by: parsedBlockedBy,
						recurrence_rule: options.recurrence,
						owner_id: options.owner,
						reviewer_id: options.reviewer,
						parent_id: options.parent,
						subtask_order: parsedOrder,
						due_at: dueAt,
						validation_steps: parsedValidation,
						reasoning: options.reasoning,
						actor: actorName,
					});
				}

				if (remoteUpdated) {
					console.log(
						chalk.green(
							`\n✔ Task ${id} updated${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(chalk.green(`\n✔ Task ${id} updated (local cache)\n`));
			} catch (error: any) {
				console.error(chalk.red(`Failed to update task: ${error.message}`));
			}
		});

	taskCmd
		.command("done [id]")
		.description("Mark a task as complete")
		.option(
			"-e, --evidence <evidence>",
			"Evidence for completion (file path or command). Use comma-separated values for multiple entries.",
		)
		.option("-r, --reasoning <reasoning>", "Reasoning for completion")
		.option(
			"--validation <steps>",
			"Comma-separated validation steps completed (required when task has validation steps)",
		)
		.option("--actor <name>", "Actor name for task completion")
		.option(
			"--context-summary <summary>",
			"Summary of the task context to preserve after completion",
		)
		.action(async (id, options) => {
			await trackCommandUsage("task done");
			try {
				if (!id) {
					const tasks = await taskService.getTasks();
					const inProgress = tasks.filter(
						(t) => t.status === "in-progress" && !t.deleted_at,
					);

					if (inProgress.length === 0) {
						console.error(
							chalk.yellow(
								"No tasks in progress. Provide an ID explicitly or start a task first.",
							),
						);
						return;
					}

					const response = await prompts({
						type: "select",
						name: "id",
						message: "Select a task to complete:",
						choices: inProgress.map((t) => ({
							title: `${t.id}: ${t.title}`,
							value: t.id,
						})),
					});

					if (!response.id) {
						console.log(chalk.yellow("Operation cancelled."));
						return;
					}
					id = response.id;
				}

				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				const evidence = parseCommaList(options.evidence) ?? [];
				const actorName = resolveActorName(options.actor);

				let contextSummary = options.contextSummary as string | undefined;
				if (!contextSummary && task.task_context && process.stdin.isTTY) {
					const summary = await prompts({
						type: "text",
						name: "text",
						message:
							"Task has context. Provide a brief summary to keep after completion (optional):",
					});
					contextSummary = summary.text || undefined;
				}
				if (!contextSummary && task.task_context) {
					contextSummary = summarizeTaskContext(task.task_context);
				}

				const requiredValidation = task.validation_steps ?? [];
				let validatedSteps = parseCommaList(options.validation);
				if (requiredValidation.length > 0 && validatedSteps === undefined) {
					if (!process.stdin.isTTY) {
						throw new Error(
							"Validation steps are required. Re-run with --validation in non-interactive mode.",
						);
					}
					const confirmed: string[] = [];
					for (const step of requiredValidation) {
						const response = await prompts({
							type: "confirm",
							name: "done",
							message: `Validation step completed? ${step}`,
							initial: true,
						});
						if (!response.done) {
							console.log(
								chalk.yellow(
									"Task completion cancelled. Complete all validation steps first.",
								),
							);
							return;
						}
						confirmed.push(step);
					}
					validatedSteps = confirmed;
				}

				if (requiredValidation.length > 0) {
					const _requiredSet = new Set(requiredValidation);
					const providedSet = new Set(validatedSteps ?? []);
					const missing = requiredValidation.filter(
						(step) => !providedSet.has(step),
					);
					if (missing.length > 0) {
						throw new Error(`Missing validation steps: ${missing.join(", ")}.`);
					}
					for (const step of requiredValidation) {
						const entry = `Validated: ${step}`;
						if (!evidence.includes(entry)) {
							evidence.push(entry);
						}
					}
				}

				const remoteUpdated = await updateRemoteTaskMeta(id, {
					status: "done",
					evidence,
					reasoning: options.reasoning,
					actor: actorName,
				});
				const remoteContextUpdated = await updateRemoteTaskContext(id, {
					task_context: null,
					task_context_summary: contextSummary ?? null,
				});

				if (localTask) {
					await taskService.updateTask(id, {
						status: "done",
						evidence,
						reasoning: options.reasoning,
						task_context_summary: contextSummary,
						actor: actorName,
					});
				}

				if (remoteUpdated || remoteContextUpdated) {
					console.log(
						chalk.green(
							`\n✔ Task ${id} marked as DONE${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(
					chalk.green(`\n✔ Task ${id} marked as DONE (local cache)\n`),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to complete task: ${error.message}`));
			}
		});

	taskCmd
		.command("start [id]")
		.description("Start working on a task (set status to in-progress)")
		.option("-r, --reasoning <reasoning>", "Reasoning for starting the task")
		.option("--actor <name>", "Actor name")
		.action(async (id, options) => {
			await trackCommandUsage("task start");
			try {
				if (!id) {
					const tasks = await taskService.getTasks();
					const todoTasks = tasks.filter(
						(t) => t.status === "todo" && !t.deleted_at,
					);

					if (todoTasks.length === 0) {
						console.error(chalk.yellow("No tasks in TODO status to start."));
						return;
					}

					const response = await prompts({
						type: "select",
						name: "id",
						message: "Select a task to start:",
						choices: todoTasks.map((t) => ({
							title: `${t.id}: ${t.title}`,
							value: t.id,
						})),
					});

					if (!response.id) {
						console.log(chalk.yellow("Operation cancelled."));
						return;
					}
					id = response.id;
				}

				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				if (task.status === "in-progress") {
					console.log(chalk.yellow(`Task ${id} is already in progress.`));
					return;
				}

				if (task.status === "done") {
					console.error(chalk.red(`Task ${id} is already completed.`));
					return;
				}

				const reasoning = options.reasoning || "Started working on task";
				const actorName = resolveActorName(options.actor);

				// Detect and attach current agent session
				const gitRoot = await (async () => {
					try {
						const { execSync } = await import("node:child_process");
						return execSync("git rev-parse --show-toplevel", {
							encoding: "utf-8",
						}).trim();
					} catch {
						return undefined;
					}
				})();
				if (gitRoot) {
					try {
						const sessions = await listAllAgentSessions(gitRoot);
						if (sessions.length > 0) {
							const latestSession = sessions[0];
							const existingSessions: TaskSessionRef[] =
								(localTask?.sessions as any) || [];
							const alreadyAttached = existingSessions.some(
								(s) => s.id === latestSession.id,
							);
							if (!alreadyAttached) {
								// Use the task title as the session summary so it's clear what the
								// agent was working on, rather than the session's own auto-generated title.
								const sessionSummary =
									localTask?.title ?? latestSession.summary;
								const sessionRef: TaskSessionRef = {
									id: latestSession.id,
									source: latestSession.source,
									started_at: new Date().toISOString(),
									...(sessionSummary ? { summary: sessionSummary } : {}),
								};
								if (localTask) {
									const updatedSessions = [...existingSessions, sessionRef];
									await taskService.updateTask(id, {
										sessions: updatedSessions,
									});
									// Immediately sync sessions to remote
									await updateRemoteTaskMeta(id, { sessions: updatedSessions });
								}
							}
						}
					} catch {
						/* non-fatal */
					}
				}

				const remoteUpdated = await updateRemoteTaskMeta(id, {
					status: "in-progress",
					reasoning,
					actor: actorName,
				});
				if (localTask) {
					await taskService.updateTask(id, {
						status: "in-progress",
						reasoning,
						actor: actorName,
					});
				}

				if (remoteUpdated) {
					console.log(
						chalk.green(
							`\n✔ Task ${id} is now IN PROGRESS${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(
					chalk.green(`\n✔ Task ${id} is now IN PROGRESS (local cache)\n`),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to start task: ${error.message}`));
			}
		});

	taskCmd
		.command("block <id>")
		.description("Mark a task as blocked")
		.option("-r, --reasoning <reasoning>", "Reason for blocking (required)")
		.option("--blocked-by <ids>", "Comma-separated task IDs blocking this task")
		.option("--actor <name>", "Actor name")
		.action(async (id, options) => {
			try {
				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				if (task.status === "done") {
					console.error(chalk.red(`Cannot block a completed task.`));
					return;
				}

				if (!options.reasoning) {
					console.error(
						chalk.red(
							"Reasoning is required when blocking a task. Use -r or --reasoning.",
						),
					);
					return;
				}

				const actorName = resolveActorName(options.actor);
				const blockedBy = parseCommaList(options.blockedBy) || task.blocked_by;
				const remoteUpdated = await updateRemoteTaskMeta(id, {
					status: "blocked",
					blocked_by: blockedBy,
					reasoning: options.reasoning,
					actor: actorName,
				});
				if (localTask) {
					await taskService.updateTask(id, {
						status: "blocked",
						blocked_by: blockedBy,
						reasoning: options.reasoning,
						actor: actorName,
					});
				}

				if (remoteUpdated) {
					console.log(
						chalk.yellow(
							`\n⚠ Task ${id} is now BLOCKED${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(
					chalk.yellow(`\n⚠ Task ${id} is now BLOCKED (local cache)\n`),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to block task: ${error.message}`));
			}
		});

	taskCmd
		.command("unblock <id>")
		.description("Unblock a task (set status back to todo)")
		.option("-r, --reasoning <reasoning>", "Reason for unblocking")
		.option("--actor <name>", "Actor name")
		.action(async (id, options) => {
			try {
				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				if (task.status !== "blocked") {
					console.log(
						chalk.yellow(`Task ${id} is not blocked (status: ${task.status}).`),
					);
					return;
				}

				const reasoning = options.reasoning || "Unblocked task";
				const actorName = resolveActorName(options.actor);
				const remoteUpdated = await updateRemoteTaskMeta(id, {
					status: "todo",
					blocked_by: [],
					reasoning,
					actor: actorName,
				});
				if (localTask) {
					await taskService.updateTask(id, {
						status: "todo",
						blocked_by: [],
						reasoning,
						actor: actorName,
					});
				}

				if (remoteUpdated) {
					console.log(
						chalk.green(
							`\n✔ Task ${id} is now unblocked (TODO)${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(
					chalk.green(`\n✔ Task ${id} is now unblocked (TODO) (local cache)\n`),
				);
			} catch (error: any) {
				console.error(chalk.red(`Failed to unblock task: ${error.message}`));
			}
		});

	taskCmd
		.command("delete <id>")
		.description("Soft delete a task")
		.option("-r, --reasoning <reasoning>", "Reasoning for deletion")
		.action(async (id, options) => {
			try {
				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				const deletedAt = new Date().toISOString();
				const remoteUpdated = await updateRemoteTaskMeta(id, {
					deleted_at: deletedAt,
					reasoning: options.reasoning,
				});
				if (localTask) {
					await taskService.updateTask(id, {
						deleted_at: deletedAt,
						reasoning: options.reasoning,
					});
				}

				if (remoteUpdated) {
					console.log(
						chalk.green(
							`\n✔ Task ${id} soft deleted${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(chalk.green(`\n✔ Task ${id} soft deleted (local cache)\n`));
			} catch (error: any) {
				console.error(chalk.red(`Failed to delete task: ${error.message}`));
			}
		});

	program
		.command("delete <id>")
		.description("Soft delete a task")
		.option("-r, --reasoning <reasoning>", "Reasoning for deletion")
		.action(async (id, options) => {
			try {
				const [remoteTask] = await getDisplayTasks({
					id,
					includeDeleted: true,
				});
				const localTask = await taskService.getTask(id);
				const task = remoteTask ?? localTask;
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				const deletedAt = new Date().toISOString();
				const remoteUpdated = await updateRemoteTaskMeta(id, {
					deleted_at: deletedAt,
					reasoning: options.reasoning,
				});
				if (localTask) {
					await taskService.updateTask(id, {
						deleted_at: deletedAt,
						reasoning: options.reasoning,
					});
				}

				if (remoteUpdated) {
					console.log(
						chalk.green(
							`\n✔ Task ${id} soft deleted${localTask ? " (cloud + local cache)" : " (cloud)"}\n`,
						),
					);
					return;
				}

				if (!localTask) {
					throw new Error(
						`Task ${id} not found in cloud or local cache. Verify the ID and project link.`,
					);
				}

				console.log(chalk.green(`\n✔ Task ${id} soft deleted (local cache)\n`));
			} catch (error: any) {
				console.error(chalk.red(`Failed to delete task: ${error.message}`));
			}
		});

	taskCmd
		.command("sessions <id>")
		.description("Show all agent sessions attached to a task")
		.action(async (id) => {
			await trackCommandUsage("task sessions");
			try {
				const task = await taskService.getTask(id);
				if (!task) {
					console.error(chalk.red(`Task ${id} not found.`));
					return;
				}

				const sessions: TaskSessionRef[] = (task.sessions as any) || [];
				if (sessions.length === 0) {
					console.log(
						chalk.yellow(`\nNo agent sessions attached to ${id} yet.`),
					);
					console.log(
						chalk.gray(
							`  Run "vem task start ${id}" to attach the current session.\n`,
						),
					);
					return;
				}

				console.log(
					chalk.bold(`\n🔗 Sessions attached to ${id}: ${task.title}\n`),
				);

				const table = new Table({
					head: ["Source", "Session ID", "Started", "Summary"].map((h) =>
						chalk.white.bold(h),
					),
					colWidths: [10, 20, 18, 50],
					style: { border: ["gray"] },
				});

				for (const s of sessions) {
					const sourceColor =
						s.source === "copilot"
							? chalk.blue
							: s.source === "claude"
								? chalk.magenta
								: chalk.green;
					table.push([
						sourceColor(s.source),
						chalk.gray(`${s.id.slice(0, 16)}…`),
						chalk.white(
							new Date(s.started_at).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							}),
						),
						chalk.gray(s.summary?.slice(0, 48) || "—"),
					]);
				}

				console.log(table.toString());
				console.log();
			} catch (error: any) {
				console.error(
					chalk.red(`Failed to show task sessions: ${error.message}`),
				);
			}
		});
}
