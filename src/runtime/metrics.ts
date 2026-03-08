import { ConfigService } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";

import { API_URL, buildDeviceHeaders, tryAuthenticatedKey } from "./auth.js";
import { metricsService, workflowGuide } from "./services.js";

const SIGNIFICANT_METRICS_COMMANDS = new Set([
	"agent",
	"push",
	"finalize",
	"search",
	"ask",
	"archive",
	"task done",
	"insights",
]);
const HELP_FLAGS = new Set(["--help", "-h"]);

const trackedCommandsThisProcess = new Set<string>();

const normalizeCommandName = (commandName: string) =>
	commandName.trim().replace(/\s+/g, " ");

const getHelpMetricNameFromArgv = (argv: string[]): string | null => {
	if (!argv || argv.length === 0) return null;

	// Explicit help command (e.g. `vem help task add`)
	if (argv[0] === "help") {
		const target = argv
			.slice(1)
			.filter(
				(token) => token && !token.startsWith("-") && !HELP_FLAGS.has(token),
			);
		if (target.length === 0) return "help";
		return normalizeCommandName(`${target.join(" ")} help`);
	}

	// Help flag usage (e.g. `vem task add --help`)
	const helpIndex = argv.findIndex((token) => HELP_FLAGS.has(token));
	if (helpIndex === -1) return null;
	const commandTokens = argv
		.slice(0, helpIndex)
		.filter((token) => token && !token.startsWith("-"));
	if (commandTokens.length === 0) return "help";
	return normalizeCommandName(`${commandTokens.join(" ")} help`);
};

const getCommandPath = (actionCommand: Command): string | null => {
	const segments: string[] = [];
	let current: Command | null = actionCommand;
	while (current) {
		const name = current.name();
		if (!name || name === "vem") break;
		segments.unshift(name);
		current = (current.parent as Command | undefined) ?? null;
	}
	if (segments.length === 0) return null;
	return normalizeCommandName(segments.join(" "));
};

const shouldForceSyncCommand = (commandName: string) => {
	const normalized = normalizeCommandName(commandName);
	if (!normalized) return false;
	if (SIGNIFICANT_METRICS_COMMANDS.has(normalized)) return true;
	return normalized === "help" || normalized.endsWith(" help");
};

const syncUsageMetrics = async (options?: {
	force?: boolean;
	event?: {
		command?: string;
		featureFlag?: string;
		metadata?: Record<string, unknown>;
	};
}) => {
	try {
		const configService = new ConfigService();
		const apiKey = await tryAuthenticatedKey(configService);
		if (!apiKey) return;
		await metricsService.syncToCloud({
			apiUrl: API_URL,
			apiKey,
			projectId: await configService.getProjectId(),
			headers: await buildDeviceHeaders(configService),
			force: options?.force,
			event: options?.event,
		});
	} catch {
		// Silently fail - metrics sync should not break CLI
	}
};

const trackCommandUsage = async (commandName: string) => {
	const normalized = normalizeCommandName(commandName);
	if (!normalized) return;
	if (trackedCommandsThisProcess.has(normalized)) return;
	trackedCommandsThisProcess.add(normalized);

	try {
		await metricsService.trackCommand(normalized);
		await syncUsageMetrics({
			force: shouldForceSyncCommand(normalized),
			event: { command: normalized },
		});
	} catch {
		// Silently fail - metrics shouldn't break CLI
	}
};

const trackFeatureUsage = async (featureName: string) => {
	try {
		await metricsService.trackFeature(featureName);
		await syncUsageMetrics({
			force: true,
			event: { featureFlag: featureName },
		});
	} catch {
		// Silently fail - metrics shouldn't break CLI
	}
};

const showWorkflowHint = async (commandName: string) => {
	try {
		const suggestion = await workflowGuide.getSuggestion(commandName);
		if (suggestion && (await workflowGuide.shouldShowNudge(suggestion.type))) {
			console.log();
			if (suggestion.priority === "high") {
				console.log(chalk.cyan(`💡 ${suggestion.title}`));
			} else {
				console.log(chalk.gray(`💡 ${suggestion.title}`));
			}
			console.log(chalk.gray(`   ${suggestion.message}`));
			if (suggestion.command) {
				console.log(chalk.gray(`   Try: ${chalk.white(suggestion.command)}`));
			}
			console.log();
		}
	} catch {
		// Silently fail
	}
};

const trackCommandUsageFromAction = async (actionCommand: Command) => {
	const commandPath = getCommandPath(actionCommand);
	if (!commandPath) return;
	if (commandPath === "help") return;
	await trackCommandUsage(commandPath);
};

const trackHelpUsageFromArgv = async (argv: string[]) => {
	const helpMetric = getHelpMetricNameFromArgv(argv);
	if (!helpMetric) return;
	await trackCommandUsage(helpMetric);
};

const trackAgentSession = async (
	action: "agent_start" | "agent_heartbeat" | "agent_stop",
	metadata: {
		agentName: string;
		taskId?: string;
		command?: string;
	},
) => {
	try {
		await syncUsageMetrics({
			force: true,
			event: {
				featureFlag: action,
				metadata,
			},
		});
	} catch {
		// Silently fail
	}
};

export {
	getCommandPath,
	getHelpMetricNameFromArgv,
	showWorkflowHint,
	shouldForceSyncCommand,
	syncUsageMetrics,
	trackCommandUsage,
	trackCommandUsageFromAction,
	trackHelpUsageFromArgv,
	trackFeatureUsage,
	trackAgentSession,
};
