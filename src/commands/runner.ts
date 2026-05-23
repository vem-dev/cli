import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { arch, homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
	ConfigService,
	CycleValidationService,
	DECISIONS_DIR,
	ScalableLogService,
	SensorsService,
} from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	validateProject,
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
	cycle_run_id?: string | null;
	project_id?: string | null;
};

type ClaimedTerminalSession = {
	id: string;
	command: string;
	working_directory?: string | null;
	cancellation_requested_at?: string | null;
};

function isVerbose() {
	return process.env.VEM_RUNNER_VERBOSE === "1";
}

function formatError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const parts = [err.message];
	if (err.cause != null) parts.push(`caused by: ${formatError(err.cause)}`);
	return parts.join(" — ");
}

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

const KNOWN_RUNNER_AGENTS = ["copilot", "gh", "claude", "gemini", "codex"] as const;

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

const SANDBOX_IMAGE_NAME = "vem-sandbox:v3";

/** Returns the Docker platform string matching the current host architecture. */
function getHostDockerPlatform(): string {
	return arch() === "arm64" ? "linux/arm64" : "linux/amd64";
}

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
	const platform = getHostDockerPlatform();
	console.log(
		chalk.cyan(
			`  Building sandbox Docker image for ${platform} (first use)...`,
		),
	);
	const contextDir = getSandboxImageDir();
	execFileSync(
		"docker",
		[
			"build",
			"--platform",
			platform,
			"-t",
			SANDBOX_IMAGE_NAME,
			"-f",
			"Dockerfile.sandbox",
			".",
		],
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

function parseVemPlanBlock(
	output: string,
): { title: string; body: string } | null {
	// Look for a {"vem_plan":{...}} JSON object in the output.
	// The block may appear anywhere — scan line by line for the opening token.
	const marker = '"vem_plan"';
	const idx = output.lastIndexOf(marker);
	if (idx === -1) return null;

	// Walk backwards to find the opening brace of the containing object
	let start = idx - 1;
	while (start >= 0 && output[start] !== "{") start--;
	if (start < 0) return null;

	// Find the matching closing brace by counting depth
	let depth = 0;
	let end = start;
	for (; end < output.length; end++) {
		if (output[end] === "{") depth++;
		else if (output[end] === "}") {
			depth--;
			if (depth === 0) break;
		}
	}
	if (depth !== 0) return null;

	try {
		const parsed = JSON.parse(output.slice(start, end + 1)) as {
			vem_plan?: { title?: unknown; body?: unknown };
		};
		const plan = parsed.vem_plan;
		if (!plan || typeof plan.title !== "string" || !plan.title.trim()) {
			return null;
		}
		return {
			title: plan.title.trim(),
			body: typeof plan.body === "string" ? plan.body : "",
		};
	} catch {
		return null;
	}
}

/**
 * Detect the repository's default branch (main, master, or whatever HEAD points to).
 * Used as fallback when agent_base_branch is not set on a run.
 */
function detectDefaultBranch(remoteName: string): string {
	// Try the remote's HEAD symbolic ref first (most reliable)
	try {
		const ref = runGit([
			"symbolic-ref",
			`refs/remotes/${remoteName}/HEAD`,
		]).trim();
		// ref is "refs/remotes/origin/main" → extract last segment
		const parts = ref.split("/");
		if (parts.length > 0) return parts[parts.length - 1];
	} catch {
		// Remote HEAD not set or fetch never run
	}
	// Fall back to checking which of main/master exists locally
	for (const candidate of ["main", "master"]) {
		try {
			runGit(["rev-parse", "--verify", `refs/heads/${candidate}`]);
			return candidate;
		} catch {
			// not found
		}
	}
	return "main";
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
	// The plan branch may not exist locally or remotely yet (e.g. first run on a
	// new shared plan branch). Fall back to main/master so we can still proceed.
	let baseHash: string;
	try {
		baseHash = runGit(["rev-parse", checkoutRef]);
	} catch {
		const fallback = ["main", "master"].find((b) => {
			try {
				runGit(["rev-parse", "--verify", b]);
				return true;
			} catch {
				return false;
			}
		});
		if (!fallback) {
			throw new Error(
				`Cannot resolve base commit: ref '${checkoutRef}' not found locally or remotely`,
			);
		}
		checkoutRef = fallback;
		baseHash = runGit(["rev-parse", fallback]);
	}
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

	const url = `${API_URL}${path}`;
	try {
		return await fetch(url, {
			...init,
			headers,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (err) {
		if (isVerbose()) {
			throw new Error(`fetch ${url}: ${formatError(err)}`, { cause: err });
		}
		throw err;
	}
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

/**
 * For web-triggered cycle validation runs, run sensors + architecture drift
 * before the AI review agent starts. This mirrors what `vem cycle validate`
 * does on the CLI, so the Architecture Drift panel is populated and the AI
 * agent receives real sensor context.
 *
 * Runs at most once per cycle_run — skipped if preflight already posted.
 */
async function runCyclePreflightIfNeeded(input: {
	configService: ConfigService;
	apiKey: string;
	cycleRunId: string;
}) {
	const { configService, apiKey, cycleRunId } = input;

	try {
		// Check if preflight has already been posted for this cycle_run
		const statusRes = await apiRequest(
			configService,
			apiKey,
			`/cycle-runs/${cycleRunId}/preflight-status`,
		);
		if (!statusRes.ok) return; // non-fatal — skip sensors on API error

		const status = (await statusRes.json()) as {
			has_preflight: boolean;
			validation_rules: Record<string, unknown> | null;
		};

		if (status.has_preflight) return; // already done for this run

		const rules = status.validation_rules ?? {};
		const runSensors = rules.run_sensors_on_validate !== false; // default true

		console.log(chalk.gray("  [preflight] Running sensor checks..."));

		const sensorsService = new SensorsService();
		let sensorResults: import("@vem/core").SensorResult[] = [];

		if (runSensors) {
			try {
				const config = await sensorsService.readConfig();
				if (config.sensors.length > 0) {
					sensorResults = await sensorsService.runSensors();
					const passed = sensorResults.filter((r) => r.passed).length;
					console.log(
						chalk.gray(
							`  [preflight] Sensors: ${passed}/${sensorResults.length} passed`,
						),
					);
				} else {
					console.log(
						chalk.gray("  [preflight] No sensors configured — skipping"),
					);
				}
			} catch {
				// Sensor failure is non-fatal — continue with empty results
				console.log(chalk.yellow("  [preflight] Sensor run failed — skipping"));
			}
		}

		// Load decisions for architecture drift detection
		const decisionsLog = new ScalableLogService(DECISIONS_DIR);
		const decisionsService = new CycleValidationService();
		let decisions: Array<{
			id: string;
			title: string;
			enforcement_pattern?: string;
		}> = [];
		try {
			const entries = await decisionsLog.getAllEntries();
			decisions = entries
				.map((entry) => {
					const match = entry.content.match(/^enforcement_pattern:\s*(.+)$/m);
					return {
						id: entry.id,
						title: entry.title,
						enforcement_pattern: match ? match[1].trim() : undefined,
					};
				})
				.filter((d) => d.enforcement_pattern !== undefined);
		} catch {
			// Non-fatal — drift scan runs with empty decisions
		}

		const gitDiff = decisionsService.getGitDiffSince();
		const preflight = await decisionsService.runPreflight(
			[], // tasks are reviewed by the AI agent; preflight only needs drift + sensors
			sensorResults,
			decisions,
			gitDiff,
			{
				require_evidence_on_done: false,
				require_all_tasks_done_to_close: false,
				require_no_blocked_tasks: false,
				run_sensors_on_validate: runSensors,
				strict_mode: !!rules.strict_mode,
				trigger_ai_review_on_close: false,
				preferred_backend:
					(rules.preferred_backend as "cloud" | "local") ?? "local",
			},
		);

		if (preflight.driftViolations.length > 0) {
			console.log(
				chalk.yellow(
					`  [preflight] Architecture drift: ${preflight.driftViolations.length} violation(s)`,
				),
			);
		}

		// Post preflight results to API so the UI Architecture Drift panel populates
		await apiRequest(
			configService,
			apiKey,
			`/cycle-runs/${cycleRunId}/preflight`,
			{
				method: "PATCH",
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

		console.log(chalk.gray("  [preflight] Sensor + drift results posted"));
	} catch (err) {
		// Non-fatal — sensor/drift failures should never block the AI review
		if (isVerbose()) {
			console.warn(chalk.yellow(`  [preflight] Warning: ${formatError(err)}`));
		}
	}
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
	// The API pre-writes sequence=1 ("Queued...") for every run, so start at 2
	// to avoid onConflictDoNothing silently dropping the runner's first log entry.
	let sequence = 2;
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
	let stdoutBuffer = "";
	let createdPlanId: string | null = null;
	const remote = await resolveGitRemote(configService);
	const baseBranch = run.agent_base_branch || detectDefaultBranch(remote.name);

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

		const isPlanCreationMode = run.run_mode === "plan_creation";

		const preparedBranch =
			run.run_mode === "review" || isPlanCreationMode
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
					: isPlanCreationMode
						? "Plan creation mode — running research agent (no branch created)\n"
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
					// Inject review-submit credentials so `vem review submit` works
					// from inside the agent subprocess for local unsafe runner runs.
					VEM_TASK_RUN_ID: run.id,
					VEM_API_KEY: apiKey,
					VEM_API_URL: API_URL,
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
						status?: string | null;
					};
				};
				if (
					(data.run?.cancellation_requested_at ||
						data.run?.status === "cancelled") &&
					!cancellationRequested
				) {
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

		const isBufferedMode = isPlanCreationMode || run.run_mode === "review";

		child.stdout.on("data", async (chunk: Buffer | string) => {
			const text = chunk.toString();
			process.stdout.write(text);
			if (isBufferedMode) stdoutBuffer += text;
			void appendRunLogs(configService, apiKey, run.id, [
				{ sequence: sequence++, stream: "stdout", chunk: text },
			]);
		});

		child.stderr.on("data", async (chunk: Buffer | string) => {
			const text = chunk.toString();
			process.stderr.write(text);
			if (isBufferedMode) stdoutBuffer += text;
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

		// Plan creation mode: extract vem_plan block from agent output and save plan
		if (isPlanCreationMode && completionStatus === "completed") {
			const planData = parseVemPlanBlock(stdoutBuffer);
			if (planData) {
				try {
					const planRes = await apiRequest(
						configService,
						apiKey,
						`/projects/${projectId}/project-plans`,
						{
							method: "POST",
							body: JSON.stringify({
								title: planData.title,
								body: planData.body,
								source: "agent",
								task_run_id: run.id,
							}),
						},
					);
					if (planRes.ok) {
						const planBody = (await planRes.json().catch(() => ({}))) as {
							plan?: { id?: string };
						};
						createdPlanId = planBody.plan?.id ?? null;
						await appendRunLogs(configService, apiKey, run.id, [
							{
								sequence: sequence++,
								stream: "system",
								chunk: `Plan created: ${createdPlanId ?? "unknown"}\n`,
							},
						]);
					} else {
						const errBody = await planRes.json().catch(() => ({}));
						await appendRunLogs(configService, apiKey, run.id, [
							{
								sequence: sequence++,
								stream: "system",
								chunk: `Warning: failed to create plan (${planRes.status}): ${JSON.stringify(errBody)}\n`,
							},
						]);
					}
				} catch (planErr) {
					await appendRunLogs(configService, apiKey, run.id, [
						{
							sequence: sequence++,
							stream: "system",
							chunk: `Warning: error creating plan: ${planErr instanceof Error ? planErr.message : String(planErr)}\n`,
						},
					]);
				}
			} else {
				await appendRunLogs(configService, apiKey, run.id, [
					{
						sequence: sequence++,
						stream: "system",
						chunk:
							"Warning: no vem_plan block found in agent output. Plan was not created.\n",
					},
				]);
			}
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
			...(createdPlanId ? { plan_id: createdPlanId } : {}),
			// Supply buffered log lines for review runs so applyVemReviewFromLogs
			// doesn't have to race against async DB writes from appendRunLogs.
			...(run.run_mode === "review" && stdoutBuffer
				? { full_log_lines: stdoutBuffer.split("\n") }
				: {}),
			summary:
				completionStatus === "completed"
					? createdPlanId
						? `Runner completed the queued task run. Plan created: ${createdPlanId}.`
						: "Runner completed the queued task run."
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
	// The API pre-writes sequence=1 ("Queued...") for every run, so start at 2
	// to avoid onConflictDoNothing silently dropping the runner's first log entry.
	let sequence = 2;
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

	const remote = await resolveGitRemote(configService);
	const baseBranch = run.agent_base_branch || detectDefaultBranch(remote.name);
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

		// Get base hash for detecting new commits later.
		// For brand-new plan branches that don't exist yet, fall back to
		// main/master HEAD so agent commits can still be detected.
		try {
			baseHash = runGit(["rev-parse", `${remote.name}/${baseBranch}`]);
		} catch {
			try {
				baseHash = runGit(["rev-parse", baseBranch]);
			} catch {
				// Branch doesn't exist yet — use default branch as base
				const defaultBase = ["main", "master"].find((b) => {
					try {
						runGit(["rev-parse", "--verify", `${remote.name}/${b}`]);
						return true;
					} catch {
						try {
							runGit(["rev-parse", "--verify", b]);
							return true;
						} catch {
							return false;
						}
					}
				});
				if (defaultBase) {
					try {
						baseHash = runGit(["rev-parse", `${remote.name}/${defaultBase}`]);
					} catch {
						try {
							baseHash = runGit(["rev-parse", defaultBase]);
						} catch {
							// leave as null
						}
					}
				}
			}
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
				// Remote ref not found either — for plan branches, fall back to
				// creating from the project default branch so the clone can proceed.
				// The runner will push the new branch on first commit.
				if (run.reuse_existing_branch) {
					const defaultBase = ["main", "master"].find((b) => {
						try {
							runGit(["rev-parse", "--verify", `refs/heads/${b}`]);
							return true;
						} catch {
							try {
								runGit(["rev-parse", "--verify", `${remote.name}/${b}`]);
								return true;
							} catch {
								return false;
							}
						}
					});
					if (defaultBase) {
						try {
							const baseRef = (() => {
								try {
									runGit([
										"rev-parse",
										"--verify",
										`${remote.name}/${defaultBase}`,
									]);
									return `${remote.name}/${defaultBase}`;
								} catch {
									return defaultBase;
								}
							})();
							runGit(["branch", baseBranch, baseRef]);
						} catch {
							// Let clone fail with a clear error.
						}
					}
				}
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

		// Sync clone with the real remote. This is critical for iterative plan runs:
		// previous tasks push commits to the remote, but the local file:// clone source
		// may not include them. Without this sync, the pre-computed baseHash (from
		// `git rev-parse remote/branch`) would reference a commit unknown to the clone,
		// causing `rev-list baseHash..HEAD` to throw → commitHashes stays empty.
		try {
			runGitIn(worktreePath, ["fetch", "origin", baseBranch]);
			runGitIn(worktreePath, ["reset", "--hard", `origin/${baseBranch}`]);
			// Recompute baseHash from the clone's actual HEAD after sync so rev-list works
			baseHash = runGitIn(worktreePath, ["rev-parse", "HEAD"]);
		} catch {
			// Fetch failed (auth, network, or branch not on remote yet); keep pre-computed baseHash
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

		// Prepare ~/.vem-cache dirs for language runtime caching
		const vemCacheDir = resolve(homedir(), ".vem-cache");
		const rustupCache = resolve(vemCacheDir, "rustup");
		const cargoCache = resolve(vemCacheDir, "cargo");
		const goCache = resolve(vemCacheDir, "go");
		for (const dir of [rustupCache, cargoCache, goCache]) {
			try {
				mkdirSync(dir, { recursive: true });
			} catch {
				// best-effort; won't fail the run
			}
		}

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
			// Language runtime caches — avoid re-downloading on each task
			"-v",
			`${rustupCache}:/usr/local/rustup`,
			"-v",
			`${cargoCache}:/usr/local/cargo`,
			"-v",
			`${goCache}:/usr/local/go`,
			"-e",
			"RUSTUP_HOME=/usr/local/rustup",
			"-e",
			"CARGO_HOME=/usr/local/cargo",
			"-e",
			"GO_CACHE=/usr/local/go",
			"-e",
			`PATH=/usr/local/cargo/bin:/usr/local/go/bin:${process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`,
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
						status?: string | null;
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
				if (
					(cancellationRequestedAt || data.run?.status === "cancelled") &&
					!cancellationRequested
				) {
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
			// In review/plan_creation mode the agent must not commit — skip commit/PR logic
			if (run.run_mode !== "review" && run.run_mode !== "plan_creation") {
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

		// Push branch from sandbox clone if we have commits (skip in review/plan_creation mode)
		if (
			completionStatus === "completed" &&
			commitHashes.length > 0 &&
			run.run_mode !== "review" &&
			run.run_mode !== "plan_creation"
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

		// Plan creation mode: extract vem_plan block from sandbox stdout and deposit plan
		let sandboxCreatedPlanId: string | null = null;
		if (run.run_mode === "plan_creation" && completionStatus === "completed") {
			const fullOutput = fullDockerLogLines.join("\n");
			const planData = parseVemPlanBlock(fullOutput);
			if (planData) {
				try {
					const planRes = await apiRequest(
						configService,
						apiKey,
						`/projects/${projectId}/project-plans`,
						{
							method: "POST",
							body: JSON.stringify({
								title: planData.title,
								body: planData.body,
								source: "agent",
								task_run_id: run.id,
							}),
						},
					);
					if (planRes.ok) {
						const planBody = (await planRes.json().catch(() => ({}))) as {
							plan?: { id?: string };
						};
						sandboxCreatedPlanId = planBody.plan?.id ?? null;
					}
				} catch {
					/* non-fatal — log will surface in run output */
				}
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
			...(sandboxCreatedPlanId ? { plan_id: sandboxCreatedPlanId } : {}),
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
		.option("--poll-interval <seconds>", "Polling interval in seconds", "3")
		.option("--once", "Claim at most one run and then exit")
		.option(
			"--unsafe",
			"Disable Docker sandbox (run agent directly on host — no isolation)",
		)
		.action(async (options, command) => {
			// Load .env from cwd so vars like VEM_RUNNER_VERBOSE work without
			// exporting them in the shell (non-fatal if .env doesn't exist).
			try {
				process.loadEnvFile();
			} catch {
				// no .env file in cwd — fine
			}
			const configService = new ConfigService();
			const apiKey = await ensureAuthenticated(configService);
			const projectId = await configService.getProjectId();

			if (!projectId) {
				throw new Error("This repository is not linked to a VEM project.");
			}

			// Resolve the human-readable project name for the startup banner.
			// Try the local cache first; fall back to a lightweight API lookup
			// (e.g., for repos linked before project name caching was introduced).
			let projectName = await configService.getProjectName();
			if (!projectName) {
				try {
					const check = await validateProject(projectId, apiKey, configService);
					if (check.name) {
						projectName = check.name;
						await configService.setProjectName(check.name);
					}
				} catch {
					// Non-fatal — we'll fall back to showing just the ID.
				}
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
			console.log(chalk.cyan.bold("\n⚡ vem runner starting\n"));
			console.log(
				`  ${chalk.gray("Project:")}  ${projectName ? `${chalk.white.bold(projectName)} ${chalk.gray(`(${projectId})`)}` : chalk.white(projectId)}`,
			);
			console.log(`  ${chalk.gray("Agent:")}    ${chalk.white(agent)}`);
			console.log(`  ${chalk.gray("Mode:")}     ${chalk.white(modeLabel)}`);
			console.log(
				`  ${chalk.gray("Runner:")}   ${chalk.white(runnerInstanceName)}`,
			);
			console.log();
			if (!useSandbox) {
				console.log(
					chalk.yellow(
						"  ⚠  Running in unsafe mode — agent has full host access.",
					),
				);
			}
			if (isVerbose()) {
				console.log(
					chalk.gray("  🔍 Verbose logging enabled (VEM_RUNNER_VERBOSE=1)."),
				);
			}

			let shouldStop = false;
			let activeJobRunning = false;
			let consecutiveErrors = 0;
			let sigintCount = 0;
			let sigintResetTimer: NodeJS.Timeout | null = null;

			process.on("SIGINT", () => {
				if (!activeJobRunning) {
					shouldStop = true;
					process.stderr.write(
						chalk.gray("\n  Runner stopped. (no active job)\n"),
					);
					return;
				}

				sigintCount++;
				if (sigintResetTimer) clearTimeout(sigintResetTimer);

				if (sigintCount === 1) {
					process.stderr.write(
						chalk.yellow(
							"\n  ⚠  A job is currently running. Press Ctrl+C again within 5s to force stop, or wait for it to complete.\n",
						),
					);
					sigintResetTimer = setTimeout(() => {
						sigintCount = 0;
					}, 5_000);
				} else {
					if (sigintResetTimer) clearTimeout(sigintResetTimer);
					shouldStop = true;
					process.stderr.write(chalk.red("\n  ✖ Force stopping runner...\n"));
					process.exit(1);
				}
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
						activeJobRunning = true;
						try {
							// For web-triggered cycle validation runs, run sensors + drift
							// before the AI agent starts so the Architecture Drift panel
							// in the web UI is populated (mirrors `vem cycle validate`).
							let skipAgentDueToCancellation = false;
							if (
								payload.run.cycle_run_id &&
								payload.run.run_mode === "review"
							) {
								await runCyclePreflightIfNeeded({
									configService,
									apiKey,
									cycleRunId: payload.run.cycle_run_id,
								});

								// Check if the run was cancelled while the preflight was running.
								// The cycle-run cancel endpoint sets task_run.cancellation_requested_at
								// and task_run.status = "cancelled"; detect either signal here so
								// we don't spawn the agent subprocess unnecessarily.
								try {
									const cancelCheckRes = await apiRequest(
										configService,
										apiKey,
										`/task-runs/${payload.run.id}/heartbeat`,
										{ method: "POST", body: JSON.stringify({}) },
									);
									if (cancelCheckRes.ok) {
										const cancelData = (await cancelCheckRes.json()) as {
											run?: {
												cancellation_requested_at?: string | null;
												status?: string | null;
											};
										};
										if (
											cancelData.run?.cancellation_requested_at ||
											cancelData.run?.status === "cancelled"
										) {
											process.stderr.write(
												`[runner] run ${payload.run.id} was cancelled during preflight — skipping agent spawn\n`,
											);
											skipAgentDueToCancellation = true;
										}
									}
								} catch {
									// Non-fatal; proceed and let executeClaimedRun handle it.
								}
							}

							if (!skipAgentDueToCancellation) {
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
							}
						} finally {
							activeJobRunning = false;
							sigintCount = 0;
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
						activeJobRunning = true;
						try {
							await executeClaimedTerminalSession({
								configService,
								apiKey,
								projectId,
								agent,
								useSandbox,
								agentPinned,
								session: terminalPayload.session,
							});
						} finally {
							activeJobRunning = false;
							sigintCount = 0;
						}
						if (options.once) break;
						continue;
					}

					consecutiveErrors = 0;
					if (options.once) break;
					await sleep(pollIntervalMs);
				} catch (pollError: unknown) {
					consecutiveErrors++;
					const backoffMs = Math.min(5_000 * consecutiveErrors, 60_000);
					const msg = isVerbose()
						? formatError(pollError)
						: pollError instanceof Error
							? pollError.message
							: String(pollError);
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
			console.log(chalk.gray("\n  Runner offline.\n"));
		});
}
