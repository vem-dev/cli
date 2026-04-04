import type { ConfigService, SyncService } from "@vem/core";
import chalk from "chalk";

import { API_URL, buildDeviceHeaders } from "./auth.js";

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

export { performPush, processQueue };
