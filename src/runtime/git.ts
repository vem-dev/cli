import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

import { type ConfigService, getRepoRoot, getVemDir } from "@vem/core";
import chalk from "chalk";
import prompts from "prompts";

import { TASK_CONTEXT_FILE } from "./services.js";

function getGitRemotes(): Array<{ name: string; url: string }> {
	try {
		const output = execSync("git remote -v").toString().trim();
		const lines = output.split("\n");
		const remotes = new Map<string, string>();

		for (const line of lines) {
			const parts = line.split(/\s+/);
			if (parts.length >= 2) {
				const name = parts[0];
				const url = parts[1];
				// git remote -v shows fetch and push, usually same URL
				remotes.set(name, url);
			}
		}

		return Array.from(remotes.entries()).map(([name, url]) => ({
			name,
			url,
		}));
	} catch (_e) {
		return [];
	}
}

type GitRemoteOptions = {
	forcePrompt?: boolean;
	promptOnMultiple?: boolean;
	preferredRemoteName?: string;
};

type GitRemoteSelection = {
	name: string;
	url: string;
};

function getPreferredRemote(
	remotes: Array<{ name: string; url: string }>,
	preferredName = "origin",
): { name: string; url: string } | null {
	if (remotes.length === 0) return null;
	return remotes.find((remote) => remote.name === preferredName) || remotes[0];
}

async function getGitRemoteSelection(
	options: GitRemoteOptions = {},
): Promise<GitRemoteSelection | null | "REMOVE"> {
	try {
		const remotes = getGitRemotes();

		if (remotes.length === 0 && !options.forcePrompt) return null;
		if (remotes.length === 1 && !options.forcePrompt) return remotes[0];
		if (
			remotes.length > 1 &&
			!options.forcePrompt &&
			!options.promptOnMultiple
		) {
			return getPreferredRemote(
				remotes,
				options.preferredRemoteName || "origin",
			);
		}

		const choices = remotes.map((r) => ({
			title: `${r.name} (${r.url})`,
			value: r.name,
		}));

		if (options.forcePrompt) {
			choices.push({
				title: chalk.red("None / Unlink remote URL"),
				value: "REMOVE",
			});
		}

		if (choices.length === 0) return null;

		const response = await prompts({
			type: "select",
			name: "remoteName",
			message: options.forcePrompt
				? "Select git remote to link or remove binding:"
				: "Multiple git remotes detected. Select one to link:",
			choices,
		});

		const selectedRemoteName = response.remoteName as string | undefined;
		if (!selectedRemoteName) return null;
		if (selectedRemoteName === "REMOVE") return "REMOVE";

		return remotes.find((remote) => remote.name === selectedRemoteName) || null;
	} catch (_e) {
		return null;
	}
}

async function getGitRemote(
	options: GitRemoteOptions = {},
): Promise<string | null | "REMOVE"> {
	const selection = await getGitRemoteSelection(options);
	if (selection === "REMOVE") return "REMOVE";
	return selection?.url || null;
}

function getGitHash(): string | null {
	try {
		const hash = execSync("git rev-parse HEAD").toString().trim();
		return hash || null;
	} catch (_e) {
		return null;
	}
}

async function computeVemHash(): Promise<string | null> {
	try {
		const vemDir = await getVemDir();
		const hash = createHash("sha256");

		const walk = async (currentDir: string) => {
			const entries = await readdir(currentDir, { withFileTypes: true });
			entries.sort((a, b) => a.name.localeCompare(b.name));
			for (const entry of entries) {
				if (entry.name === "queue") {
					continue;
				}
				const fullPath = join(currentDir, entry.name);
				const relPath = relative(vemDir, fullPath).split("\\").join("/");
				if (
					relPath === "queue" ||
					relPath.startsWith("queue/") ||
					relPath === "config.json" ||
					relPath === ".usage-metrics.json" ||
					relPath === "exit_signal" ||
					relPath === "current_context.md" ||
					relPath === TASK_CONTEXT_FILE
				) {
					continue;
				}

				if (entry.isDirectory()) {
					hash.update(`dir:${relPath}\0`);
					await walk(fullPath);
				} else if (entry.isFile()) {
					hash.update(`file:${relPath}\0`);
					const data = await readFile(fullPath);
					hash.update(data);
				} else if (entry.isSymbolicLink()) {
					const target = await readlink(fullPath);
					hash.update(`link:${relPath}\0${target}\0`);
				}
			}
		};

		await walk(vemDir);
		return hash.digest("hex");
	} catch {
		return null;
	}
}

async function getCommits(limit = 20) {
	try {
		// Format: hash|author|date|message
		const output = execSync(
			`git log -n ${limit} --pretty=format:"%H|%an|%cI|%s"`,
		).toString();
		return output
			.split("\n")
			.map((line) => {
				const [hash, author, date, ...msgParts] = line.split("|");
				return {
					hash,
					author_name: author,
					committed_at: date,
					message: msgParts.join("|"),
				};
			})
			.filter((c) => c.hash && c.message);
	} catch (_e) {
		return [];
	}
}

async function getCommitHistory(options: {
	limit?: number;
	all?: boolean;
}): Promise<
	Array<{
		hash: string;
		message: string;
		author_name?: string;
		author_email?: string;
		committed_at?: string;
	}>
> {
	try {
		const root = await getRepoRoot();
		const gitLogArgs = ["git log"];
		if (options.all) {
			gitLogArgs.push("--all");
		} else {
			gitLogArgs.push(`-n ${options.limit ?? 200}`);
		}
		gitLogArgs.push('--pretty=format:"%H|%an|%ae|%cI|%s"');
		const output = execSync(gitLogArgs.join(" "), {
			cwd: root,
		}).toString();
		return output
			.split("\n")
			.map((line) => {
				const [hash, author, email, date, ...msgParts] = line.split("|");
				return {
					hash,
					author_name: author || undefined,
					author_email: email || undefined,
					committed_at: date || undefined,
					message: msgParts.join("|"),
				};
			})
			.filter((c) => c.hash && c.message);
	} catch (_e) {
		return [];
	}
}

async function isVemDirty(configService: ConfigService): Promise<boolean> {
	try {
		const currentHash = await computeVemHash();
		if (!currentHash) return false;
		const lastSyncedHash = await configService.getLastSyncedVemHash();
		// Conservative default: without a trusted sync baseline, treat as dirty.
		if (!lastSyncedHash) return true;
		return currentHash !== lastSyncedHash;
	} catch (_e) {
		return true;
	}
}

function normalizeStatusPath(raw: string): string {
	const trimmed = raw.trim();
	const pathPart = trimmed.length > 3 ? trimmed.slice(3).trim() : "";
	const withoutRename = pathPart.includes("->")
		? (pathPart.split("->").pop()?.trim() ?? pathPart)
		: pathPart;
	return withoutRename.replace(/^"|"$/g, "");
}

async function hasNonVemChanges(): Promise<boolean> {
	try {
		const root = await getRepoRoot();
		const status = execSync("git status --porcelain", { cwd: root })
			.toString()
			.trim();
		if (!status) return false;
		return status
			.split("\n")
			.map((line) => normalizeStatusPath(line))
			.some((path) => path.length > 0 && !path.startsWith(".vem/"));
	} catch (_e) {
		return false;
	}
}

async function hasUncommittedChanges(): Promise<boolean> {
	try {
		const root = await getRepoRoot();
		const status = execSync("git status --porcelain", { cwd: root })
			.toString()
			.trim();
		return status.length > 0;
	} catch (_e) {
		return false;
	}
}

export {
	computeVemHash,
	getCommitHistory,
	getCommits,
	getGitHash,
	getGitRemote,
	getGitRemoteSelection,
	getGitRemotes,
	hasNonVemChanges,
	hasUncommittedChanges,
	isVemDirty,
	normalizeStatusPath,
};
