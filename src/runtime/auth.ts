import { spawn } from "node:child_process";

import type { ConfigService } from "@vem/core";
import chalk from "chalk";

let API_URL = process.env.VEM_API_URL || "http://localhost:3002";
const WEB_URL = process.env.VEM_APP_URL || "http://localhost:3000";

function getApiUrlCandidates(apiUrl: string) {
	const candidates = [apiUrl];
	try {
		const url = new URL(apiUrl);
		if (url.hostname === "localhost") {
			candidates.push(apiUrl.replace("localhost", "127.0.0.1"));
			candidates.push(apiUrl.replace("localhost", "[::1]"));
		}
	} catch {
		// ignore invalid URLs; rely on original string
	}
	return Array.from(new Set(candidates));
}

async function buildDeviceHeaders(
	configService: ConfigService,
	options?: { includeOrgContext?: boolean },
) {
	const { deviceId, deviceName } = await configService.getOrCreateDeviceId();
	const includeOrgContext = options?.includeOrgContext ?? true;
	const projectOrgId = includeOrgContext
		? await configService.getProjectOrgId()
		: undefined;
	return {
		"X-Vem-Device-Id": deviceId,
		"X-Vem-Device-Name": deviceName,
		...(projectOrgId ? { "X-Org-Id": projectOrgId } : {}),
	};
}

async function verifySession(
	apiUrl: string,
	apiKey: string,
	configService: ConfigService,
) {
	return fetch(`${apiUrl}/verify`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...(await buildDeviceHeaders(configService, {
				includeOrgContext: false,
			})),
		},
	});
}

function openBrowser(url: string) {
	const start =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";

	spawn(start, [url]);
}

async function ensureAuthenticated(
	configService: ConfigService,
): Promise<string> {
	const apiKey = await configService.getApiKey();
	if (!apiKey) {
		console.error(chalk.red("\n✖ Not logged in. Run `vem login` first.\n"));
		process.exit(1);
	}

	try {
		let response: Response | null = null;
		let lastError: unknown = null;
		for (const candidate of getApiUrlCandidates(API_URL)) {
			try {
				response = await verifySession(candidate, apiKey, configService);
				API_URL = candidate;
				lastError = null;
				break;
			} catch (err) {
				lastError = err;
			}
		}
		if (!response) throw lastError;

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				console.error(
					chalk.red(
						"\n✖ Session expired or invalid. Run `vem login` to re-authenticate.\n",
					),
				);
				process.exit(1);
			}
			console.error(
				chalk.red(`\n✖ Failed to verify session: ${response.statusText}\n`),
			);
			process.exit(1);
		}
		return apiKey;
	} catch (err: any) {
		const message = err?.message ? String(err.message) : String(err);
		console.error(
			chalk.red(
				[
					"\n✖ Failed to reach API to verify session.",
					`   API: ${API_URL}`,
					`   Error: ${message}`,
					"   Fix: ensure the API is running and reachable, or set VEM_API_URL to the correct endpoint.",
					"",
				].join("\n"),
			),
		);
		process.exit(1);
	}
}

async function validateProject(
	projectId: string,
	apiKey: string,
	configService: ConfigService,
): Promise<{ valid: boolean; name?: string; orgId?: string }> {
	try {
		const res = await fetch(`${API_URL}/projects`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				...(await buildDeviceHeaders(configService)),
			},
		});

		if (!res.ok) return { valid: false };

		const { projects } = (await res.json()) as {
			projects: Array<{ id: string; name: string; org_id?: string }>;
		};
		const found = projects.find((project) => project.id === projectId);
		return found
			? { valid: true, name: found.name, orgId: found.org_id }
			: { valid: false };
	} catch {
		// Network error — don't invalidate, just can't verify
		return { valid: true };
	}
}

async function tryAuthenticatedKey(
	configService: ConfigService,
): Promise<string | null> {
	const apiKey = await configService.getApiKey();
	if (!apiKey) return null;

	try {
		let response: Response | null = null;
		for (const candidate of getApiUrlCandidates(API_URL)) {
			try {
				response = await verifySession(candidate, apiKey, configService);
				API_URL = candidate;
				break;
			} catch {
				// try next candidate
			}
		}

		if (!response || !response.ok) return null;
		return apiKey;
	} catch (_err) {
		return null;
	}
}

export {
	API_URL,
	WEB_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	getApiUrlCandidates,
	openBrowser,
	tryAuthenticatedKey,
	validateProject,
	verifySession,
};
