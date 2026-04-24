import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
	applyVemUpdate,
	CHANGELOG_DIR,
	CONTEXT_FILE,
	ConfigService,
	CURRENT_STATE_FILE,
	DECISIONS_DIR,
	getVemDir,
	ScalableLogService,
	TaskService,
} from "@vem/core";
import type { VemUpdate } from "@vem/schemas";
import chalk from "chalk";
import prompts from "prompts";

import { API_URL, buildDeviceHeaders, tryAuthenticatedKey } from "./auth.js";
import { hasNonVemChanges } from "./git.js";

const STRICT_NO_CHANGE_CHANGELOG = "No user-facing changes in this session.";
const STRICT_NO_CHANGE_DECISIONS =
	"No architectural decisions in this session.";

function normalizeLines(value?: string): string[] {
	if (!value) return [];
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function normalizeAppendEntries(value?: string | string[]): string[] {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value.map((entry) => entry.trim()).filter(Boolean);
	}
	return normalizeLines(value);
}

async function getFileMtimeMs(filePath: string): Promise<number | null> {
	try {
		const stats = await stat(filePath);
		return stats.mtimeMs;
	} catch (_e) {
		return null;
	}
}

async function getLatestEntryMtimeMs(dirPath: string): Promise<number | null> {
	try {
		const entries = await readdir(dirPath, { withFileTypes: true });
		let latest: number | null = null;
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (entry.name === "archive") continue;
				continue;
			}
			if (!entry.name.endsWith(".md")) continue;
			const entryPath = join(dirPath, entry.name);
			const mtime = await getFileMtimeMs(entryPath);
			if (mtime === null) continue;
			if (latest === null || mtime > latest) {
				latest = mtime;
			}
		}
		return latest;
	} catch (_e) {
		return null;
	}
}

async function collectStrictMemoryUpdate(
	agentUpdate?: VemUpdate | null,
): Promise<VemUpdate> {
	const vemDir = await getVemDir();
	const contextPath = join(vemDir, CONTEXT_FILE);
	const currentStatePath = join(vemDir, CURRENT_STATE_FILE);
	const currentContext = (
		await readFile(contextPath, "utf-8").catch(() => "")
	).toString();
	const currentStateExisting = (
		await readFile(currentStatePath, "utf-8").catch(() => "")
	).toString();

	const contextValue =
		typeof agentUpdate?.context === "string" &&
		agentUpdate.context.trim().length > 0
			? agentUpdate.context
			: currentContext;

	const currentStateValue =
		typeof agentUpdate?.current_state === "string" &&
		agentUpdate.current_state.trim().length > 0
			? agentUpdate.current_state
			: currentStateExisting.trim().length > 0
				? currentStateExisting
				: "Agent session completed. Summary not provided in vem_update.";

	const changelogLines = normalizeAppendEntries(agentUpdate?.changelog_append);
	const changelogAppend =
		changelogLines.length > 0 ? changelogLines : [STRICT_NO_CHANGE_CHANGELOG];

	const decisionsLines = normalizeAppendEntries(agentUpdate?.decisions_append);
	const decisionsAppend =
		decisionsLines.length > 0 ? decisionsLines : [STRICT_NO_CHANGE_DECISIONS];

	return {
		context: contextValue,
		current_state: currentStateValue,
		changelog_append: changelogAppend,
		decisions_append: decisionsAppend,
	};
}

async function promptAdditionalTaskNotes(): Promise<string | undefined> {
	// Skip in non-interactive environments. CI=1 is set by the cloud sandbox
	// entrypoint for codex runs — script(1) always gives isTTY=true there, so
	// the CI check is the only reliable way to prevent prompts from blocking.
	if (!process.stdin.isTTY || process.env.CI === "1") return undefined;
	const wantsNotes = await prompts({
		type: "confirm",
		name: "value",
		message: "Add task notes for this session?",
		initial: false,
	});
	if (!wantsNotes.value) return undefined;

	const notesPrompt = await prompts({
		type: "text",
		name: "value",
		message: "Task notes:",
	});
	if (typeof notesPrompt.value !== "string") return undefined;
	const trimmed = notesPrompt.value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

async function enforceStrictMemoryUpdates(
	startedAtMs: number,
	strictMemory: boolean,
	options?: {
		agentUpdate?: VemUpdate | null;
		onAdditionalNotes?: (notes: string) => Promise<void>;
	},
): Promise<void> {
	const additionalNotes = options?.onAdditionalNotes
		? await promptAdditionalTaskNotes()
		: undefined;
	if (additionalNotes && options?.onAdditionalNotes) {
		try {
			await options.onAdditionalNotes(additionalNotes);
			console.log(chalk.gray("Task notes updated."));
		} catch (error: any) {
			console.log(
				chalk.yellow(
					`Could not persist task notes: ${error?.message || String(error)}`,
				),
			);
		}
	}

	if (!strictMemory) return;
	if (!(await hasNonVemChanges())) return;

	const vemDir = await getVemDir();
	const contextPath = join(vemDir, CONTEXT_FILE);
	const currentStatePath = join(vemDir, CURRENT_STATE_FILE);
	const contextMtime = await getFileMtimeMs(contextPath);
	const currentStateMtime = await getFileMtimeMs(currentStatePath);
	const changelogMtime = await getLatestEntryMtimeMs(
		join(vemDir, CHANGELOG_DIR),
	);
	const decisionsMtime = await getLatestEntryMtimeMs(
		join(vemDir, DECISIONS_DIR),
	);

	const contextUpdated = (contextMtime ?? 0) > startedAtMs;
	const currentStateUpdated = (currentStateMtime ?? 0) > startedAtMs;
	const changelogUpdated = (changelogMtime ?? 0) > startedAtMs;
	const decisionsUpdated = (decisionsMtime ?? 0) > startedAtMs;

	if (
		contextUpdated &&
		currentStateUpdated &&
		changelogUpdated &&
		decisionsUpdated
	) {
		return;
	}

	console.log(
		chalk.yellow(
			"\nStrict memory enforcement: applying agent memory update for CONTEXT, CURRENT_STATE, changelog, and decisions.",
		),
	);
	const update = await collectStrictMemoryUpdate(options?.agentUpdate);
	const result = await applyVemUpdate(update);
	console.log(chalk.green("\n✔ Strict memory update applied\n"));
	if (result.contextUpdated) {
		console.log(chalk.gray("Context updated."));
	}
	if (result.currentStateUpdated) {
		console.log(chalk.gray("Current state updated."));
	}
	if (result.changelogLines.length > 0) {
		console.log(
			chalk.gray(`Changelog entries: ${result.changelogLines.length}`),
		);
	}
	if (result.decisionsAppended) {
		console.log(chalk.gray("Decisions updated."));
	}
	const memorySynced = await syncProjectMemoryToRemote();
	if (memorySynced) {
		console.log(chalk.gray("Project memory synced to cloud."));
	}
}

async function syncProjectMemoryToRemote(): Promise<boolean> {
	try {
		const configService = new ConfigService();
		const [apiKey, projectId] = await Promise.all([
			tryAuthenticatedKey(configService),
			configService.getProjectId(),
		]);
		if (!apiKey || !projectId) return false;

		const vemDir = await getVemDir();
		const contextPath = join(vemDir, CONTEXT_FILE);
		const currentStatePath = join(vemDir, CURRENT_STATE_FILE);
		const [context, currentState, decisionsLog, changelogLog, taskList] =
			await Promise.all([
				readFile(contextPath, "utf-8").catch(() => ""),
				readFile(currentStatePath, "utf-8").catch(() => ""),
				new ScalableLogService(DECISIONS_DIR)
					.getMonolithicContent()
					.catch(() => ""),
				new ScalableLogService(CHANGELOG_DIR)
					.getMonolithicContent()
					.catch(() => ""),
				new TaskService().getTasks().catch(() => []),
			]);

		const tasks = taskList
			.filter(
				(t) =>
					t.status ||
					(Array.isArray(t.evidence) && t.evidence.length > 0) ||
					t.task_context_summary ||
					t.task_context,
			)
			.map((t) => ({
				id: t.id,
				status: t.status,
				evidence: t.evidence ?? [],
				task_context: t.task_context ?? null,
				task_context_summary: t.task_context_summary ?? null,
			}));

		const response = await fetch(`${API_URL}/projects/${projectId}/context`, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(configService)),
			},
			body: JSON.stringify({
				context: context.trim(),
				current_state: currentState.trim(),
				decisions: decisionsLog.trim(),
				changelog: changelogLog.trim(),
				...(tasks.length > 0 ? { tasks } : {}),
			}),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export {
	collectStrictMemoryUpdate,
	enforceStrictMemoryUpdates,
	getFileMtimeMs,
	getLatestEntryMtimeMs,
	normalizeLines,
	syncProjectMemoryToRemote,
};
