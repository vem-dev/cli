import type { ConfigService, SyncService } from "@vem/core";
import chalk from "chalk";

import { API_URL, buildDeviceHeaders } from "./auth.js";
import { getCommitHistory } from "./git.js";

async function performPush(
	payload: any,
	key: string,
	configService: ConfigService,
): Promise<{ success: boolean; error?: string; status?: number; data?: any }> {
	try {
		const res = await fetch(`${API_URL}/snapshots`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(configService)),
			},
			body: JSON.stringify(payload),
		});

		if (res.ok) {
			const json = (await res.json()) as { version: string };
			if (json.version) {
				await configService.setLastVersion(json.version);
			}
			return { success: true, data: json };
		}

		const data = (await res.json().catch(() => ({}))) as any;
		return {
			success: false,
			status: res.status,
			error: data.error || res.statusText,
			data,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function backfillCommitHistory(options: {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
	limit?: number;
	all?: boolean;
	logResult?: boolean;
}): Promise<void> {
	const commits = await getCommitHistory({
		limit: options.limit,
		all: options.all,
	});

	if (commits.length === 0) {
		console.log(chalk.gray("No commits found to backfill."));
		return;
	}

	const res = await fetch(
		`${API_URL}/projects/${options.projectId}/commits/backfill`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.apiKey}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(options.configService)),
			},
			body: JSON.stringify({ commits }),
		},
	);

	if (!res.ok) {
		const err = await res.text().catch(() => "");
		throw new Error(
			`Commit backfill failed (${res.status}): ${err || res.statusText}`,
		);
	}

	const data = (await res.json()) as { inserted?: number; total?: number };
	const shouldLog = options.logResult !== false;
	if (shouldLog) {
		if (typeof data.inserted === "number") {
			console.log(
				chalk.green(
					`✔ Commit history backfilled (${data.inserted}/${data.total ?? commits.length})`,
				),
			);
		} else {
			console.log(chalk.green("✔ Commit history backfilled."));
		}
	}
}

async function triggerRemoteReindex(options: {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
	mode?: string;
	commit?: string;
	branch?: string;
	useCredits?: boolean;
}): Promise<void> {
	const payload: {
		mode?: string;
		commit_hash?: string;
		branch?: string;
		use_credits?: boolean;
	} = {};
	if (options.mode) payload.mode = options.mode;
	if (options.commit) payload.commit_hash = options.commit;
	if (options.branch) payload.branch = options.branch;
	if (options.useCredits) payload.use_credits = true;

	const res = await fetch(`${API_URL}/projects/${options.projectId}/reindex`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
			"Content-Type": "application/json",
			...(await buildDeviceHeaders(options.configService)),
		},
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		const raw = await res.text().catch(() => "");
		let message = raw || res.statusText;
		try {
			message = JSON.parse(raw).error || message;
		} catch {
			/* use raw */
		}
		throw new Error(`Reindex failed (${res.status}): ${message}`);
	}

	console.log(chalk.green("✔ Remote reindex triggered."));
}

async function triggerRemoteHistoryReindex(options: {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
	limit?: number;
}): Promise<void> {
	const payload: { limit?: number } = {};
	if (typeof options.limit === "number") {
		payload.limit = options.limit;
	}

	const res = await fetch(
		`${API_URL}/projects/${options.projectId}/reindex/history`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.apiKey}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(options.configService)),
			},
			body: JSON.stringify(payload),
		},
	);

	if (!res.ok) {
		const err = await res.text().catch(() => "");
		throw new Error(
			`History reindex failed (${res.status}): ${err || res.statusText}`,
		);
	}

	console.log(chalk.green("✔ History reindex triggered."));
}

async function processQueue(
	syncService: SyncService,
	configService: ConfigService,
	key: string,
) {
	const queue = await syncService.getQueue();
	if (queue.length === 0) return;

	console.log(
		chalk.blue(`\n🔄 Processing offline queue (${queue.length} items)...`),
	);
	let successCount = 0;

	for (const item of queue) {
		const result = await performPush(item.payload, key, configService);
		if (result.success) {
			await syncService.removeFromQueue(item.id);
			successCount++;
		} else {
			console.log(
				chalk.yellow(
					`  ⚠ Failed to push queued snapshot ${item.id}: ${result.error}`,
				),
			);
			// Stop processing queue if we hit a conflict or other non-network error
			if (
				result.status === 409 ||
				result.status === 403 ||
				result.status === 404
			) {
				break;
			}
		}
	}

	if (successCount > 0) {
		console.log(chalk.green(`  ✔ Successfully pushed ${successCount} items.`));
	}
}

export {
	backfillCommitHistory,
	performPush,
	processQueue,
	triggerRemoteHistoryReindex,
	triggerRemoteReindex,
};
