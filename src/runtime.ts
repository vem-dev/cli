export {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	getApiUrlCandidates,
	openBrowser,
	tryAuthenticatedKey,
	validateProject,
	verifySession,
	WEB_URL,
} from "./runtime/auth.js";

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
} from "./runtime/git.js";

export { installGitHook } from "./runtime/hooks.js";

export { detectVemUpdateInOutput, readStdin } from "./runtime/io.js";

export {
	getCommandPath,
	getHelpMetricNameFromArgv,
	showWorkflowHint,
	syncUsageMetrics,
	trackAgentSession,
	trackCommandUsage,
	trackCommandUsageFromAction,
	trackFeatureUsage,
	trackHelpUsageFromArgv,
} from "./runtime/metrics.js";
export {
	cycleService,
	metricsService,
	parseCommaList,
	resolveActorName,
	syncService,
	TASK_CONTEXT_FILE,
	taskService,
	workflowGuide,
} from "./runtime/services.js";
export {
	collectStrictMemoryUpdate,
	enforceStrictMemoryUpdates,
	getFileMtimeMs,
	getLatestEntryMtimeMs,
	normalizeLines,
	syncProjectMemoryToRemote,
} from "./runtime/strict-memory.js";

export {
	backfillCommitHistory,
	performPush,
	processQueue,
} from "./runtime/sync.js";
