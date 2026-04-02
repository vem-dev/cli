import { ConfigService } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";

import {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	getGitRemote,
	trackCommandUsage,
} from "../runtime.js";

export function registerSearchCommands(program: Command) {
	program
		.command("search <query>")
		.description("Search project memory (tasks, context, decisions)")
		.action(async (query) => {
			await trackCommandUsage("search");
			try {
				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);

				console.log(chalk.blue(`🔍 Searching for "${query}"...`));

				const res = await fetch(
					`${API_URL}/search?q=${encodeURIComponent(query)}`,
					{
						headers: {
							Authorization: `Bearer ${key}`,
							...(await buildDeviceHeaders(configService)),
						},
					},
				);

				if (!res.ok) {
					if (res.status === 401) {
						console.error(
							chalk.red("Error: Unauthorized. Your API Key is invalid."),
						);
						return;
					}
					if (res.status === 403) {
						const errorData = (await res.json().catch(() => ({}))) as {
							error?: string;
						};
						console.error(
							chalk.red(
								errorData.error ||
									"Device limit reached. Disconnect a device or upgrade your plan.",
							),
						);
						return;
					}
					const err = await res.text();
					throw new Error(`API Error ${res.status}: ${err}`);
				}

				const data = (await res.json()) as { results: any[] };

				if (!data.results || data.results.length === 0) {
					console.log(chalk.yellow("No results found."));
					return;
				}

				console.log(chalk.green(`\nFound ${data.results.length} results:\n`));

				data.results.forEach((item: any, i) => {
					const typeLabel = chalk.gray(
						`[${item.type?.toUpperCase() || "UNKNOWN"}]`,
					);
					console.log(
						`${i + 1}. ${typeLabel} ${chalk.bold(item.title || "Untitled")}`,
					);
					if (item.content) {
						console.log(
							chalk.gray(
								`   ${item.content.substring(0, 100).replace(/\n/g, " ")}...`,
							),
						);
					}
					if (item.score) {
						console.log(chalk.gray(`   Score: ${item.score.toFixed(2)}`));
					}
					console.log("");
				});
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Search Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Search Failed:"), String(error));
				}
			}
		});

	program
		.command("ask <question>")
		.description("Ask a question about project memory (commits, diffs, tasks)")
		.option("-p, --path <path>", "Limit results to a file path or directory")
		.action(async (question, options) => {
			await trackCommandUsage("ask");
			try {
				const cleanedQuestion =
					typeof question === "string" ? question.trim() : "";
				if (!cleanedQuestion) {
					console.error(chalk.red("\n✖ Question is required.\n"));
					return;
				}

				const configService = new ConfigService();
				const key = await ensureAuthenticated(configService);
				const projectId = await configService.getProjectId();

				if (!projectId) {
					console.error(
						chalk.red("\n✖ Project not linked. Run `vem link` first.\n"),
					);
					return;
				}

				console.log(chalk.blue(`Asking: "${cleanedQuestion}"...`));

				const payload: { question: string; path?: string; taskRunId?: string } = {
					question: cleanedQuestion,
				};
				if (typeof options.path === "string" && options.path.trim()) {
					payload.path = options.path.trim();
				}
				if (process.env.VEM_TASK_RUN_ID) {
					payload.taskRunId = process.env.VEM_TASK_RUN_ID;
				}

				const res = await fetch(`${API_URL}/projects/${projectId}/ask`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${key}`,
						"Content-Type": "application/json",
						"X-Vem-Client": "cli",
						...(await buildDeviceHeaders(configService)),
					},
					body: JSON.stringify(payload),
				});

				if (!res.ok) {
					const err = await res.text().catch(() => "");
					throw new Error(`API Error ${res.status}: ${err || res.statusText}`);
				}

				const data = (await res.json()) as {
					answer?: string;
					citations?: Array<{ id: string; reason?: string }>;
					sources?: Array<{
						id?: string;
						type?: string;
						path?: string;
						commit_hash?: string;
						task_id?: string;
						title?: string;
						description?: string;
					}>;
				};

				if (data.answer) {
					console.log(chalk.green("\nAnswer:\n"));
					console.log(data.answer.trim());
				} else {
					console.log(chalk.yellow("\nNo answer generated."));
				}

				const repoUrl = await getGitRemote();

				if (data.citations && data.citations.length > 0) {
					console.log(chalk.green("\nCitations:"));
					data.citations.forEach((cite, idx) => {
						const source = data.sources?.find((s) => s.id === cite.id);
						let label = cite.id;
						let link = "";

						if (source) {
							if (source.type === "commit" && source.commit_hash) {
								label = `Commit ${source.commit_hash.slice(0, 7)}`;
								if (repoUrl) {
									link = `${repoUrl}/commit/${source.commit_hash}`;
								}
							} else if (
								(source.type === "code" || source.type === "diff") &&
								source.path
							) {
								label = `File ${source.path}`;
								if (repoUrl) {
									link = `${repoUrl}/blob/${source.commit_hash || "HEAD"}/${source.path}`;
								}
							}
						}

						const note = cite.reason ? ` - ${cite.reason}` : "";
						if (link) {
							// Terminal-supported links if needed, or just text
							// Use OSC 8 for hyperlinks if supported, otherwise just text
							// For broad compatibility, maybe just print text or use `terminal-link` package if available.
							// Since we don't have that package confirmed, let's just print "Commit shortHash (url)"
							console.log(chalk.gray(`${idx + 1}. ${label} (${link})${note}`));
						} else {
							console.log(chalk.gray(`${idx + 1}. ${label}${note}`));
						}
					});
				}

				if (data.sources && data.sources.length > 0) {
					console.log(chalk.green("\nSources:"));
					data.sources.forEach((source, idx) => {
						const details: string[] = [];
						if (source.type) details.push(source.type.toUpperCase());
						if (source.path) details.push(source.path);
						if (source.commit_hash)
							details.push(source.commit_hash.slice(0, 7));
						if (source.task_id) details.push(source.task_id);
						const header = [source.id, ...details].filter(Boolean).join(" • ");
						console.log(chalk.gray(`${idx + 1}. ${header || "SOURCE"}`));
						if (source.title) {
							console.log(chalk.gray(`   ${source.title}`));
						} else if (source.description) {
							console.log(chalk.gray(`   ${source.description}`));
						}
					});
				}
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Ask Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Ask Failed:"), String(error));
				}
			}
		});
}
