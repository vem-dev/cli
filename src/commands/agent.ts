import { execSync, spawn } from "node:child_process";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	type ApplyVemUpdateResult,
	applyVemUpdate,
	ConfigService,
	computeSessionStats,
	ensureVemDir,
	ensureVemFiles,
	formatVemPack,
	getVemDir,
	listAllAgentSessions,
	parseVemUpdateBlock,
} from "@vem/core";
import type {
	RelatedDecisionRef,
	TaskSessionRef,
	VemUpdate,
} from "@vem/schemas";
import chalk from "chalk";
import type { Command } from "commander";
import prompts from "prompts";
import {
	API_URL,
	buildDeviceHeaders,
	computeVemHash,
	detectVemUpdateInOutput,
	enforceStrictMemoryUpdates,
	getGitRemote,
	isVemDirty,
	processQueue,
	resolveActorName,
	syncProjectMemoryToRemote,
	syncService,
	TASK_CONTEXT_FILE,
	taskService,
	trackAgentSession,
	trackCommandUsage,
	trackFeatureUsage,
	tryAuthenticatedKey,
} from "../runtime.js";

function shellEscapeArg(arg: string): string {
	return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function truncateForDisplay(value: string, maxChars: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	return `${trimmed.slice(0, Math.max(0, maxChars - 15)).trimEnd()}\n...[truncated]`;
}

type AgentTask = Awaited<ReturnType<typeof taskService.getTasks>>[number] & {
	db_id?: string;
};

const AGENT_TASK_STATUSES = new Set(["todo", "in-review", "in-progress", "blocked", "done"]);
const MAX_CHILD_TASKS_IN_PROMPT = 12;
const TASK_STATUS_ORDER: Record<AgentTask["status"], number> = {
	"in-review": 0,
	"in-progress": 1,
	todo: 2,
	blocked: 3,
	done: 4,
};

const debugAgentSync = (...messages: string[]) => {
	if (process.env.VEM_DEBUG !== "1") return;
	console.log(chalk.gray(`[agent-sync] ${messages.join(" ")}`));
};

const resolveApiKey = async (
	configService: ConfigService,
): Promise<string | null> => {
	const verified = await tryAuthenticatedKey(configService);
	if (verified) return verified;
	const stored = await configService.getApiKey();
	return typeof stored === "string" && stored.trim().length > 0 ? stored : null;
};

const asTrimmedString = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeAgentTask = (input: unknown): AgentTask | null => {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	const id = asTrimmedString(record.id);
	const title = asTrimmedString(record.title);
	const statusRaw = asTrimmedString(record.status);
	if (!id || !title || !statusRaw || !AGENT_TASK_STATUSES.has(statusRaw)) {
		return null;
	}

	return {
		...(record as AgentTask),
		id,
		title,
		status: statusRaw as AgentTask["status"],
		db_id: asTrimmedString(record.db_id),
		description: asTrimmedString(record.description),
		deleted_at: asTrimmedString(record.deleted_at),
	};
};

const fetchRemoteAgentTasks = async (
	configService: ConfigService,
): Promise<{ visible: AgentTask[]; deletedIds: Set<string> } | null> => {
	try {
		const [apiKey, projectId] = await Promise.all([
			resolveApiKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return null;

		const query = new URLSearchParams({
			include_deleted: "true",
		});
		const response = await fetch(
			`${API_URL}/projects/${projectId}/tasks?${query.toString()}`,
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

		const normalized = body.tasks
			.map((task) => normalizeAgentTask(task))
			.filter((task): task is AgentTask => Boolean(task));
		const deletedIds = new Set(
			normalized
				.filter((task) => Boolean(task.deleted_at))
				.map((task) => task.id),
		);
		const visible = normalized.filter((task) => !task.deleted_at);
		return { visible, deletedIds };
	} catch {
		return null;
	}
};

const fetchRemoteAgentTaskById = async (
	configService: ConfigService,
	taskId: string,
): Promise<AgentTask | null> => {
	try {
		const [apiKey, projectId] = await Promise.all([
			resolveApiKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return null;

		const query = new URLSearchParams({
			id: taskId,
			include_deleted: "true",
		});
		const response = await fetch(
			`${API_URL}/projects/${projectId}/tasks?${query.toString()}`,
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

		const normalized = body.tasks
			.map((task) => normalizeAgentTask(task))
			.filter((task): task is AgentTask => Boolean(task));
		if (normalized.length === 0) return null;
		return normalized.find((task) => task.id === taskId) ?? normalized[0];
	} catch {
		return null;
	}
};

const mergeAgentTasks = (
	localTasks: AgentTask[],
	remote: { visible: AgentTask[]; deletedIds: Set<string> } | null,
): AgentTask[] => {
	if (!remote) return localTasks;

	const merged = new Map<string, AgentTask>(
		remote.visible.map((task) => [task.id, task]),
	);

	for (const localTask of localTasks) {
		if (localTask.deleted_at) continue;
		if (remote.deletedIds.has(localTask.id)) continue;
		if (merged.has(localTask.id)) continue;
		merged.set(localTask.id, localTask);
	}

	return Array.from(merged.values());
};

const updateTaskMetaRemote = async (
	configService: ConfigService,
	task: AgentTask,
	patch: {
		status?: AgentTask["status"];
		evidence?: string[];
		related_decisions?: string[];
		sessions?: unknown[];
		reasoning?: string;
		actor?: string;
	},
): Promise<boolean> => {
	try {
		const [apiKey, projectId] = await Promise.all([
			resolveApiKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) {
			debugAgentSync(
				"updateTaskMetaRemote skipped:",
				`apiKey=${Boolean(apiKey)}`,
				`projectId=${Boolean(projectId)}`,
			);
			return false;
		}

		const query = new URLSearchParams({
			id: task.id,
			include_deleted: "true",
		});
		const lookupResponse = await fetch(
			`${API_URL}/projects/${projectId}/tasks?${query.toString()}`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					...(await buildDeviceHeaders(configService)),
				},
			},
		);
		if (!lookupResponse.ok) {
			debugAgentSync(
				"task lookup failed:",
				String(lookupResponse.status),
				lookupResponse.statusText,
			);
			return false;
		}

		const lookupBody = (await lookupResponse.json()) as {
			tasks?: Array<Record<string, unknown>>;
		};
		const remoteTask = Array.isArray(lookupBody.tasks)
			? (lookupBody.tasks.find(
					(entry) => asTrimmedString(entry.id) === task.id,
				) ?? lookupBody.tasks[0])
			: null;
		const dbId =
			asTrimmedString(remoteTask?.db_id) ?? asTrimmedString(task.db_id);
		if (!dbId) {
			debugAgentSync("task lookup missing db_id", `task=${task.id}`);
			return false;
		}

		const normalizeStringArray = (value: unknown) =>
			Array.isArray(value)
				? value.map((entry) => String(entry).trim()).filter(Boolean)
				: [];
		const normalizeNumber = (value: unknown) => {
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string" && value.trim().length > 0) {
				const parsed = Number(value);
				return Number.isFinite(parsed) ? parsed : null;
			}
			return null;
		};
		const normalizedEvidence =
			patch.evidence !== undefined
				? patch.evidence.map((entry) => entry.trim()).filter(Boolean)
				: undefined;
		const normalizedRelatedDecisions: RelatedDecisionRef[] | undefined =
			patch.related_decisions !== undefined
				? patch.related_decisions.filter(
						(entry): entry is RelatedDecisionRef =>
							(typeof entry === "string" && entry.trim().length > 0) ||
							(typeof entry === "object" &&
								entry !== null &&
								Boolean(entry.id)),
					)
				: undefined;
		const normalizedSessions =
			Array.isArray(patch.sessions) && patch.sessions.length > 0
				? patch.sessions
				: undefined;

		const payload: Record<string, unknown> = {
			title: asTrimmedString(remoteTask?.title) ?? task.title,
			description:
				asTrimmedString(remoteTask?.description) ?? task.description ?? null,
			status: asTrimmedString(remoteTask?.status) ?? task.status,
			priority: asTrimmedString(remoteTask?.priority) ?? "medium",
			tags: normalizeStringArray(remoteTask?.tags),
			type: asTrimmedString(remoteTask?.type) ?? null,
			estimate_hours: normalizeNumber(remoteTask?.estimate_hours),
			depends_on: normalizeStringArray(remoteTask?.depends_on),
			blocked_by: normalizeStringArray(remoteTask?.blocked_by),
			recurrence_rule: asTrimmedString(remoteTask?.recurrence_rule) ?? null,
			owner_id: asTrimmedString(remoteTask?.owner_id) ?? null,
			reviewer_id: asTrimmedString(remoteTask?.reviewer_id) ?? null,
			parent_id: asTrimmedString(remoteTask?.parent_id) ?? null,
			subtask_order:
				typeof remoteTask?.subtask_order === "number"
					? remoteTask.subtask_order
					: null,
			due_at: asTrimmedString(remoteTask?.due_at) ?? null,
			validation_steps: normalizeStringArray(remoteTask?.validation_steps),
			evidence: normalizeStringArray(remoteTask?.evidence),
			related_decisions: Array.isArray(remoteTask?.related_decisions)
				? (remoteTask.related_decisions as RelatedDecisionRef[])
				: [],
			deleted_at: asTrimmedString(remoteTask?.deleted_at) ?? null,
		};

		if (patch.status !== undefined) payload.status = patch.status;
		if (normalizedEvidence !== undefined) payload.evidence = normalizedEvidence;
		if (normalizedRelatedDecisions !== undefined) {
			payload.related_decisions = normalizedRelatedDecisions;
		}
		if (normalizedSessions !== undefined) {
			payload.sessions = normalizedSessions;
		}
		if (patch.reasoning !== undefined) payload.reasoning = patch.reasoning;
		if (patch.actor !== undefined) {
			payload.actor =
				patch.actor.trim().length > 0 ? patch.actor.trim() : undefined;
		}

		const response = await fetch(
			`${API_URL}/tasks/${encodeURIComponent(dbId)}/meta`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					...(await buildDeviceHeaders(configService)),
				},
				body: JSON.stringify(payload),
			},
		);
		if (!response.ok) {
			const errorBody = await response.text().catch(() => "");
			debugAgentSync(
				"task meta update failed:",
				String(response.status),
				response.statusText,
				errorBody ? `body=${errorBody}` : "",
			);
		}
		return response.ok;
	} catch (error: any) {
		debugAgentSync(
			"task meta update threw:",
			error?.message ? String(error.message) : String(error),
		);
		return false;
	}
};

const updateTaskContextRemote = async (
	configService: ConfigService,
	task: AgentTask,
	payload: {
		task_context?: string | null;
		task_context_summary?: string | null;
	},
): Promise<boolean> => {
	try {
		const [apiKey, projectId] = await Promise.all([
			resolveApiKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return false;

		const response = await fetch(
			`${API_URL}/projects/${projectId}/tasks/${encodeURIComponent(task.id)}/context`,
			{
				method: "PUT",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					...(await buildDeviceHeaders(configService)),
				},
				body: JSON.stringify(payload),
			},
		);
		return response.ok;
	} catch {
		return false;
	}
};

const markTaskInProgressRemote = async (
	configService: ConfigService,
	task: AgentTask,
	actor?: string,
): Promise<boolean> => {
	return updateTaskMetaRemote(configService, task, {
		status: "in-progress",
		reasoning: "Started via vem agent",
		actor,
	});
};

type ParsedTaskUpdate = NonNullable<VemUpdate["tasks"]>[number];
type RemoteTaskContextPatch = {
	task_context?: string | null;
	task_context_summary?: string | null;
};

export const buildRemoteTaskContextPatch = (
	patch: ParsedTaskUpdate,
	updatedTask: Pick<AgentTask, "task_context" | "task_context_summary">,
): RemoteTaskContextPatch | null => {
	const hasExplicitTaskContext = patch.task_context !== undefined;
	const hasExplicitTaskContextSummary =
		patch.task_context_summary !== undefined;
	const isDoneUpdate = patch.status === "done";

	const payload: RemoteTaskContextPatch = {};
	if (isDoneUpdate) {
		payload.task_context = updatedTask.task_context ?? null;
		if (hasExplicitTaskContextSummary) {
			payload.task_context_summary = patch.task_context_summary || null;
		} else if (updatedTask.task_context_summary !== undefined) {
			payload.task_context_summary = updatedTask.task_context_summary || null;
		}
	} else {
		if (hasExplicitTaskContext) {
			payload.task_context = patch.task_context || null;
		}
		if (hasExplicitTaskContextSummary) {
			payload.task_context_summary = patch.task_context_summary || null;
		}
	}

	return Object.keys(payload).length > 0 ? payload : null;
};

const syncParsedTaskUpdatesToRemote = async (
	configService: ConfigService,
	update: VemUpdate,
	result: ApplyVemUpdateResult | null,
): Promise<void> => {
	if (!result || !update.tasks || update.tasks.length === 0) return;

	const patchById = new Map(update.tasks.map((entry) => [entry.id, entry]));
	for (const updatedTask of result.updatedTasks) {
		const patch = patchById.get(updatedTask.id);
		if (!patch) continue;

		const remoteTaskRef = updatedTask as AgentTask;
		await updateTaskMetaRemote(configService, remoteTaskRef, {
			status: (patch.status ?? updatedTask.status) as AgentTask["status"],
			evidence: patch.evidence ?? updatedTask.evidence,
			related_decisions:
				patch.related_decisions ?? updatedTask.related_decisions,
			sessions: Array.isArray(updatedTask.sessions)
				? (updatedTask.sessions as unknown[])
				: undefined,
			reasoning: patch.reasoning,
			actor: patch.actor,
		});

		const taskContextPatch = buildRemoteTaskContextPatch(patch, updatedTask);
		if (taskContextPatch) {
			await updateTaskContextRemote(
				configService,
				remoteTaskRef,
				taskContextPatch,
			);
		}
	}
};

const mergeTaskContextWithNote = (
	existing: string | undefined,
	note: string,
) => {
	const trimmed = note.trim();
	if (!trimmed) return existing?.trim() || "";
	const noteBlock = `User note (${new Date().toISOString()}):\n${trimmed}`;
	const current = existing?.trim();
	return current && current.length > 0
		? `${current}\n\n${noteBlock}`
		: noteBlock;
};

const appendTaskNotesToContext = async (
	configService: ConfigService,
	task: AgentTask,
	notes: string,
): Promise<void> => {
	const trimmed = notes.trim();
	if (!trimmed) return;

	const localTask = await taskService.getTask(task.id);
	if (localTask) {
		const merged = mergeTaskContextWithNote(localTask.task_context, trimmed);
		await taskService.updateTask(task.id, { task_context: merged });
	}

	try {
		const [apiKey, projectId] = await Promise.all([
			resolveApiKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return;

		let remoteContext = "";
		const getResponse = await fetch(
			`${API_URL}/projects/${projectId}/tasks/${encodeURIComponent(task.id)}/context`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					...(await buildDeviceHeaders(configService)),
				},
			},
		);
		if (getResponse.ok) {
			const body = (await getResponse.json()) as {
				task_context?: unknown;
			};
			remoteContext =
				typeof body.task_context === "string" ? body.task_context : "";
		}

		const mergedRemoteContext = mergeTaskContextWithNote(
			remoteContext,
			trimmed,
		);
		await fetch(
			`${API_URL}/projects/${projectId}/tasks/${encodeURIComponent(task.id)}/context`,
			{
				method: "PUT",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					...(await buildDeviceHeaders(configService)),
				},
				body: JSON.stringify({
					task_context: mergedRemoteContext,
				}),
			},
		);

		// Also save to user_notes via meta endpoint (uses db_id)
		const dbId = asTrimmedString(task.db_id);
		if (dbId) {
			// Fetch current user_notes to append
			let currentUserNotes = "";
			try {
				const notesGetResp = await fetch(
					`${API_URL}/tasks/${encodeURIComponent(dbId)}/meta`,
					{
						headers: {
							Authorization: `Bearer ${apiKey}`,
							...(await buildDeviceHeaders(configService)),
						},
					},
				);
				if (notesGetResp.ok) {
					const notesBody = (await notesGetResp.json()) as {
						user_notes?: unknown;
					};
					currentUserNotes =
						typeof notesBody.user_notes === "string"
							? notesBody.user_notes
							: "";
				}
			} catch {
				// ignore — we'll still save the new notes
			}
			const mergedUserNotes =
				currentUserNotes.trim().length > 0
					? `${currentUserNotes.trim()}\n\n${trimmed}`
					: trimmed;
			await fetch(`${API_URL}/tasks/${encodeURIComponent(dbId)}/meta`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					...(await buildDeviceHeaders(configService)),
				},
				body: JSON.stringify({ user_notes: mergedUserNotes }),
			});
		}
	} catch {
		// Best effort only; local cache already updated.
	}
};

const normalizeTaskParentPointers = (tasks: AgentTask[]): AgentTask[] => {
	const idSet = new Set(tasks.map((task) => task.id));
	const externalIdByDbId = new Map<string, string>();

	for (const task of tasks) {
		const dbId = asTrimmedString(task.db_id);
		if (!dbId) continue;
		externalIdByDbId.set(dbId, task.id);
	}

	return tasks.map((task) => {
		const parentId = asTrimmedString(task.parent_id);
		if (!parentId) return task;
		if (idSet.has(parentId)) return task;

		const resolvedParentId = externalIdByDbId.get(parentId);
		if (!resolvedParentId) return task;

		return {
			...task,
			parent_id: resolvedParentId,
		};
	});
};

const compareTasksForDisplay = (a: AgentTask, b: AgentTask): number => {
	const statusDelta =
		(TASK_STATUS_ORDER[a.status] ?? 99) - (TASK_STATUS_ORDER[b.status] ?? 99);
	if (statusDelta !== 0) return statusDelta;

	const orderA =
		typeof a.subtask_order === "number"
			? a.subtask_order
			: Number.MAX_SAFE_INTEGER;
	const orderB =
		typeof b.subtask_order === "number"
			? b.subtask_order
			: Number.MAX_SAFE_INTEGER;
	if (orderA !== orderB) return orderA - orderB;

	return a.id.localeCompare(b.id);
};

const describeTask = (task: AgentTask, maxChars: number): string => {
	if (!task.description) return "";
	return ` - ${task.description.slice(0, maxChars)}${task.description.length > maxChars ? "..." : ""}`;
};

const buildTaskPickerChoices = (
	tasks: AgentTask[],
): Array<{ title: string; value: string }> => {
	const visible = tasks.filter(
		(task) => task.status !== "done" && !task.deleted_at,
	);
	const byId = new Map<string, AgentTask>(
		visible.map((task) => [task.id, task]),
	);
	const childrenByParent = new Map<string, AgentTask[]>();
	const roots: AgentTask[] = [];

	for (const task of visible) {
		if (task.parent_id && byId.has(task.parent_id)) {
			const siblings = childrenByParent.get(task.parent_id) ?? [];
			siblings.push(task);
			childrenByParent.set(task.parent_id, siblings);
			continue;
		}
		roots.push(task);
	}

	const choices: Array<{ title: string; value: string }> = [];
	const visited = new Set<string>();
	const walk = (task: AgentTask, depth: number) => {
		if (visited.has(task.id)) return;
		visited.add(task.id);

		const children = [...(childrenByParent.get(task.id) ?? [])].sort(
			compareTasksForDisplay,
		);
		const indent = depth > 0 ? `${"  ".repeat(depth - 1)}|- ` : "";
		const scopeTag =
			depth === 0 && children.length > 0
				? chalk.cyan(` [parent +${children.length}]`)
				: depth > 0
					? chalk.gray(" [child]")
					: "";
		const desc = describeTask(task, 40);
		choices.push({
			title: `${indent}[${task.id}] ${task.title} (${task.status})${scopeTag}${chalk.gray(desc)}`,
			value: task.id,
		});

		for (const child of children) {
			walk(child, depth + 1);
		}
	};

	for (const root of [...roots].sort(compareTasksForDisplay)) {
		walk(root, 0);
	}

	// Safety fallback for any disconnected/cyclic nodes not reached by traversal.
	for (const task of [...visible].sort(compareTasksForDisplay)) {
		if (visited.has(task.id)) continue;
		walk(task, 0);
	}

	return choices;
};

const sortChildTasksForScope = (tasks: AgentTask[]): AgentTask[] => {
	return [...tasks].sort((a, b) => {
		const orderA =
			typeof a.subtask_order === "number"
				? a.subtask_order
				: Number.MAX_SAFE_INTEGER;
		const orderB =
			typeof b.subtask_order === "number"
				? b.subtask_order
				: Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;

		const statusDelta =
			(TASK_STATUS_ORDER[a.status] ?? 99) - (TASK_STATUS_ORDER[b.status] ?? 99);
		if (statusDelta !== 0) return statusDelta;

		return a.id.localeCompare(b.id);
	});
};

const formatChildTaskLine = (task: AgentTask): string => {
	const summary = task.description
		? ` - ${task.description.slice(0, 120)}${task.description.length > 120 ? "..." : ""}`
		: "";
	return `- [${task.id}] ${task.title} (${task.status})${summary}`;
};

export function registerAgentCommands(program: Command) {
	program
		.command("agent [command] [args...]")
		.description("Wrap an AI agent with vem context and task tracking")
		.option("-t, --task <taskId>", "Specify the task ID to work on")
		.option(
			"--no-strict-memory",
			"Disable strict memory enforcement after agent runs",
		)
		.option(
			"--auto-exit",
			"Automatically exit after agent finishes, skipping post-run prompts",
		)
		.action(async (command, args, options) => {
			await trackCommandUsage("agent");
			await trackFeatureUsage("agent");
			try {
				await ensureVemDir();
				await ensureVemFiles();

				const configService = new ConfigService();
				const key = await configService.getApiKey();

				if (key) {
					// 0. Try to sync before starting
					console.log(chalk.blue("🔄 Syncing with cloud..."));
					await processQueue(syncService, configService, key);

					const projectId = await configService.getProjectId();
					const repoUrl = projectId ? null : await getGitRemote();

					if (repoUrl || projectId) {
						if (await isVemDirty(configService)) {
							console.log(
								chalk.yellow(
									"  ⚠ Local .vem memory has unsynced changes. Skipping auto-sync to avoid overwrite.",
								),
							);
						} else {
							try {
								const query = new URLSearchParams();
								if (repoUrl) query.set("repo_url", repoUrl);
								if (projectId) query.set("project_id", projectId);

								const res = await fetch(
									`${API_URL}/snapshots/latest?${query}`,
									{
										headers: {
											Authorization: `Bearer ${key}`,
											...(await buildDeviceHeaders(configService)),
										},
									},
								);

								if (res.ok) {
									const data = (await res.json()) as {
										snapshot: any;
										version?: string;
									};
									if (data.snapshot) {
										await syncService.unpack(data.snapshot);
										const localHash = await computeVemHash();
										await configService.setLastSyncedVemHash(localHash);
										if (data.version) {
											await configService.setLastVersion(data.version);
										}
										console.log(
											chalk.gray(
												`  Synced to version ${data.version || "unknown"}`,
											),
										);
									}
								} else if (res.status === 409) {
									console.log(
										chalk.yellow(
											"  ⚠ Conflict detected during sync. Using local memory. Resolve with `vem pull`/`vem push` later.",
										),
									);
								}
							} catch (_e) {
								console.log(
									chalk.yellow(
										"  ⚠ Could not reach cloud. Using local memory.",
									),
								);
							}
						}
					}
				}

				// 0. Handle Missing Command (Tool Selection)
				let selectedCommand = command;
				if (!selectedCommand) {
					const knownTools = [
						{ name: "codex", label: "Codex (OpenAI)" },
						{ name: "claude", label: "Claude (Anthropic)" },
						{ name: "gemini", label: "Gemini (Google)" },
						{ name: "copilot", label: "GitHub Copilot" },
						{ name: "gh", args: ["copilot"], label: "GitHub Copilot (via gh)" },
						{ name: "cursor", label: "Cursor IDE" },
						{ name: "code", label: "VS Code" },
					];

					const availableTools: any[] = [];
					for (const tool of knownTools) {
						try {
							execSync(`command -v ${tool.name}`, { stdio: "ignore" });
							availableTools.push({
								title: tool.label,
								value: { cmd: tool.name, args: tool.args || [] },
							});
						} catch (_e) {
							// tool not found
						}
					}

					if (availableTools.length === 0) {
						console.log(
							chalk.red("No supported AI agent CLIs found on your system."),
						);
						console.log(
							chalk.gray(
								"Supported: claude, gemini, copilot, gh copilot, cursor, code",
							),
						);
						return;
					}

					const response = await prompts({
						type: "select",
						name: "tool",
						message: "Select an AI Agent to launch:",
						choices: availableTools,
					});

					if (!response.tool) {
						console.log(chalk.yellow("Selection cancelled."));
						return;
					}

					selectedCommand = response.tool.cmd;
					if (response.tool.args && response.tool.args.length > 0) {
						// Prepend any required args (like 'copilot' for 'gh')
						args = [...response.tool.args, ...(args || [])];
					}
				}

				// 1. Determine Active Task
				const localTasks = await taskService.getTasks();
				const remoteTasks = await fetchRemoteAgentTasks(configService);
				const tasks = normalizeTaskParentPointers(
					mergeAgentTasks(localTasks, remoteTasks),
				);
				const startActor = resolveActorName();
				const moveTaskToInProgress = async (task: AgentTask) => {
					const localTask = await taskService.getTask(task.id);
					if (localTask) {
						await taskService.updateTask(task.id, { status: "in-progress" });
					}
					await markTaskInProgressRemote(configService, task, startActor);
					task.status = "in-progress";
				};
				let activeTask: any;

				// A. If --task is provided, verify it exists and use it
				if (options.task) {
					activeTask = tasks.find((t) => t.id === options.task);
					if (!activeTask) {
						console.error(chalk.red(`Task ${options.task} not found.`));
						// Fallback to selection? No, strictly fail if specific ID requested but missing.
						return;
					}
					// Auto-move to in-progress if not already
					if (
						activeTask.status !== "in-progress" &&
						activeTask.status !== "done"
					) {
						await moveTaskToInProgress(activeTask);
					}
				}

				// B. If no --task, always prompt with sorted list
				if (!activeTask) {
					const choices = buildTaskPickerChoices(tasks);

					// Always add "Create new task" option
					choices.unshift({ title: "+ Create new task", value: "new" });

					const response = await prompts({
						type: "select",
						name: "taskId",
						message: "Select a task to work on:",
						choices: choices,
					});

					if (!response.taskId) {
						console.log(chalk.yellow("No task selected. Exiting."));
						return;
					}

					if (response.taskId === "new") {
						const newTask = await prompts([
							{ type: "text", name: "title", message: "Task Title:" },
							{
								type: "text",
								name: "description",
								message: "Description (optional):",
							},
						]);

						if (newTask.title) {
							activeTask = await taskService.addTask(
								newTask.title,
								newTask.description,
								"medium",
							);
							await taskService.updateTask(activeTask.id, {
								status: "in-progress",
							});
							await trackFeatureUsage("task_driven");
							console.log(
								chalk.green(`\n✔ Created and started: ${activeTask.id}\n`),
							);
						}
					} else {
						activeTask = tasks.find((t) => t.id === response.taskId);
						if (activeTask) {
							// Auto-move to in-progress if todo
							if (activeTask.status === "todo") {
								await moveTaskToInProgress(activeTask);
							}
							await trackFeatureUsage("task_driven");
							console.log(
								chalk.green(`\n✔ Switched to task: ${activeTask.id}\n`),
							);
						}
					}
				}

				if (!activeTask) return;

				console.log(
					chalk.green(`\nChecked in: ${activeTask.id} - ${activeTask.title}\n`),
				);
				process.env.VEM_ACTIVE_TASK = activeTask.id;

				// Snapshot existing session IDs BEFORE launching the agent so we can
				// detect the new session that gets created when the agent starts.
				let sessionIdsBefore = new Set<string>();
				let gitRootForSessions: string | undefined;
				try {
					gitRootForSessions = execSync("git rev-parse --show-toplevel", {
						encoding: "utf-8",
					}).trim();
					const sessionsBefore = await listAllAgentSessions(gitRootForSessions);
					sessionIdsBefore = new Set(sessionsBefore.map((s) => s.id));
				} catch {
					/* non-fatal */
				}

				let attachedSessionRef: TaskSessionRef | null = null;
				const allChildTasks = sortChildTasksForScope(
					tasks.filter(
						(task) => task.parent_id === activeTask.id && !task.deleted_at,
					),
				);
				const actionableChildTasks = allChildTasks.filter(
					(task) => task.status !== "done",
				);
				const scopedChildTasks =
					actionableChildTasks.length > 0
						? actionableChildTasks
						: allChildTasks;
				const scopedChildTaskIds = scopedChildTasks.map((task) => task.id);
				process.env.VEM_CHILD_TASK_IDS = scopedChildTaskIds.join(",");

				// 2. Refresh Context
				console.log(chalk.blue("📝 Generating context for agent..."));
				const snapshot = await syncService.packForAgent();
				// Write project-level context snapshot (no task-specific content)
				const vemDir = await getVemDir();
				const contextFile = join(vemDir, "current_context.md");
				const contextContent = formatVemPack(snapshot);
				await writeFile(contextFile, contextContent);
				console.log(chalk.gray(`Context written to ${contextFile}`));

				if (activeTask) {
					const refreshedTask = await taskService.getTask(activeTask.id);
					const taskForContext = refreshedTask || activeTask;
					const taskContextFile = join(vemDir, TASK_CONTEXT_FILE);
					const taskContextBody =
						taskForContext.task_context &&
						taskForContext.task_context.trim().length > 0
							? truncateForDisplay(taskForContext.task_context, 12000)
							: "_No task context yet. Use `vem task context` to add notes._";
					const summaryBlock = taskForContext.task_context_summary
						? `\n\n## Previous Task Context Summary\n${truncateForDisplay(taskForContext.task_context_summary, 4000)}`
						: "";
					const childTasksContextBlock =
						scopedChildTasks.length > 0
							? `\n\n## Child Tasks In Scope\n${scopedChildTasks
									.map((task) => formatChildTaskLine(task))
									.join(
										"\n",
									)}\n\nTreat these child tasks as required implementation scope for this run.`
							: "";

					const taskContextContent = `# ACTIVE TASK
Task: ${taskForContext.id} — ${taskForContext.title}
Status: ${taskForContext.status}

## Task Context
${taskContextBody}${summaryBlock}${childTasksContextBlock}

---
This file is generated for the active task. Update task context via:
\`vem task context ${taskForContext.id} --set "..." \` or \`--append "..." \`
`;
					await writeFile(taskContextFile, taskContextContent);
					console.log(chalk.gray(`Task context written to ${taskContextFile}`));
				}

				// 3. Run Agent
				const strictMemory =
					(options.strictMemory ?? true) &&
					process.env.VEM_STRICT_MEMORY !== "0";
				const sessionStartedAt = Date.now();
				console.log(chalk.bold(`\n🤖 Launching ${selectedCommand}...\n`));

				let launchArgs = args || [];
				const baseCmd = selectedCommand.split(/[/\\]/).pop(); // Handle paths like /bin/gemini
				const agentName = resolveActorName() || baseCmd || "Agent";

				// Start Agent Session Tracking
				await trackAgentSession("agent_start", {
					agentName,
					taskId: activeTask?.id,
					command: selectedCommand,
				});

				const heartbeatInterval = setInterval(async () => {
					await trackAgentSession("agent_heartbeat", {
						agentName,
						taskId: activeTask?.id,
						command: selectedCommand,
					});
				}, 45 * 1000); // 45 second heartbeat

				const promptChildTasks = scopedChildTasks.slice(
					0,
					MAX_CHILD_TASKS_IN_PROMPT,
				);
				const extraChildCount =
					scopedChildTasks.length - promptChildTasks.length;
				const childTaskPromptBlock =
					promptChildTasks.length > 0
						? ` Parent task scope also includes child tasks: ${promptChildTasks
								.map((task) => `[${task.id}] ${task.title} (${task.status})`)
								.join(
									"; ",
								)}${extraChildCount > 0 ? `; plus ${extraChildCount} more` : ""}. Treat these as part of implementation scope and update them in \`vem_update.tasks\` when progress is made.`
						: "";
				const runnerInstructions = process.env.VEM_RUNNER_INSTRUCTIONS?.trim();
				const runnerInstructionsBlock = runnerInstructions
					? ` Additional web-run instructions: ${runnerInstructions}.`
					: "";

				const agentPrompt = `You are working on task ${activeTask?.id || "N/A"}.${childTaskPromptBlock}${runnerInstructionsBlock} Read .vem/current_context.md for project context and .vem/task_context.md for task-specific context. STRICT MEMORY: if you make changes, you must provide a vem_update block that includes context (full updated CONTEXT.md), current_state, changelog_append, decisions_append, and tasks (array — use the field name "tasks", not "task_update": [{ "id": "${activeTask?.id || "TASK-ID"}", "status": "done", "evidence": [...], "task_context_summary": "..." }]). Complete the task using these instructions. When completing tasks, include your agent name and confirm required validation steps (build/tests) in evidence.`;

				// Tool-specific injections
				if (baseCmd === "gemini" || baseCmd === "echo") {
					console.log(
						chalk.cyan(`Auto-injecting context via --prompt-interactive...`),
					);
					launchArgs = ["-i", agentPrompt, ...launchArgs];
				} else if (baseCmd === "codex") {
					const codexSubcommands = new Set([
						"exec",
						"e",
						"review",
						"login",
						"logout",
						"mcp",
						"mcp-server",
						"app-server",
						"completion",
						"sandbox",
						"debug",
						"apply",
						"a",
						"resume",
						"fork",
						"cloud",
						"features",
						"help",
					]);
					const firstNonOption = launchArgs.find(
						(arg: string) => !arg.startsWith("-"),
					);
					const isSubcommand =
						!!firstNonOption && codexSubcommands.has(firstNonOption);
					const hasPrompt = !!firstNonOption && !isSubcommand;
					if (!isSubcommand && !hasPrompt) {
						console.log(
							chalk.cyan("Auto-injecting context via initial Codex prompt..."),
						);
						launchArgs = [...launchArgs, agentPrompt];
					} else {
						console.log(
							chalk.cyan(
								"Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) — use field name 'tasks', not 'task_update'.",
							),
						);
					}
				} else if (baseCmd === "claude") {
					const claudeSubcommands = new Set([
						"doctor",
						"install",
						"mcp",
						"plugin",
						"setup-token",
						"update",
						"upgrade",
					]);
					const firstNonOption = launchArgs.find(
						(arg: string) => !arg.startsWith("-"),
					);
					const isSubcommand =
						!!firstNonOption && claudeSubcommands.has(firstNonOption);
					const hasPrompt = !!firstNonOption && !isSubcommand;

					if (!isSubcommand) {
						console.log(
							chalk.cyan(
								"Auto-injecting context via --append-system-prompt...",
							),
						);
						if (!hasPrompt) {
							// No user prompt — inject system context + initial task prompt
							const childScopeText =
								scopedChildTaskIds.length > 0
									? ` and child tasks ${scopedChildTaskIds.join(", ")}`
									: "";
							const initialPrompt = `Read .vem/current_context.md and .vem/task_context.md, then start working on task ${activeTask?.id}: ${activeTask?.title}${childScopeText}`;
							launchArgs = [
								"--append-system-prompt",
								agentPrompt,
								...launchArgs,
								initialPrompt,
							];
						} else {
							// User provided their own prompt — inject system context only
							launchArgs = [
								"--append-system-prompt",
								agentPrompt,
								...launchArgs,
							];
						}
					} else {
						console.log(
							chalk.cyan(
								"Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) — use field name 'tasks', not 'task_update'.",
							),
						);
					}
				} else if (baseCmd === "copilot") {
					const firstNonOption = launchArgs.find(
						(arg: string) => !arg.startsWith("-"),
					);
					const hasInteractiveFlag = launchArgs.some(
						(arg: string) => arg === "-i" || arg === "--interactive",
					);
					const hasPrompt = !!firstNonOption || hasInteractiveFlag;

					if (!hasPrompt) {
						console.log(chalk.cyan("Auto-injecting context via -i flag..."));
						const childScopeText =
							scopedChildTaskIds.length > 0
								? ` and child tasks ${scopedChildTaskIds.join(", ")}`
								: "";
						const initialPrompt = `${agentPrompt}\n\nYour task is ${activeTask?.id}: ${activeTask?.title}${childScopeText}.\n\nStart by reading .vem/task_context.md and .vem/current_context.md for task and project context. Then explore the repository structure (list directories, read key files like package.json, README, and relevant source files) to understand the codebase before writing any code. Implement all required changes, run any existing tests or builds to verify, then provide the vem_update block.`;
						launchArgs = [...launchArgs, "-i", initialPrompt];
					} else {
						console.log(
							chalk.cyan(
								"Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) — use field name 'tasks', not 'task_update'.",
							),
						);
					}
				} else {
					console.log(
						chalk.cyan(
							"Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) — use field name 'tasks', not 'task_update'.",
						),
					);
				}

				const exitSignalFile = join(vemDir, "exit_signal");
				// Clear stale signal before launching a new child process.
				await unlink(exitSignalFile).catch(() => {});

				const child = spawn(selectedCommand, launchArgs, {
					stdio: "inherit",
					env: {
						...process.env,
						VEM_ACTIVE_TASK: activeTask?.id || "",
						VEM_CHILD_TASK_IDS: scopedChildTaskIds.join(","),
						VEM_AGENT_NAME: agentName,
					},
				});

				let startError: NodeJS.ErrnoException | null = null;
				let exitCode: number | null = null;
				await new Promise<void>((resolve) => {
					child.on("exit", (code) => {
						exitCode = code;
						resolve();
					});
					child.on("error", (err) => {
						startError = err;
						resolve();
					});
				});
				const capturedError = startError as NodeJS.ErrnoException | null;
				if (capturedError?.code === "ENOENT") {
					const shell = process.env.SHELL || "/bin/zsh";
					const shellCommand = [selectedCommand, ...launchArgs]
						.map((arg) => shellEscapeArg(arg))
						.join(" ");
					console.error(
						chalk.red(`Failed to start agent: ${capturedError.message}`),
					);
					console.log(
						chalk.yellow(
							`Retrying via ${shell} to resolve shell aliases/functions...`,
						),
					);
					const shellChild = spawn(shell, ["-ic", shellCommand], {
						stdio: "inherit",
						env: {
							...process.env,
							VEM_ACTIVE_TASK: activeTask?.id || "",
							VEM_CHILD_TASK_IDS: scopedChildTaskIds.join(","),
							VEM_AGENT_NAME: agentName,
						},
					});
					const shellResult = await new Promise<{
						exitCode: number | null;
						error: NodeJS.ErrnoException | null;
					}>((resolve) => {
						shellChild.on("exit", (code) =>
							resolve({ exitCode: code, error: null }),
						);
						shellChild.on("error", (err) =>
							resolve({ exitCode: null, error: err }),
						);
					});
					if (shellResult.error) {
						startError = shellResult.error;
					} else {
						startError = null;
						exitCode = shellResult.exitCode;
					}
				}

				clearInterval(heartbeatInterval);
				await trackAgentSession("agent_stop", {
					agentName,
					taskId: activeTask?.id,
					command: selectedCommand,
				});

				// Detect new agent session (created after we launched the agent) and attach it.
				// Then compute its stats now that the session has finished.
				if (activeTask && gitRootForSessions) {
					try {
						const sessionsAfter =
							await listAllAgentSessions(gitRootForSessions);
						const newSession = sessionsAfter.find(
							(s) => !sessionIdsBefore.has(s.id),
						);
						if (newSession) {
							const localTask = await taskService.getTask(activeTask.id);
							const existingSessions: TaskSessionRef[] =
								(localTask?.sessions as any) || [];
							// Replace any placeholder session or append the new one
							const alreadyAttached = existingSessions.some(
								(s) => s.id === newSession.id,
							);
							attachedSessionRef = {
								id: newSession.id,
								source: newSession.source,
								started_at: new Date().toISOString(),
								summary: activeTask.title ?? newSession.summary,
							};
							let updatedSessions: TaskSessionRef[];
							if (!alreadyAttached) {
								// Remove any session that was pre-attached from the "before" set (wrong session)
								const filtered = existingSessions.filter(
									(s) => !sessionIdsBefore.has(s.id),
								);
								updatedSessions = [...filtered, attachedSessionRef];
							} else {
								updatedSessions = existingSessions;
							}

							// Compute stats now that the session is complete
							const stats = await computeSessionStats(
								newSession.id,
								newSession.source,
							);
							if (stats) {
								updatedSessions = updatedSessions.map((s) =>
									s.id === newSession.id ? { ...s, stats } : s,
								);
								attachedSessionRef = { ...attachedSessionRef, stats };
								const parts: string[] = [];
								if (stats.tool_call_count != null)
									parts.push(`${stats.tool_call_count} tool calls`);
								if (stats.turn_count != null)
									parts.push(`${stats.turn_count} turns`);
								if (stats.session_duration_ms != null)
									parts.push(
										`${Math.round(stats.session_duration_ms / 60000)}m`,
									);
								console.log(
									chalk.gray(
										`📊 Session stats: ${parts.join(", ") || "computed"}`,
									),
								);
							}

							if (localTask) {
								await taskService.updateTask(activeTask.id, {
									sessions: updatedSessions,
								});
							}
							await updateTaskMetaRemote(
								configService,
								activeTask as AgentTask,
								{ sessions: updatedSessions },
							);
							console.log(
								chalk.gray(
									`📎 Session ${newSession.id.slice(0, 8)} attached to ${activeTask.id}`,
								),
							);
						}
					} catch {
						/* non-fatal */
					}
				}

				if (startError) {
					console.error(
						chalk.red(`Failed to start agent: ${startError.message}`),
					);
					if (startError.code === "ENOENT") {
						console.error(
							chalk.yellow(
								`Command "${selectedCommand}" was not found in PATH. Run \`vem agent\` to select an installed tool, or install ${selectedCommand}.`,
							),
						);
					}
					return;
				}

				console.log(chalk.gray(`\nAgent exited with code ${exitCode}\n`));

				// NEW: Check for dynamic exit signal from agent
				let dynamicAutoExit = false;
				try {
					await access(exitSignalFile);
					dynamicAutoExit = true;
					await unlink(exitSignalFile); // Clean up
					console.log(
						chalk.cyan("👋 Received dynamic exit signal from agent."),
					);
				} catch {
					// No signal file
				}

				let shouldAutoExit = options.autoExit || dynamicAutoExit;

				// Check for vem_update blocks.
				const updateFile = await detectVemUpdateInOutput(vemDir);
				let parsedAgentUpdate: ReturnType<typeof parseVemUpdateBlock> | null =
					null;
				let appliedUpdateResult: any = null;
				if (updateFile) {
					console.log(
						chalk.cyan("📝 Detected vem_update block in agent output"),
					);
					try {
						const content = await readFile(updateFile, "utf-8");
						parsedAgentUpdate = parseVemUpdateBlock(content);
					} catch (error: any) {
						console.error(
							chalk.red("Failed to parse vem_update block:"),
							error.message,
						);
						console.log(
							chalk.yellow(
								`You can manually inspect/update it later: vem finalize -f ${updateFile}`,
							),
						);
					}

					if (parsedAgentUpdate) {
						if (shouldAutoExit) {
							console.log(
								chalk.gray(
									`  (Auto-applying due to ${dynamicAutoExit ? "dynamic signal" : "--auto-exit"})`,
								),
							);
						}
						try {
							appliedUpdateResult = await applyVemUpdate(parsedAgentUpdate);
							console.log(chalk.green("✔ Applied vem_update"));
							await syncParsedTaskUpdatesToRemote(
								configService,
								parsedAgentUpdate,
								appliedUpdateResult,
							);
							const syncedMemory = await syncProjectMemoryToRemote();
							if (syncedMemory) {
								console.log(chalk.gray("✔ Synced vem_update memory to cloud"));
							}
							await trackCommandUsage("finalize"); // Track as finalize

							// Auto-close: if active task was marked done via vem_update, trigger auto-exit
							const taskMarkedDoneInUpdate =
								appliedUpdateResult?.updatedTasks?.some(
									(t: any) => t.id === activeTask?.id && t.status === "done",
								);
							if (taskMarkedDoneInUpdate && !shouldAutoExit) {
								shouldAutoExit = true;
								console.log(
									chalk.cyan(
										"✔ Task marked done via vem_update — auto-closing.",
									),
								);
							}
						} catch (error: any) {
							console.error(
								chalk.red("Failed to apply update:"),
								error.message,
							);
							console.log(
								chalk.yellow(
									`You can manually apply it later: vem finalize -f ${updateFile}`,
								),
							);
						}
					}
				}

				if (shouldAutoExit) {
					// Check if the active task was marked as done in the update or via MCP complete_task
					const wasTaskCompleted = appliedUpdateResult?.updatedTasks?.some(
						(t: any) => t.id === activeTask?.id && t.status === "done",
					);

					// When triggered by dynamic exit signal, also check live task status
					// (the agent may have used MCP complete_task instead of vem_update)
					let taskDoneViaMcp = false;
					if (dynamicAutoExit && activeTask && !wasTaskCompleted) {
						const liveTasks = await taskService.getTasks();
						const liveTask = liveTasks.find((t) => t.id === activeTask.id);
						taskDoneViaMcp = liveTask?.status === "done";
					}

					if (wasTaskCompleted || taskDoneViaMcp) {
						console.log(
							chalk.green(
								`✔ Task ${activeTask?.id} was marked as done${taskDoneViaMcp ? " via MCP" : " in the update"}.`,
							),
						);
					} else if (activeTask) {
						console.log(
							chalk.yellow(
								`⚠ Task ${activeTask.id} remains ${activeTask.status}. Use vem_update 'tasks' field to mark it 'done' with evidence.`,
							),
						);
					}

					// Still run post-session wrap-up even on auto-exit so the user
					// can add extra notes and strict-memory checks are enforced.
					await enforceStrictMemoryUpdates(sessionStartedAt, strictMemory, {
						agentUpdate: parsedAgentUpdate,
						onAdditionalNotes: async (notes) => {
							if (!activeTask) return;
							await appendTaskNotesToContext(configService, activeTask, notes);
						},
					});

					if (strictMemory) {
						await trackFeatureUsage("strict_memory");
					}

					console.log(
						chalk.gray(
							"\nTip: Run `vem push` to save your memory progress to the cloud.\n",
						),
					);

					if (!dynamicAutoExit)
						console.log(chalk.blue("\n👋 Auto-exiting as requested."));
					return;
				}

				// 4. Post-run check with Refresh
				const freshTasks = await taskService.getTasks();
				let localActiveTask = activeTask
					? freshTasks.find((t) => t.id === activeTask.id)
					: undefined;
				const remoteActiveTask = activeTask
					? await fetchRemoteAgentTaskById(configService, activeTask.id)
					: null;
				if (
					localActiveTask &&
					remoteActiveTask &&
					localActiveTask.status !== remoteActiveTask.status
				) {
					await taskService.updateTask(localActiveTask.id, {
						status: remoteActiveTask.status,
					});
					localActiveTask = {
						...localActiveTask,
						status: remoteActiveTask.status,
					};
				}
				const freshActiveTask: AgentTask | undefined =
					remoteActiveTask ??
					(localActiveTask as AgentTask | undefined) ??
					(activeTask ? (activeTask as AgentTask) : undefined);
				debugAgentSync(
					"post-run candidate:",
					`active=${activeTask?.id ?? "none"}`,
					`local=${localActiveTask?.id ?? "none"}`,
					`remote=${remoteActiveTask?.id ?? "none"}`,
					`resolved=${freshActiveTask?.id ?? "none"}`,
					`status=${freshActiveTask?.status ?? "none"}`,
				);

				if (freshActiveTask && freshActiveTask.status !== "done") {
					const postRun = await prompts({
						type: "confirm",
						name: "done",
						message: `Did you complete task ${freshActiveTask.id}?`,
						initial: false,
					});

					if (postRun.done) {
						const evidence = await prompts({
							type: "text",
							name: "desc",
							message: "Briefly describe what was done (evidence):",
							initial: "Completed via agent session",
						});

						let reasoningText = "";
						const reasoning = await prompts({
							type: "text",
							name: "text",
							message:
								"Reasoning for completion (leave empty to auto-generate):",
						});

						reasoningText = reasoning.text;

						let contextSummary: string | undefined;
						if (freshActiveTask.task_context) {
							const summary = await prompts({
								type: "text",
								name: "text",
								message:
									"Provide a brief task context summary to keep after completion (optional):",
							});
							contextSummary = summary.text || undefined;
						}

						if (!reasoningText || reasoningText.trim() === "") {
							// Auto-generate reasoning using the selected agent tool if possible
							console.log(chalk.blue("🤖 Auto-generating reasoning..."));
							try {
								// Construct a prompt for the agent
								const prompt = `Generate a concise one-sentence reasoning for completing task "${freshActiveTask.title}". Evidence: "${evidence.desc}". Return ONLY the sentence.`;

								// Reuse the selected command/args but for a quick query
								// This assumes the tool supports a non-interactive PROMPT arg or stdin
								// For 'gemini' and 'claude', they often accept the prompt as an arg.
								// We'll try to spawn it.

								// If command is 'gemini' or 'claude', pass prompt as arg
								// For others, we might just fall back to a generic message

								if (
									baseCmd === "gemini" ||
									baseCmd === "claude" ||
									baseCmd === "echo"
								) {
									const genChild = spawn(
										selectedCommand,
										[...(args || []), prompt],
										{
											stdio: ["ignore", "pipe", "ignore"],
										},
									);

									let output = "";
									for await (const chunk of genChild.stdout) {
										output += chunk;
									}
									reasoningText =
										output.trim() || "Automated completion via agent";
								} else {
									reasoningText = "Automated completion via agent session";
								}
								console.log(chalk.gray(`Generated: ${reasoningText}`));
							} catch (_e) {
								console.error(
									chalk.yellow(
										"Failed to auto-generate reasoning. Using default.",
									),
								);
								reasoningText = "Completed via agent session";
							}
						}

						const requiredValidation = freshActiveTask.validation_steps ?? [];
						if (requiredValidation.length > 0) {
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
							for (const step of confirmed) {
								const entry = `Validated: ${step}`;
								if (!evidence.desc.includes(entry)) {
									evidence.desc = `${evidence.desc}\n${entry}`;
								}
							}
						}

						if (localActiveTask) {
							await taskService.updateTask(freshActiveTask.id, {
								status: "done",
								evidence: [evidence.desc],
								reasoning: reasoningText,
								task_context_summary: contextSummary,
								actor: agentName,
							});
						}

						const remoteTaskRef = (freshActiveTask ?? activeTask) as AgentTask;
						const [remoteMetaUpdated, remoteContextUpdated] = await Promise.all(
							[
								updateTaskMetaRemote(configService, remoteTaskRef, {
									status: "done",
									evidence: [evidence.desc],
									reasoning: reasoningText,
									actor: agentName,
								}),
								contextSummary !== undefined
									? updateTaskContextRemote(configService, remoteTaskRef, {
											task_context_summary: contextSummary || null,
										})
									: Promise.resolve(false),
							],
						);

						activeTask.status = "done";
						if (!remoteMetaUpdated) {
							console.log(
								chalk.yellow(
									"  ⚠ Could not sync done status to cloud. Local cache was updated.",
								),
							);
						}

						console.log(
							chalk.green(
								`\n✔ Task ${freshActiveTask.id} marked as done${
									remoteMetaUpdated || remoteContextUpdated
										? " (cloud + local cache)"
										: " (local cache)"
								}.`,
							),
						);
					} else {
						// Ask if we should stop progress (move to todo) or keep in progress
						const statusCheck = await prompts({
							type: "select",
							name: "status",
							message: "Update task status?",
							choices: [
								{ title: "Keep In Progress", value: "in-progress" },
								{ title: "Move to Blocked", value: "blocked" },
								{ title: "Move to Todo (Pause)", value: "todo" },
							],
						});
						if (
							statusCheck.status &&
							statusCheck.status !== activeTask.status
						) {
							if (localActiveTask) {
								await taskService.updateTask(activeTask.id, {
									status: statusCheck.status as any,
								});
							}
							const remoteStatusUpdated = await updateTaskMetaRemote(
								configService,
								activeTask as AgentTask,
								{
									status: statusCheck.status as AgentTask["status"],
									reasoning: "Updated via vem agent post-run prompt",
									actor: agentName,
								},
							);
							activeTask.status = statusCheck.status as AgentTask["status"];
							if (!remoteStatusUpdated) {
								console.log(
									chalk.yellow(
										"  ⚠ Could not sync status to cloud. Local cache was updated.",
									),
								);
							}
							console.log(
								chalk.green(`\n✔ Task status updated to ${statusCheck.status}`),
							);
						}
					}
				}

				await enforceStrictMemoryUpdates(sessionStartedAt, strictMemory, {
					agentUpdate: parsedAgentUpdate,
					onAdditionalNotes: async (notes) => {
						if (!activeTask) return;
						await appendTaskNotesToContext(configService, activeTask, notes);
					},
				});

				if (strictMemory) {
					await trackFeatureUsage("strict_memory");
				}

				console.log(
					chalk.gray(
						"\nTip: Run `vem push` to save your memory progress to the cloud.\n",
					),
				);
			} catch (error: any) {
				console.error(chalk.red("Agent Wrapper Error:"), error.message);
			}
		});
}
