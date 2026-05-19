import { SensorsService } from "@vem/core";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

import { trackCommandUsage } from "../runtime.js";

const sensorsService = new SensorsService();

export function registerSensorsCommands(program: Command) {
	const sensorsCmd = program
		.command("sensors")
		.description("Manage feedback sensors (lint, typecheck, test, etc.)");

	sensorsCmd
		.command("list")
		.description("List configured sensors")
		.action(async () => {
			await trackCommandUsage("sensors list");
			const config = await sensorsService.readConfig();
			if (config.sensors.length === 0) {
				console.log(
					chalk.gray(
						"\n  No sensors configured. Add one with: vem sensors add <name> --cmd <command>\n",
					),
				);
				return;
			}

			const table = new Table({
				head: ["Name", "Command", "Description"],
				style: { head: ["cyan"] },
				colWidths: [16, 40, 30],
				wordWrap: true,
			});
			for (const s of config.sensors) {
				table.push([
					chalk.white(s.name),
					chalk.gray(s.cmd),
					s.description ?? "",
				]);
			}
			console.log(chalk.bold("\n🔍  Feedback Sensors\n"));
			console.log(table.toString());
			console.log();
		});

	sensorsCmd
		.command("add <name>")
		.description("Add or update a sensor")
		.requiredOption("--cmd <command>", "Shell command to run")
		.option("--description <text>", "Human-readable description")
		.action(
			async (name: string, options: { cmd: string; description?: string }) => {
				await trackCommandUsage("sensors add");
				await sensorsService.addSensor({
					name,
					cmd: options.cmd,
					description: options.description,
				});
				console.log(chalk.green(`\n✔ Sensor '${name}' saved.\n`));
				console.log(chalk.gray(`  Run it with: vem sensors run ${name}\n`));
			},
		);

	sensorsCmd
		.command("remove <name>")
		.description("Remove a sensor by name")
		.action(async (name: string) => {
			await trackCommandUsage("sensors remove");
			const removed = await sensorsService.removeSensor(name);
			if (removed) {
				console.log(chalk.green(`\n✔ Sensor '${name}' removed.\n`));
			} else {
				console.error(chalk.red(`\n✖ Sensor '${name}' not found.\n`));
				process.exitCode = 1;
			}
		});

	sensorsCmd
		.command("run [name]")
		.description("Run one or all sensors and show results")
		.action(async (name?: string) => {
			await trackCommandUsage("sensors run");
			const config = await sensorsService.readConfig();
			if (config.sensors.length === 0) {
				console.log(
					chalk.gray(
						"\n  No sensors configured. Add one with: vem sensors add <name> --cmd <command>\n",
					),
				);
				return;
			}

			const toRun = name
				? config.sensors.filter((s) => s.name === name)
				: config.sensors;

			if (name && toRun.length === 0) {
				console.error(chalk.red(`\n✖ Sensor '${name}' not found.\n`));
				process.exitCode = 1;
				return;
			}

			console.log(
				chalk.bold(
					`\n🔍  Running ${toRun.length === 1 ? `sensor '${toRun[0]?.name}'` : `${toRun.length} sensors`}...\n`,
				),
			);

			let anyFailed = false;
			for (const sensor of toRun) {
				process.stdout.write(`  ${chalk.gray(sensor.name)}  `);
				const result = await sensorsService.runSensor(sensor);
				const duration = `${result.durationMs}ms`;

				if (result.passed) {
					console.log(chalk.green(`✓ passed`) + chalk.gray(` (${duration})`));
				} else {
					console.log(
						chalk.red(`✗ failed`) +
							chalk.gray(` (exit ${result.exitCode}, ${duration})`),
					);
					anyFailed = true;

					const outputLines = result.output
						.split("\n")
						.filter((l) => l.trim())
						.slice(0, 8);
					for (const line of outputLines) {
						console.log(`     ${chalk.gray(line)}`);
					}
					if (result.output.split("\n").filter((l) => l.trim()).length > 8) {
						console.log(chalk.gray("     … (truncated)"));
					}
					console.log();
				}
			}

			console.log();
			if (anyFailed) {
				process.exitCode = 1;
			}
		});
}
