#!/usr/bin/env node
import { isVemInitialized } from "@vem/core";
import chalk from "chalk";
import { Command } from "commander";

import { registerAgentCommands } from "./commands/agent.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerCycleCommands } from "./commands/cycle.js";
import { registerInstructionCommands } from "./commands/instructions.js";
import { registerMaintenanceCommands } from "./commands/maintenance.js";
import { registerPlanCommands } from "./commands/plans.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerRunnerCommands } from "./commands/runner.js";
import { registerSearchCommands } from "./commands/search.js";
import { registerSensorsCommands } from "./commands/sensors.js";
import { registerSessionsCommands } from "./commands/sessions.js";
import { registerSetupCommands } from "./commands/setup.js";
import { registerSkillsCommands } from "./commands/skills.js";
import { registerSyncCommands } from "./commands/sync.js";
import { registerTaskCommands } from "./commands/task.js";
import { initServerMonitoring, NodeSentry } from "./runtime/monitoring.js";
import {
	trackAgentSession,
	trackCommandUsageFromAction,
	trackHelpUsageFromArgv,
} from "./runtime.js";

// Initialize Sentry for the CLI
await initServerMonitoring({
	dsn: process.env.VEM_CLI_SENTRY_DSN || "",
	environment: process.env.NODE_ENV || "production",
	release: __VERSION__,
	serviceName: "cli",
});

const program = new Command();

// Keep CLI version in sync with package.json.
declare const __VERSION__: string;

program
	.name("vem")
	.description("vem Project Memory CLI")
	.version(__VERSION__)
	.addHelpText(
		"after",
		`
${chalk.bold("\n⚡ Power Workflows:")}
  ${chalk.cyan("vem agent")}          Start AI-assisted work (${chalk.bold("recommended")})
  ${chalk.cyan("vem quickstart")}     Interactive setup wizard
  ${chalk.cyan("vem status")}         Check your power feature usage

${chalk.bold("💡 Getting Started:")}
  1. ${chalk.white("vem init")}          Initialize memory
  2. ${chalk.white("vem login")}         Authenticate
  3. ${chalk.white("vem link")}          Connect to project
  4. ${chalk.white("vem agent")}         Start working with AI

${chalk.gray("For full command list: vem --help")}
`,
	);

program.hook("preAction", async (_thisCommand, actionCommand) => {
	await trackCommandUsageFromAction(actionCommand);

	if (process.env.VEM_AGENT_NAME) {
		await trackAgentSession("agent_heartbeat", {
			agentName: process.env.VEM_AGENT_NAME,
			taskId: process.env.VEM_ACTIVE_TASK,
			command: actionCommand.name(),
		});
	}

	const skipInitCheck = ["init", "login", "help", "doctor", "diff"];
	if (skipInitCheck.includes(actionCommand.name())) {
		return;
	}

	if (!(await isVemInitialized())) {
		console.error(
			chalk.red("\n✖ vem is not initialized. Run `vem init` first.\n"),
		);
		process.exit(1);
	}
});

registerProjectCommands(program);
registerRunnerCommands(program);
registerSyncCommands(program);
registerSetupCommands(program);
registerTaskCommands(program);
registerCycleCommands(program);
registerPlanCommands(program);
registerAuthCommands(program);
registerSearchCommands(program);
registerAgentCommands(program);
registerMaintenanceCommands(program);
registerSessionsCommands(program);
registerInstructionCommands(program);
registerSkillsCommands(program);
registerSensorsCommands(program);

await trackHelpUsageFromArgv(process.argv.slice(2));

try {
	program.parse();
} catch (error) {
	NodeSentry.captureException(error);
	console.error(chalk.red("\n✖ An unexpected error occurred."));
	if (process.env.NODE_ENV === "development") {
		console.error(error);
	}
	process.exit(1);
}
