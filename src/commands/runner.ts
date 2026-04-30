import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ConfigService } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
} from "../runtime.js";

type ClaimedTaskRun = {
	id: string;
	task_external_id: string;
	task_title?: string | null;
	user_prompt?: string | null;
	task_instructions?: string | null;
	agent_base_branch?: string | null;
	reuse_existing_branch?: boolean;
	agent_name?: string | null;
	run_mode?: string | null;
};

type ClaimedTerminalSession = {
	id: string;
	command: string;
	working_directory?: string | null;
	cancellation_requested_at?: string | null;
};

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCliEntrypoint() {
	const entry = process.argv[1];
	if (!entry) {
		throw new Error("Unable to determine CLI entrypoint.");
	}
	return entry;
}

function runGit(
	args: string[],
	options?: { stdio?: "ignore" | "inherit" | "pipe" },
) {
	const output = execFileSync("git", args, {
		encoding: "utf-8",
		stdio: options?.stdio ?? "pipe",
	});
	return typeof output === "string" ? output.trim() : "";
}

function runGitIn(
	cwd: string,
	args: string[],
	options?: { stdio?: "ignore" | "inherit" | "pipe" },
) {
	const output = execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf-8",
		stdio: options?.stdio ?? "pipe",
	});
	return typeof output === "string" ? output.trim() : "";
}

function hasDirtyWorktree() {
	return runGit(["status", "--porcelain"]).trim().length > 0;
}

function getRepoRoot() {
	return runGit(["rev-parse", "--show-toplevel"]);
}

function commandExists(command: string) {
	try {
		execFileSync("which", [command], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const KNOWN_RUNNER_AGENTS = ["copilot", "gh", "claude", "codex"] as const;

function hasSandboxCredentials(agent: string) {
	if (agent === "claude") {
		return (
			typeof process.env.ANTHROPIC_API_KEY === "string" &&
			process.env.ANTHROPIC_API_KEY.trim().length > 0
		);
	}
	if (agent === "copilot" || agent === "gh") {
		const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
		if (envToken && envToken.trim().length > 0) return true;
		try {
			const token = execFileSync("gh", ["auth", "token"], {
				encoding: "utf-8",
			}).trim();
			return token.length > 0;
		} catch {
			return false;
		}
	}
	if (agent === "codex") {
		return (
			typeof process.env.OPENAI_API_KEY === "string" &&
			process.env.OPENAI_API_KEY.trim().length > 0
		);
	}
	return true;
}

function getAvailableAgentCommands(selectedAgent: string, sandbox: boolean) {
	const isAvailable = (command: string) =>
		commandExists(command) && (!sandbox || hasSandboxCredentials(command));
	const knownAvailable = KNOWN_RUNNER_AGENTS.filter((command) =>
		isAvailable(command),
	);
	const selectedAvailable = isAvailable(selectedAgent);
	if (
		selectedAvailable &&
		!knownAvailable.includes(
			selectedAgent as (typeof KNOWN_RUNNER_AGENTS)[number],
		)
	) {
		return [selectedAgent, ...knownAvailable];
	}
	return knownAvailable;
}

function getRunnerCapabilities(
	agent: string,
	sandbox = true,
	agentPinned = false,
) {
	const repoRoot = getRepoRoot();
	let branch: string | null = null;
	try {
		branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
	} catch {
		branch = null;
	}
	const availableAgents = getAvailableAgentCommands(agent, sandbox);

	return {
		task_runs: true,
		web_terminal: true,
		sandbox,
		available_agents: availableAgents,
		selected_agent: agent,
		agent_mode: agentPinned ? "pinned" : "selectable",
		workspace: {
			cwd: repoRoot,
			branch,
			dirty: hasDirtyWorktree(),
			shell: "/bin/sh",
			agent_command: agent,
			agent_available: commandExists(agent),
		},
	};
}

function checkDockerAvailable(): void {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
	} catch {
		console.error(chalk.red("✗ Docker is not running or not installed."));
		console.error(
			chalk.yellow(
				"  The vem runner requires Docker to run agents in a secure sandbox.",
			),
		);
		console.error(
			chalk.gray(
				"  Install Docker Desktop: https://www.docker.com/products/docker-desktop/",
			),
		);
		console.error(
			chalk.gray(
				"  Or run without sandbox (no isolation): vem runner --unsafe",
			),
		);
		process.exit(1);
	}
}

const SANDBOX_IMAGE_NAME = "vem-sandbox:v2";

function getSandboxImageDir(): string {
	// Dockerfile.sandbox lives in apps/cli/ — resolve relative to this dist file.
	// Use realpathSync to resolve symlinks (e.g. when vem is invoked via an nvm
	// symlink, process.argv[1] points into nvm/bin rather than the monorepo).
	let cliDist = getCliEntrypoint();
	try {
		cliDist = realpathSync(cliDist);
	} catch {
		// If realpath fails, fall through with the original path.
	}
	// dist/index.js → dist/ → apps/cli/
	const distDir = dirname(cliDist);
	const candidates = [
		resolve(distDir, "Dockerfile.sandbox"),
		resolve(distDir, "..", "Dockerfile.sandbox"),
		resolve(distDir, "..", "..", "apps", "cli", "Dockerfile.sandbox"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return dirname(candidate);
		}
	}
	throw new Error(
		"Dockerfile.sandbox not found. Ensure the vem CLI is installed correctly.",
	);
}

function buildSandboxImage(): void {
	console.log(chalk.cyan("  Building sandbox Docker image (first use)..."));
	const contextDir = getSandboxImageDir();
	execFileSync(
		"docker",
		["build", "-t", SANDBOX_IMAGE_NAME, "-f", "Dockerfile.sandbox", "."],
		{ cwd: contextDir, stdio: "inherit" },
	);
	console.log(chalk.green("  ✓ Sandbox image built."));
}

function ensureSandboxImage(): void {
	try {
		execFileSync("docker", ["image", "inspect", SANDBOX_IMAGE_NAME], {
			stdio: "ignore",
		});
	} catch {
		buildSandboxImage();
	}
}

function collectSandboxCredentials(agent: string): Record<string, string> {
	const creds: Record<string, string> = {};

	const addFromEnv = (key: string) => {
		if (process.env[key]) creds[key] = process.env[key] as string;
	};

	// Always include VEM credentials
	addFromEnv("VEM_API_KEY");
	addFromEnv("VEM_API_URL");

	// Agent-specific credentials
	if (agent === "claude") {
		addFromEnv("ANTHROPIC_API_KEY");
		if (!creds.ANTHROPIC_API_KEY) {
			console.error(
				chalk.red(
					`✗ ANTHROPIC_API_KEY is not set. Required for --agent claude.`,
				),
			);
			process.exit(1);
		}
	} else if (agent === "copilot" || agent === "gh") {
		// Try process.env first, then gh auth token from host
		const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
		if (envToken) {
			creds.GITHUB_TOKEN = envToken;
		} else {
			try {
				const token = execFileSync("gh", ["auth", "token"], {
					encoding: "utf-8",
				}).trim();
				if (token) creds.GITHUB_TOKEN = token;
			} catch {
				// gh not available or not authenticated
			}
		}
		if (!creds.GITHUB_TOKEN) {
			console.error(
				chalk.red(`✗ GitHub token not found. Required for --agent copilot.`),
			);
			console.error(
				chalk.gray("  Set GITHUB_TOKEN env var or run: gh auth login"),
			);
			process.exit(1);
		}
	} else if (agent === "codex") {
		addFromEnv("OPENAI_API_KEY");
		if (!creds.OPENAI_API_KEY) {
			console.error(
				chalk.red(`✗ OPENAI_API_KEY is not set. Required for --agent codex.`),
			);
			process.exit(1);
		}
	}

	// Include git identity for commits inside container
	if (process.env.GIT_AUTHOR_NAME)
		creds.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME;
	if (process.env.GIT_AUTHOR_EMAIL)
		creds.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL;

	return creds;
}

function sanitizeBranchSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function buildTaskRunPrTitle(
	taskExternalId: string,
	taskTitle?: string | null,
) {
	const normalizedTitle = taskTitle?.trim();
	return normalizedTitle
		? `Implement ${taskExternalId}: ${normalizedTitle}`
		: `Implement ${taskExternalId}`;
}

async function resolveGitRemote(
	configService: ConfigService,
): Promise<{ name: string; url: string | null }> {
	const linkedRemote = (await configService.getLinkedRemoteName())?.trim();
	const preferredRemote = linkedRemote || "origin";

	try {
		return {
			name: preferredRemote,
			url: runGit(["remote", "get-url", preferredRemote]),
		};
	} catch {
		if (preferredRemote !== "origin") {
			try {
				return { name: "origin", url: runGit(["remote", "get-url", "origin"]) };
			} catch {
				return { name: preferredRemote, url: null };
			}
		}
		return { name: preferredRemote, url: null };
	}
}

function prepareTaskBranch(
	taskExternalId: string,
	baseBranch: string,
	remoteName: string,
	reuseExistingBranch = false,
) {
	try {
		runGit(["fetch", remoteName]);
	} catch {
		// best effort; local refs may already be up to date
	}
	const remoteBaseRef = `${remoteName}/${baseBranch}`;
	let checkoutRef = baseBranch;
	try {
		runGit(["rev-parse", "--verify", remoteBaseRef]);
		checkoutRef = remoteBaseRef;
	} catch {
		checkoutRef = baseBranch;
	}
	const baseHash = runGit(["rev-parse", checkoutRef]);
	if (reuseExistingBranch) {
		// Iterative run: check out the existing branch without creating a new one.
		// New commits will land on the existing PR branch and the PR auto-updates.
		runGit(["checkout", baseBranch]);
		return { baseHash, branchName: baseBranch, checkoutRef };
	}
	const branchName = `vem/${sanitizeBranchSegment(taskExternalId)}-${Date.now().toString(36)}`;
	runGit(["checkout", "-b", branchName, checkoutRef]);
	return { baseHash, branchName, checkoutRef };
}

function getCommitHashesSince(baseHash: string) {
	const output = runGit(["rev-list", `${baseHash}..HEAD`]);
	return output
		.split("\n")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

// Cache device headers for the lifetime of this process to avoid
// calling buildDeviceHeaders (→ findUp → fs.stat) on every request.
// During heavy log streaming, hundreds of concurrent calls would
// saturate the libuv threadpool and cause the process to hang.
let _deviceHeadersCache: Promise<Record<string, string>> | null = null;
let _runnerIdentityHeaders: Record<string, string> = {};
function getCachedDeviceHeaders(
	configService: ConfigService,
): Promise<Record<string, string>> {
	if (!_deviceHeadersCache) {
		_deviceHeadersCache = buildDeviceHeaders(configService);
	}
	return _deviceHeadersCache;
}

const FETCH_TIMEOUT_MS = 30_000;

async function apiRequest(
	configService: ConfigService,
	apiKey: string,
	path: string,
	init?: RequestInit,
) {
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		...(await getCachedDeviceHeaders(configService)),
		..._runnerIdentityHeaders,
		...(init?.headers ?? {}),
	};

	return fetch(`${API_URL}${path}`, {
		...init,
		headers,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
}

async function appendRunLogs(
	configService: ConfigService,
	apiKey: string,
	runId: string,
	entries: Array<{
		sequence: number;
		stream: "stdout" | "stderr" | "system";
		chunk: string;
	}>,
) {
	if (entries.length === 0) return;
	await apiRequest(configService, apiKey, `/task-runs/${runId}/logs`, {
		method: "POST",
		body: JSON.stringify({ entries }),
	});
}

async function sendRunnerHeartbeat(
	configService: ConfigService,
	apiKey: string,
	projectId: string,
	status: "idle" | "busy" | "offline",
	currentTaskRunId: string | null,
	capabilities: Record<string, unknown>,
) {
	await apiRequest(
		configService,
		apiKey,
		`/projects/${projectId}/runners/heartbeat`,
		{
			method: "POST",
			body: JSON.stringify({
				status,
				current_task_run_id: currentTaskRunId,
				capabilities,
			}),
		},
	);
}

async function completeTaskRunWithRetry(
	configService: ConfigService,
	apiKey: string,
	runId: string,
	payload: Record<string, unknown>,
	attempts = 10,
) {
	let lastError = "unknown error";
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await apiRequest(
				configService,
				apiKey,
				`/task-runs/${runId}/complete`,
				{
					method: "POST",
					body: JSON.stringify(payload),
				},
			);
			if (response.ok) return;
			const bodyText = await response.text().catch(() => "");
			lastError = `HTTP ${response.status}${bodyText ? `: ${bodyText}` : ""}`;
			// On rate limit, wait for the window to reset before retrying
			if (response.status === 429) {
				const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
				const waitMs = retryAfter > 0 ? retryAfter * 1000 : 65_000;
				if (attempt < attempts) {
					console.warn(
						chalk.yellow(
							`  Rate limit hit on /complete (attempt ${attempt}/${attempts}). Waiting ${Math.round(waitMs / 1000)}s...`,
						),
					);
					await sleep(waitMs);
					continue;
				}
			}
		} catch (error: unknown) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < attempts) {
			await sleep(1000 * attempt);
		}
	}
	throw new Error(`Failed to complete run ${runId}: ${lastError}`);
}

async function executeClaimedRun(input: {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
	agent: string;
	useSandbox: boolean;
	agentPinned: boolean;
	run: ClaimedTaskRun;
}) {
	const {
		configService,
		apiKey,
		projectId,
		agent,
		useSandbox,
		agentPinned,
		run,
	} = input;
	const repoRoot = getRepoRoot();
	let sequence = 1;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let cancellationRequested = false;
	let timedOut = false;
	let branchName: string | null = null;
	let baseHash: string | null = null;
	let originalBranch: string | null = null;
	let commitHashes: string[] = [];
	let completionStatus: "completed" | "failed" | "cancelled" | "interrupted" =
		"failed";
	let exitCode: number | null = null;
	let completionError: string | null = null;
	let createPr = false;
	const baseBranch = run.agent_base_branch || "main";
	const remote = await resolveGitRemote(configService);

	try {
		if (hasDirtyWorktree()) {
			throw new Error(
				"Runner repository has uncommitted changes. Commit or stash them before starting web-triggered runs.",
			);
		}

		// Remember current branch so we can restore it after the run
		try {
			originalBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
		} catch {
			originalBranch = null;
		}

		const preparedBranch =
			run.run_mode === "review"
				? null
				: prepareTaskBranch(
						run.task_external_id,
						baseBranch,
						remote.name,
						!!run.reuse_existing_branch,
					);
		if (preparedBranch) {
			baseHash = preparedBranch.baseHash;
			branchName = preparedBranch.branchName;
		}

		await appendRunLogs(configService, apiKey, run.id, [
			{
				sequence: sequence++,
				stream: "system",
				chunk: preparedBranch
					? `Prepared branch ${branchName} from ${preparedBranch.checkoutRef}\n`
					: `Review mode — running on current branch (no new branch created)\n`,
			},
		]);

		const child = spawn(
			process.execPath,
			[
				getCliEntrypoint(),
				"agent",
				agent,
				"--task",
				run.task_external_id,
				"--auto-exit",
			],
			{
				env: {
					...process.env,
					VEM_RUNNER_INSTRUCTIONS: run.user_prompt?.trim() || "",
					VEM_RUN_MODE: run.run_mode || "implement",
				},
				cwd: repoRoot,
				// detached: true puts the child in its own process group so we can
				// kill the entire tree (vem agent + copilot subprocess) with -pid.
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		heartbeatTimer = setInterval(async () => {
			try {
				const response = await apiRequest(
					configService,
					apiKey,
					`/task-runs/${run.id}/heartbeat`,
					{ method: "POST", body: JSON.stringify({}) },
				);
				const data = (await response.json().catch(() => ({}))) as {
					run?: {
						cancellation_requested_at?: string | null;
						max_runtime_at?: string | null;
					};
				};
				if (data.run?.cancellation_requested_at && !cancellationRequested) {
					cancellationRequested = true;
					try {
						process.kill(-child.pid!, "SIGTERM");
					} catch {
						child.kill("SIGTERM");
					}
					await appendRunLogs(configService, apiKey, run.id, [
						{
							sequence: sequence++,
							stream: "system",
							chunk:
								"Cancellation requested from web UI. Stopping agent process.\n",
						},
					]);
				}
				// Kill agent if the server-side max runtime has been exceeded
				const maxRuntimeAt = data.run?.max_runtime_at
					? new Date(data.run.max_runtime_at)
					: null;
				if (
					maxRuntimeAt &&
					maxRuntimeAt.getTime() <= Date.now() &&
					!timedOut &&
					!cancellationRequested
				) {
					timedOut = true;
					try {
						process.kill(-child.pid!, "SIGTERM");
					} catch {
						child.kill("SIGTERM");
					}
					await appendRunLogs(configService, apiKey, run.id, [
						{
							sequence: sequence++,
							stream: "system",
							chunk:
								"Run exceeded the maximum runtime. Stopping agent process.\n",
						},
					]);
				}
			} catch {
				// Keep the runner alive even if a heartbeat round trips fails.
			}
		}, 30_000);

		child.stdout.on("data", async (chunk: Buffer | string) => {
			const text = chunk.toString();
			process.stdout.write(text);
			void appendRunLogs(configService, apiKey, run.id, [
				{ sequence: sequence++, stream: "stdout", chunk: text },
			]);
		});

		child.stderr.on("data", async (chunk: Buffer | string) => {
			const text = chunk.toString();
			process.stderr.write(text);
			void appendRunLogs(configService, apiKey, run.id, [
				{ sequence: sequence++, stream: "stderr", chunk: text },
			]);
		});

		const result = await new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
		}>((resolve) => {
			child.on("exit", (code, signal) => resolve({ code, signal }));
			child.on("error", (error) => {
				completionError = error.message;
				resolve({ code: null, signal: null });
			});
		});

		exitCode = result.code;
		if (completionError) {
			completionStatus = cancellationRequested ? "cancelled" : "failed";
		} else if (timedOut) {
			completionStatus = "interrupted";
			completionError = "Run exceeded the maximum runtime and was stopped.";
		} else if (cancellationRequested) {
			completionStatus = "cancelled";
		} else if (result.signal) {
			completionStatus = "interrupted";
			completionError = `Agent process terminated with signal ${result.signal}.`;
		} else if (result.code === 0) {
			completionStatus = "completed";
		} else {
			completionStatus = "failed";
			completionError = `Agent process exited with code ${result.code ?? "unknown"}.`;
		}

		if (baseHash) {
			if (completionStatus === "completed" && hasDirtyWorktree()) {
				runGit(["add", "-A"], { stdio: "inherit" });
				runGit(
					[
						"commit",
						"-m",
						`chore(${run.task_external_id}): apply agent changes`,
					],
					{ stdio: "inherit" },
				);
			}

			commitHashes = getCommitHashesSince(baseHash);
			if (
				completionStatus === "completed" &&
				branchName &&
				commitHashes.length > 0
			) {
				try {
					runGit(["push", "-u", remote.name, branchName], { stdio: "inherit" });
					createPr = true;
				} catch (error: unknown) {
					completionError =
						error instanceof Error
							? `Push to ${remote.name} failed: ${error.message}`
							: `Push to ${remote.name} failed: ${String(error)}`;
				}
			}
		}
	} catch (error: unknown) {
		completionStatus = "failed";
		completionError = error instanceof Error ? error.message : String(error);
		await appendRunLogs(configService, apiKey, run.id, [
			{
				sequence: sequence++,
				stream: "system",
				chunk: `${completionError}\n`,
			},
		]);
	} finally {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
		}

		// Always return to the branch we were on before the run
		if (originalBranch) {
			try {
				runGit(["checkout", originalBranch]);
			} catch {
				// Best effort — if checkout fails, the user will see the task branch
			}
		}

		await completeTaskRunWithRetry(configService, apiKey, run.id, {
			status: completionStatus,
			exit_code: exitCode,
			error_message: completionError,
			branch_name: branchName,
			commit_hashes: commitHashes,
			create_pr: createPr,
			pr_title: buildTaskRunPrTitle(run.task_external_id, run.task_title),
			pr_body: run.user_prompt?.trim()
				? `Triggered from VEM web.\n\nInstructions:\n${run.user_prompt.trim()}`
				: "Triggered from VEM web.",
			summary:
				completionStatus === "completed"
					? "Runner completed the queued task run."
					: `Runner finished with status ${completionStatus}.`,
		});

		await sendRunnerHeartbeat(
			configService,
			apiKey,
			projectId,
			"idle",
			null,
			getRunnerCapabilities(agent, useSandbox, agentPinned),
		);
	}
}

async function executeClaimedRunInSandbox(input: {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
	agent: string;
	run: ClaimedTaskRun;
	credentials: Record<string, string>;
}) {
	const { configService, apiKey, projectId, agent, run, credentials } = input;
	const repoRoot = getRepoRoot();
	let sequence = 1;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let worktreePath: string | null = null;
	let branchName: string | null = null;
	let baseHash: string | null = null;
	let commitHashes: string[] = [];
	let completionStatus: "completed" | "failed" | "cancelled" | "interrupted" =
		"failed";
	let exitCode: number | null = null;
	let completionError: string | null = null;
	let createPr = false;
	let dockerProcess: ReturnType<typeof spawn> | null = null;
	let containerName: string | null = null;
	let cancellationRequested = false;
	let timedOut = false;
	let fullDockerLogLines: string[] = [];
	const pendingLogEntries: Array<{
		sequence: number;
		stream: "stdout" | "stderr";
		chunk: string;
	}> = [];
	let logFlushTimer: NodeJS.Timeout | null = null;
	const flushPendingLogs = () => {
		if (pendingLogEntries.length === 0) return;
		const toFlush = pendingLogEntries.splice(0);
		appendRunLogs(configService, apiKey, run.id, toFlush).catch(() => {});
	};

	const baseBranch = run.agent_base_branch || "main";
	const remote = await resolveGitRemote(configService);
	// Use a unique attempt path — the same run can be re-claimed after a crash,
	// and a previous attempt's finally block may still be cleaning up the old path.
	worktreePath = `/tmp/vem-run-${run.id}-${Date.now().toString(36)}`;
	branchName = run.reuse_existing_branch
		? run.agent_base_branch!
		: `vem/${sanitizeBranchSegment(run.task_external_id)}-${Date.now().toString(36)}`;

	try {
		// Ensure image exists before allocating resources
		ensureSandboxImage();

		// Fetch latest remote state so baseBranch is up to date
		try {
			runGit(["fetch", remote.name]);
		} catch {
			// best effort; may not have remote
		}

		// Get real remote URL to set in the clone (so the agent can push to GitHub)
		const remoteUrl = remote.url;

		// Get base hash for detecting new commits later
		try {
			baseHash = runGit(["rev-parse", `${remote.name}/${baseBranch}`]);
		} catch {
			baseHash = runGit(["rev-parse", baseBranch]);
		}

		// Ensure baseBranch exists as a local branch for the file:// clone.
		// On iteration runs agent_base_branch is the prior run's pushed branch
		// (e.g. vem/task-32-mnjfhyth), which only exists as a remote-tracking
		// ref after git fetch — not a local branch. git clone --branch with
		// file:// only advertises refs/heads/*, so we must materialise the
		// local branch first or the clone will fail.
		const localBranchExists = (() => {
			try {
				runGit(["rev-parse", "--verify", `refs/heads/${baseBranch}`]);
				return true;
			} catch {
				return false;
			}
		})();
		if (!localBranchExists) {
			try {
				runGit(["branch", baseBranch, `${remote.name}/${baseBranch}`]);
			} catch {
				// Remote ref not found either — let clone fail with a clear error.
			}
		}

		// Clean up any stale sandbox dir at this path
		if (existsSync(worktreePath)) {
			execFileSync("rm", ["-rf", worktreePath], { stdio: "ignore" });
		}

		// Create an isolated clone using file:// URL — forces a real object copy instead of
		// hardlinks, which avoids "nonexistent object" errors when git fetch repacks the source.
		console.log(chalk.gray(`  Cloning ${baseBranch} → ${worktreePath}`));
		execFileSync(
			"git",
			[
				"clone",
				"--quiet",
				`file://${repoRoot}`,
				"--branch",
				baseBranch,
				"--single-branch",
				worktreePath,
			],
			{ stdio: "pipe" },
		);

		// Create and checkout the task branch inside the clone.
		// For iterative runs branchName === baseBranch (we cloned it above), so skip.
		if (branchName !== baseBranch) {
			runGitIn(worktreePath, ["checkout", "-b", branchName]);
		}

		// Fix origin URL to point at the real remote (not the local clone source)
		if (remoteUrl) {
			runGitIn(worktreePath, ["remote", "set-url", "origin", remoteUrl]);
		}

		await appendRunLogs(configService, apiKey, run.id, [
			{
				sequence: sequence++,
				stream: "system",
				chunk: `Prepared sandbox clone at ${worktreePath} on branch ${branchName} (base: ${baseBranch})\n`,
			},
		]);

		// Build docker run command — the image's run-task.sh handles agent execution
		const envArgs: string[] = [];
		for (const [key, value] of Object.entries(credentials)) {
			envArgs.push("-e", `${key}=${value}`);
		}
		// Pass task metadata as env vars (run-task.sh reads these)
		envArgs.push(
			"-e",
			`VEM_RUNNER_INSTRUCTIONS=${run.task_instructions?.trim() || run.user_prompt?.trim() || ""}`,
			"-e",
			`VEM_AGENT=${agent}`,
			"-e",
			`VEM_TASK_ID=${run.task_external_id}`,
			"-e",
			`VEM_RUN_MODE=${run.run_mode || "implement"}`,
		);

		containerName = `vem-run-${run.id.slice(0, 8)}-${Date.now().toString(36)}`;
		const dockerArgs = [
			"run",
			"--rm",
			"--name",
			containerName,
			"--memory",
			"4g",
			"--cpus",
			"2",
			"-v",
			`${worktreePath}:/workspace`,
			"-w",
			"/workspace",
			...envArgs,
			SANDBOX_IMAGE_NAME,
			// No command — entrypoint calls /run-task.sh when no command is given
		];

		dockerProcess = spawn("docker", dockerArgs, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		heartbeatTimer = setInterval(async () => {
			try {
				const heartbeatRes = await apiRequest(
					configService,
					apiKey,
					`/task-runs/${run.id}/heartbeat`,
					{
						method: "POST",
						body: JSON.stringify({ project_id: projectId }),
					},
				);
				if (!heartbeatRes.ok) return;
				const data = (await heartbeatRes.json()) as {
					run?: {
						cancellation_requested_at?: string | null;
						max_runtime_at?: string | null;
					};
					cancellation_requested_at?: string | null;
					max_runtime_at?: string | null;
				};
				const cancellationRequestedAt =
					data.run?.cancellation_requested_at ??
					data.cancellation_requested_at ??
					null;
				const maxRuntimeAt =
					data.run?.max_runtime_at ?? data.max_runtime_at ?? null;
				if (cancellationRequestedAt && !cancellationRequested) {
					cancellationRequested = true;
					completionStatus = "cancelled";
					if (dockerProcess?.pid) {
						try {
							if (containerName) {
								execFileSync("docker", ["stop", containerName], {
									stdio: "ignore",
								});
							} else {
								dockerProcess.kill("SIGTERM");
							}
						} catch {
							/* ignore */
						}
					}
					await appendRunLogs(configService, apiKey, run.id, [
						{
							sequence: sequence++,
							stream: "system",
							chunk:
								"Cancellation requested from web UI. Stopping sandbox container.\n",
						},
					]);
				}
				if (maxRuntimeAt && !timedOut) {
					const maxRuntime = new Date(maxRuntimeAt).getTime();
					if (Date.now() > maxRuntime) {
						timedOut = true;
						completionStatus = "failed";
						completionError =
							"Run exceeded the maximum runtime and was timed out.";
						if (dockerProcess?.pid) {
							try {
								if (containerName) {
									execFileSync("docker", ["stop", containerName], {
										stdio: "ignore",
									});
								}
							} catch {
								/* ignore */
							}
						}
						await appendRunLogs(configService, apiKey, run.id, [
							{
								sequence: sequence++,
								stream: "system",
								chunk:
									"Run exceeded the maximum runtime. Stopping sandbox container.\n",
							},
						]);
					}
				}
			} catch {
				/* heartbeat errors are non-fatal */
			}
		}, 30_000);

		const stdoutChunks: string[] = [];

		const streamLogs = (stream: "stdout" | "stderr", data: Buffer) => {
			const chunk = data.toString("utf-8");
			if (stream === "stdout") stdoutChunks.push(chunk);
			pendingLogEntries.push({ sequence: sequence++, stream, chunk });
			// Batch: flush when buffer fills up or after 2s of quiet
			if (pendingLogEntries.length >= 20) {
				if (logFlushTimer) {
					clearTimeout(logFlushTimer);
					logFlushTimer = null;
				}
				flushPendingLogs();
			} else if (!logFlushTimer) {
				logFlushTimer = setTimeout(() => {
					logFlushTimer = null;
					flushPendingLogs();
				}, 2000);
			}
			process.stdout.write(chunk);
		};

		dockerProcess.stdout?.on("data", (d: Buffer) => streamLogs("stdout", d));
		dockerProcess.stderr?.on("data", (d: Buffer) => streamLogs("stderr", d));

		exitCode = await new Promise<number>((resolve) => {
			dockerProcess?.once("exit", (code) => resolve(code ?? 1));
			dockerProcess?.once("error", () => resolve(1));
		});

		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}

		// Flush any remaining buffered log entries before processing results
		if (logFlushTimer) {
			clearTimeout(logFlushTimer);
			logFlushTimer = null;
		}
		flushPendingLogs();

		if (exitCode === 0 && !cancellationRequested && !timedOut) {
			completionStatus = "completed";
			// In review mode the agent must not commit — skip commit/PR logic
			if (run.run_mode !== "review") {
				// Collect commits made inside the container (in the sandbox clone)
				try {
					const output = runGitIn(worktreePath!, [
						"rev-list",
						`${baseHash}..HEAD`,
					]);
					commitHashes = output
						.split("\n")
						.map((h) => h.trim())
						.filter(Boolean);
				} catch {
					/* no commits */
				}
				createPr = commitHashes.length > 0;
			}
		} else if (!cancellationRequested && !timedOut) {
			completionStatus = "failed";
		}

		// Build the full Docker stdout from the in-memory buffer. This guarantees
		// the vem_update block is available even when some streamed chunks were
		// silently dropped by failed appendRunLogs API calls.
		fullDockerLogLines = stdoutChunks
			.join("")
			.split("\n")
			.filter(Boolean)
			.slice(-1000); // last 1000 lines covers any reasonable vem_update block

		// Push branch from sandbox clone if we have commits (skip in review mode)
		if (
			completionStatus === "completed" &&
			commitHashes.length > 0 &&
			run.run_mode !== "review"
		) {
			try {
				runGitIn(worktreePath!, ["push", "-u", "origin", branchName!], {
					stdio: "inherit",
				});
				await appendRunLogs(configService, apiKey, run.id, [
					{
						sequence: sequence++,
						stream: "system",
						chunk: `Pushed branch ${branchName} to ${remote.name}.\n`,
					},
				]);
			} catch (pushErr) {
				const msg =
					pushErr instanceof Error ? pushErr.message : String(pushErr);
				await appendRunLogs(configService, apiKey, run.id, [
					{
						sequence: sequence++,
						stream: "system",
						chunk: `Warning: failed to push branch: ${msg}\n`,
					},
				]);
				createPr = false;
			}
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		completionError = msg;
		completionStatus = "failed";
		console.error(chalk.red(`  ✗ Sandbox run error: ${msg}`));
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (logFlushTimer) {
			clearTimeout(logFlushTimer);
			logFlushTimer = null;
		}
		flushPendingLogs();
		await appendRunLogs(configService, apiKey, run.id, [
			{
				sequence: sequence++,
				stream: "system",
				chunk: `Sandbox run error: ${msg}\n`,
			},
		]).catch(() => {});
	} finally {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (dockerProcess) {
			try {
				if (containerName) {
					execFileSync("docker", ["stop", containerName], { stdio: "ignore" });
				}
			} catch {
				/* already stopped */
			}
			dockerProcess = null;
		}
		// Clean up sandbox clone directory
		if (worktreePath && existsSync(worktreePath)) {
			try {
				execFileSync("rm", ["-rf", worktreePath], { stdio: "ignore" });
			} catch {
				/* ignore */
			}
		}

		await completeTaskRunWithRetry(configService, apiKey, run.id, {
			project_id: projectId,
			status: completionStatus,
			exit_code: exitCode,
			error_message: completionError,
			branch_name: branchName,
			commit_hashes: commitHashes,
			create_pr: createPr,
			pr_title: buildTaskRunPrTitle(run.task_external_id, run.task_title),
			pr_body: run.user_prompt?.trim()
				? `Triggered from VEM web.\n\nInstructions:\n${run.user_prompt.trim()}`
				: "Triggered from VEM web.",
			// Pass the full Docker log so the API can parse the vem_update block
			// reliably even when some live-streamed chunks were dropped.
			full_log_lines:
				fullDockerLogLines.length > 0 ? fullDockerLogLines : undefined,
		});
	}
}

async function appendTerminalLogs(
	configService: ConfigService,
	apiKey: string,
	sessionId: string,
	entries: Array<{
		sequence: number;
		stream: "stdout" | "stderr" | "system";
		chunk: string;
	}>,
) {
	if (entries.length === 0) return;
	await apiRequest(
		configService,
		apiKey,
		`/terminal-sessions/${sessionId}/logs`,
		{
			method: "POST",
			body: JSON.stringify({ entries }),
		},
	);
}

async function executeClaimedTerminalSession(input: {
	configService: ConfigService;
	apiKey: string;
	projectId: string;
	agent: string;
	useSandbox: boolean;
	agentPinned: boolean;
	session: ClaimedTerminalSession;
}) {
	const {
		configService,
		apiKey,
		projectId,
		agent,
		useSandbox,
		agentPinned,
		session,
	} = input;
	const repoRoot = getRepoRoot();
	let sequence = 2;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let completionStatus: "completed" | "failed" | "cancelled" | "interrupted" =
		"failed";
	let exitCode: number | null = null;
	let completionError: string | null = null;
	let cancellationRequested = false;

	try {
		await appendTerminalLogs(configService, apiKey, session.id, [
			{
				sequence: sequence++,
				stream: "system",
				chunk: `Executing command in ${repoRoot}\n$ ${session.command}\n`,
			},
		]);

		const child = spawn("/bin/sh", ["-lc", session.command], {
			cwd: session.working_directory?.trim() || repoRoot,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		heartbeatTimer = setInterval(async () => {
			try {
				const response = await apiRequest(
					configService,
					apiKey,
					`/terminal-sessions/${session.id}/heartbeat`,
					{ method: "POST", body: JSON.stringify({}) },
				);
				const data = (await response.json().catch(() => ({}))) as {
					session?: { cancellation_requested_at?: string | null };
				};
				if (data.session?.cancellation_requested_at && !cancellationRequested) {
					cancellationRequested = true;
					child.kill("SIGTERM");
					await appendTerminalLogs(configService, apiKey, session.id, [
						{
							sequence: sequence++,
							stream: "system",
							chunk: "Cancellation requested from web UI. Stopping command.\n",
						},
					]);
				}
			} catch {
				// Keep session process alive if heartbeat round trip fails.
			}
		}, 10_000);

		child.stdout.on("data", (chunk: Buffer | string) => {
			const text = chunk.toString();
			process.stdout.write(text);
			void appendTerminalLogs(configService, apiKey, session.id, [
				{ sequence: sequence++, stream: "stdout", chunk: text },
			]);
		});

		child.stderr.on("data", (chunk: Buffer | string) => {
			const text = chunk.toString();
			process.stderr.write(text);
			void appendTerminalLogs(configService, apiKey, session.id, [
				{ sequence: sequence++, stream: "stderr", chunk: text },
			]);
		});

		const result = await new Promise<{
			code: number | null;
			signal: NodeJS.Signals | null;
		}>((resolve) => {
			child.on("exit", (code, signal) => resolve({ code, signal }));
			child.on("error", (error) => {
				completionError = error.message;
				resolve({ code: null, signal: null });
			});
		});

		exitCode = result.code;
		if (completionError) {
			completionStatus = cancellationRequested ? "cancelled" : "failed";
		} else if (cancellationRequested) {
			completionStatus = "cancelled";
		} else if (result.signal) {
			completionStatus = "interrupted";
			completionError = `Command terminated with signal ${result.signal}.`;
		} else if (result.code === 0) {
			completionStatus = "completed";
		} else {
			completionStatus = "failed";
			completionError = `Command exited with code ${result.code ?? "unknown"}.`;
		}
	} catch (error: unknown) {
		completionStatus = "failed";
		completionError = error instanceof Error ? error.message : String(error);
		await appendTerminalLogs(configService, apiKey, session.id, [
			{
				sequence: sequence++,
				stream: "system",
				chunk: `${completionError}\n`,
			},
		]);
	} finally {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
		}

		await apiRequest(
			configService,
			apiKey,
			`/terminal-sessions/${session.id}/complete`,
			{
				method: "POST",
				body: JSON.stringify({
					status: completionStatus,
					exit_code: exitCode,
					error_message: completionError,
					terminal_reason:
						completionStatus === "cancelled"
							? "Command cancelled from workspace UI."
							: null,
				}),
			},
		);

		await sendRunnerHeartbeat(
			configService,
			apiKey,
			projectId,
			"idle",
			null,
			getRunnerCapabilities(agent, useSandbox, agentPinned),
		);
	}
}

export function registerRunnerCommands(program: Command) {
	program
		.command("runner")
		.description("Run a paired worker that executes queued web task runs")
		.option(
			"--agent <command>",
			"Agent command to launch for claimed tasks",
			"copilot",
		)
		.option("--poll-interval <seconds>", "Polling interval in seconds", "10")
		.option("--once", "Claim at most one run and then exit")
		.option(
			"--unsafe",
			"Disable Docker sandbox (run agent directly on host — no isolation)",
		)
		.action(async (options, command) => {
			const configService = new ConfigService();
			const apiKey = await ensureAuthenticated(configService);
			const projectId = await configService.getProjectId();

			if (!projectId) {
				throw new Error("This repository is not linked to a VEM project.");
			}

			const useSandbox = !options.unsafe;
			if (useSandbox) {
				checkDockerAvailable();
				ensureSandboxImage();
			}

			const pollIntervalMs = Math.max(
				2_000,
				Number.parseInt(String(options.pollInterval ?? "10"), 10) * 1000,
			);

			const agent = String(options.agent);
			const optionSource =
				typeof command.getOptionValueSource === "function"
					? command.getOptionValueSource("agent")
					: undefined;
			const agentPinned = optionSource === "cli";
			const modeLabel = useSandbox ? "sandbox (Docker)" : "unsafe (direct)";
			const deviceHeaders = await getCachedDeviceHeaders(configService);
			const baseRunnerName =
				deviceHeaders["X-Vem-Device-Name"]?.trim() || "vem-runner";
			const runnerInstanceId = randomUUID();
			const runnerInstanceName = `${baseRunnerName} (${runnerInstanceId.slice(0, 8)})`;
			_runnerIdentityHeaders = {
				"X-Vem-Runner-Id": runnerInstanceId,
				"X-Vem-Runner-Name": runnerInstanceName,
			};
			console.log(
				chalk.cyan(
					`Starting paired runner for project ${projectId} using agent "${agent}" [${modeLabel}] (${runnerInstanceName})...`,
				),
			);
			if (!useSandbox) {
				console.log(
					chalk.yellow(
						"  ⚠  Running in unsafe mode — agent has full host access.",
					),
				);
			}

			let shouldStop = false;
			let consecutiveErrors = 0;
			process.on("SIGINT", () => {
				shouldStop = true;
			});
			process.on("SIGTERM", () => {
				shouldStop = true;
			});

			// Sandbox runners claim local_sandbox runs; unsafe runners claim local_runner runs.
			const claimBackend = useSandbox ? "local_sandbox" : "local_runner";

			while (!shouldStop) {
				try {
					const capabilities = getRunnerCapabilities(
						agent,
						useSandbox,
						agentPinned,
					);
					await sendRunnerHeartbeat(
						configService,
						apiKey,
						projectId,
						"idle",
						null,
						capabilities,
					);

					const claimResponse = await apiRequest(
						configService,
						apiKey,
						`/projects/${projectId}/task-runs/claim`,
						{
							method: "POST",
							body: JSON.stringify({
								agent_name: agent,
								backend: claimBackend,
								capabilities,
							}),
						},
					);

					if (!claimResponse.ok) {
						const data = await claimResponse.json().catch(() => ({}));
						throw new Error(
							(data as { error?: string }).error || "Failed to claim task run",
						);
					}

					const payload = (await claimResponse.json()) as {
						run: ClaimedTaskRun | null;
						active_run_id?: string;
					};
					if (!payload.run && payload.active_run_id) {
						process.stderr.write(
							`[runner] device has an active run (${payload.active_run_id}). Waiting for it to complete or expire...\n`,
						);
					}
					if (payload.run) {
						consecutiveErrors = 0;
						const runAgent =
							typeof payload.run.agent_name === "string" &&
							payload.run.agent_name.trim().length > 0
								? payload.run.agent_name.trim()
								: agent;
						if (useSandbox) {
							const credentials = collectSandboxCredentials(runAgent);
							await executeClaimedRunInSandbox({
								configService,
								apiKey,
								projectId,
								agent: runAgent,
								run: payload.run,
								credentials,
							});
						} else {
							await executeClaimedRun({
								configService,
								apiKey,
								projectId,
								agent: runAgent,
								useSandbox,
								agentPinned,
								run: payload.run,
							});
						}
						if (options.once) break;
						continue;
					}

					const terminalClaimResponse = await apiRequest(
						configService,
						apiKey,
						`/projects/${projectId}/terminal-sessions/claim`,
						{ method: "POST", body: JSON.stringify({ capabilities }) },
					);
					if (!terminalClaimResponse.ok) {
						const data = await terminalClaimResponse.json().catch(() => ({}));
						throw new Error(
							(data as { error?: string }).error ||
								"Failed to claim terminal session",
						);
					}

					const terminalPayload = (await terminalClaimResponse.json()) as {
						session: ClaimedTerminalSession | null;
					};
					if (terminalPayload.session) {
						consecutiveErrors = 0;
						await executeClaimedTerminalSession({
							configService,
							apiKey,
							projectId,
							agent,
							useSandbox,
							agentPinned,
							session: terminalPayload.session,
						});
						if (options.once) break;
						continue;
					}

					consecutiveErrors = 0;
					if (options.once) break;
					await sleep(pollIntervalMs);
				} catch (pollError: unknown) {
					consecutiveErrors++;
					const backoffMs = Math.min(5_000 * consecutiveErrors, 60_000);
					const msg =
						pollError instanceof Error ? pollError.message : String(pollError);
					process.stderr.write(
						`[runner] poll error (attempt ${consecutiveErrors}): ${msg}. Retrying in ${backoffMs / 1000}s...\n`,
					);
					await sleep(backoffMs);
				}
			}

			await sendRunnerHeartbeat(
				configService,
				apiKey,
				projectId,
				"offline",
				null,
				getRunnerCapabilities(agent, useSandbox, agentPinned),
			);
		});
}
