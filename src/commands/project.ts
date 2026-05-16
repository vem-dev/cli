import { ConfigService } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";
import prompts from "prompts";
import {
	API_URL,
	buildDeviceHeaders,
	ensureAuthenticated,
	getGitRemoteSelection,
	installGitHook,
	openBrowser,
	validateProject,
	WEB_URL,
} from "../runtime.js";

/**
 * Interactive project selection and repo binding flow.
 * Returns the linked projectId on success, or null if cancelled.
 * Used by both `vem link` (no args) and `vem init`.
 */
export async function runInteractiveLinkFlow(
	apiKey: string,
	configService: ConfigService,
): Promise<string | null> {
	let projectId: string | undefined;
	let projectOrgId = await configService.getProjectOrgId();

	// Fetch available projects
	const res = await fetch(`${API_URL}/projects`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...(await buildDeviceHeaders(configService, {
				includeOrgContext: false,
			})),
		},
	});

	if (!res.ok) {
		console.error(
			chalk.red(`\n✖ Failed to fetch projects: ${res.statusText}\n`),
		);
		return null;
	}

	const {
		projects,
		workspaces: listedWorkspaces,
		current_org_id: currentOrgId,
	} = (await res.json()) as {
		projects: Array<{
			id: string;
			name: string;
			repo_url?: string;
			org_id?: string;
			org_name?: string | null;
			is_personal?: boolean;
		}>;
		workspaces?: Array<{
			id: string;
			name?: string | null;
			is_personal?: boolean;
		}>;
		current_org_id?: string;
	};

	type WorkspaceOption = {
		id: string;
		label: string;
		isPersonal: boolean;
	};

	const CREATE_NEW = "CREATE_NEW";
	const BACK = "BACK";
	const workspaceMap = new Map<string, WorkspaceOption>();

	for (const workspace of listedWorkspaces || []) {
		if (!workspace?.id) continue;
		workspaceMap.set(workspace.id, {
			id: workspace.id,
			label: workspace.name || workspace.id,
			isPersonal: Boolean(workspace.is_personal),
		});
	}

	for (const candidate of projects) {
		if (!candidate.org_id) continue;
		const existing = workspaceMap.get(candidate.org_id);
		if (!existing) {
			workspaceMap.set(candidate.org_id, {
				id: candidate.org_id,
				label: candidate.org_name || candidate.org_id || "Organization",
				isPersonal: Boolean(candidate.is_personal),
			});
		} else if (candidate.is_personal) {
			existing.isPersonal = true;
		}
	}

	if (workspaceMap.size === 0 && currentOrgId) {
		workspaceMap.set(currentOrgId, {
			id: currentOrgId,
			label: "Personal",
			isPersonal: true,
		});
	}

	const workspaceChoices = Array.from(workspaceMap.values()).sort((a, b) => {
		if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
		return a.label.localeCompare(b.label);
	});

	type RemoteSelection = { name: string; url: string } | null | "REMOVE";

	const chooseProjectForWorkspace = async (
		workspace: WorkspaceOption,
		allowBack: boolean,
	): Promise<
		| { type: "cancel" }
		| { type: "back" }
		| {
				type: "selected";
				projectId: string;
				orgId?: string;
				repoSelection?: RemoteSelection;
		  }
	> => {
		const workspaceProjects = projects.filter(
			(item) => item.org_id === workspace.id,
		);

		const choices: Array<{
			title: string;
			value: string;
			description?: string;
			disabled?: boolean;
		}> = [
			{
				title: chalk.green("+ Create New Project"),
				value: CREATE_NEW,
				description: `Create a new project in ${workspace.label}`,
			},
		];

		if (workspaceProjects.length > 0) {
			for (const item of workspaceProjects) {
				choices.push({
					title: `${item.name} (${item.id})`,
					value: item.id,
					description: item.repo_url ? `Repo: ${item.repo_url}` : undefined,
				});
			}
		} else {
			choices.push({
				title: chalk.gray("No projects yet"),
				value: "NO_PROJECTS",
				disabled: true,
			});
		}

		if (allowBack) {
			choices.push({
				title: chalk.gray("← Back"),
				value: BACK,
			});
		}

		const message = workspace.isPersonal
			? "Select a personal project to link:"
			: `Select a project in ${workspace.label}:`;
		const response = await prompts({
			type: "select",
			name: "projectId",
			message,
			choices,
		});
		const selectedProjectId = response.projectId as string | undefined;
		if (!selectedProjectId) return { type: "cancel" };
		if (selectedProjectId === BACK) return { type: "back" };

		if (selectedProjectId === CREATE_NEW) {
			const projectInput = await prompts({
				type: "text",
				name: "name",
				message: `Enter project name for ${workspace.label}:`,
				validate: (value) =>
					value.length < 3 ? "Name must be at least 3 characters" : true,
			});

			if (!projectInput.name) {
				return { type: "cancel" };
			}

			const newProjectRemoteSelection = await getGitRemoteSelection({
				promptOnMultiple: true,
			});
			const repoUrl =
				newProjectRemoteSelection === "REMOVE"
					? "REMOVE"
					: (newProjectRemoteSelection?.url ?? null);
			const createHeaders: Record<string, string> = {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(configService, {
					includeOrgContext: false,
				})),
				"X-Org-Id": workspace.id,
			};
			const createRes = await fetch(`${API_URL}/projects`, {
				method: "POST",
				headers: createHeaders,
				body: JSON.stringify({
					name: projectInput.name,
					repo_url: repoUrl === "REMOVE" ? undefined : repoUrl || undefined,
				}),
			});

			if (!createRes.ok) {
				const err = (await createRes.json().catch(() => ({}))) as {
					error?: string;
				};
				if (createRes.status === 403) {
					console.error(
						chalk.red(
							`\n✖ Check failed: ${err.error || "Tier limit reached"}\n`,
						),
					);
				} else if (createRes.status === 409) {
					console.error(
						chalk.red(
							`\n✖ ${err.error || "Failed to create project: Already exists."}\n`,
						),
					);
				} else {
					console.error(
						chalk.red(
							`\n✖ Failed to create project: ${err.error || createRes.statusText}\n`,
						),
					);
				}
				return { type: "cancel" };
			}

			const { project } = (await createRes.json()) as {
				project: { id: string; org_id?: string };
			};
			console.log(chalk.green(`\n✔ Project created: ${project.id}`));
			return {
				type: "selected",
				projectId: project.id,
				orgId: project.org_id || workspace.id,
				repoSelection: newProjectRemoteSelection,
			};
		}

		const selected = workspaceProjects.find(
			(item) => item.id === selectedProjectId,
		);
		return {
			type: "selected",
			projectId: selectedProjectId,
			orgId: selected?.org_id || workspace.id,
		};
	};

	const hasOrgWorkspace = workspaceChoices.some((item) => !item.isPersonal);
	// Tracks the remote selection made during project creation (if any) to avoid prompting twice.
	let capturedRepoSelection: RemoteSelection | undefined;

	if (!hasOrgWorkspace) {
		const personalWorkspace = workspaceChoices.find((item) => item.isPersonal);
		const activeWorkspace = personalWorkspace || workspaceChoices[0];
		if (!activeWorkspace) {
			console.log(chalk.yellow("\nNo available workspaces found.\n"));
			return null;
		}

		const selection = await chooseProjectForWorkspace(activeWorkspace, false);
		if (selection.type !== "selected") {
			console.log(chalk.yellow("\nOperation cancelled.\n"));
			return null;
		}

		projectId = selection.projectId;
		projectOrgId = selection.orgId || projectOrgId;
		if ("repoSelection" in selection) {
			capturedRepoSelection = selection.repoSelection;
		}
	} else {
		while (!projectId) {
			const workspaceResponse = await prompts({
				type: "select",
				name: "workspaceId",
				message: "Select personal or organization workspace:",
				choices: workspaceChoices.map((workspace) => ({
					title: workspace.isPersonal
						? `Personal (${workspace.label})`
						: workspace.label,
					value: workspace.id,
				})),
			});
			const selectedWorkspaceId = workspaceResponse.workspaceId as
				| string
				| undefined;
			if (!selectedWorkspaceId) {
				console.log(chalk.yellow("\nOperation cancelled.\n"));
				return null;
			}

			const selectedWorkspace = workspaceMap.get(selectedWorkspaceId);
			if (!selectedWorkspace) {
				console.log(chalk.yellow("\nOperation cancelled.\n"));
				return null;
			}

			const selection = await chooseProjectForWorkspace(
				selectedWorkspace,
				true,
			);
			if (selection.type === "cancel") {
				console.log(chalk.yellow("\nOperation cancelled.\n"));
				return null;
			}
			if (selection.type === "back") {
				continue;
			}

			projectId = selection.projectId;
			projectOrgId = selection.orgId || projectOrgId;
			if ("repoSelection" in selection) {
				capturedRepoSelection = selection.repoSelection;
			}
		}
	}

	if (!projectId) return null;

	await configService.setProjectId(projectId);
	await configService.setProjectOrgId(projectOrgId || null);

	// If the remote was already chosen during project creation, reuse it; otherwise prompt now.
	const repoSelection: RemoteSelection =
		capturedRepoSelection !== undefined
			? capturedRepoSelection
			: await getGitRemoteSelection({
					forcePrompt: false,
					promptOnMultiple: true,
				});
	const repoUrl =
		repoSelection === "REMOVE" ? "REMOVE" : (repoSelection?.url ?? null);
	const linkedRemoteName =
		repoSelection === "REMOVE" ? null : (repoSelection?.name ?? null);

	// Update server-side repo URL
	try {
		const patchRes = await fetch(`${API_URL}/projects/${projectId}`, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...(await buildDeviceHeaders(configService)),
				...(projectOrgId ? { "X-Org-Id": projectOrgId } : {}),
			},
			body: JSON.stringify({
				repo_url: repoUrl === "REMOVE" ? null : repoUrl || undefined,
			}),
		});
		if (!patchRes.ok) {
			const err = await patchRes.text().catch(() => "");
			console.log(
				chalk.yellow(
					`  ⚠ Warning: Failed to update server-side repo URL: ${err || patchRes.statusText}`,
				),
			);
		}
	} catch (_err) {
		console.log(
			chalk.yellow("  ⚠ Warning: Could not reach server to update repo URL."),
		);
	}

	if (repoUrl === "REMOVE" || !repoUrl) {
		await configService.setLinkedRemote(null);
	} else {
		await configService.setLinkedRemote({
			name: linkedRemoteName,
			url: repoUrl,
		});
	}

	await installGitHook({ promptIfMissing: false, quiet: true });

	if (!repoUrl || repoUrl === "REMOVE") {
		console.log(
			chalk.yellow(
				"\n⚠ For full advantage of vem (automatic indexing, code search, and PR summaries), you should link a repo origin.",
			),
		);
	} else {
		console.log(chalk.gray(`Repo: ${repoUrl}`));
	}
	console.log(chalk.green(`\n✔ Linked to project ${projectId}\n`));

	return projectId;
}

export function registerProjectCommands(program: Command) {
	program
		.command("link [projectId]")
		.description("Link this repo to a vem project")
		.option("--reset", "Reset the linked repository origin")
		.action(async (projectId, options: { reset?: boolean }) => {
			try {
				const configService = new ConfigService();
				const apiKey = await ensureAuthenticated(configService);
				const projectIdArg = projectId;
				let projectOrgId = await configService.getProjectOrgId();

				if (!projectId && !options.reset) {
					await runInteractiveLinkFlow(apiKey, configService);
					return;
				} else if (options.reset && !projectId) {
					projectId = await configService.getProjectId();
					if (!projectId) {
						console.error(
							chalk.red(
								"\n✖ Not linked to any project. Link a project first or provide a projectId.\n",
							),
						);
						return;
					}
				}

				if (projectIdArg) {
					const check = await validateProject(projectId, apiKey, configService);
					if (!check.valid) {
						console.error(
							chalk.red(
								`\n✖ Project ${projectId} not found. It may have been deleted or you may not have access.\n`,
							),
						);
						return;
					}
					projectOrgId = check.orgId || projectOrgId;
				}

				if (projectId) {
					await configService.setProjectId(projectId);
					await configService.setProjectOrgId(projectOrgId || null);
				}

				const repoSelection = await getGitRemoteSelection({
					forcePrompt: options.reset,
					promptOnMultiple: true,
				});
				const repoUrl =
					repoSelection === "REMOVE" ? "REMOVE" : (repoSelection?.url ?? null);
				const linkedRemoteName =
					repoSelection === "REMOVE" ? null : (repoSelection?.name ?? null);

				// Update server-side repo URL if we have a projectId and a repoUrl (even if REMOVE)
				if (projectId && (options.reset || !projectIdArg)) {
					try {
						const res = await fetch(`${API_URL}/projects/${projectId}`, {
							method: "PATCH",
							headers: {
								Authorization: `Bearer ${apiKey}`,
								"Content-Type": "application/json",
								...(await buildDeviceHeaders(configService)),
								...(projectOrgId ? { "X-Org-Id": projectOrgId } : {}),
							},
							body: JSON.stringify({
								repo_url: repoUrl === "REMOVE" ? null : repoUrl || undefined,
							}),
						});

						if (!res.ok) {
							const err = await res.text().catch(() => "");
							console.log(
								chalk.yellow(
									`  ⚠ Warning: Failed to update server-side repo URL: ${err || res.statusText}`,
								),
							);
						}
					} catch (_err) {
						console.log(
							chalk.yellow(
								"  ⚠ Warning: Could not reach server to update repo URL.",
							),
						);
					}
				}

				if (repoUrl === "REMOVE" || !repoUrl) {
					await configService.setLinkedRemote(null);
				} else {
					await configService.setLinkedRemote({
						name: linkedRemoteName,
						url: repoUrl,
					});
				}

				// Keep existing VEM-managed hooks in sync with latest remote-aware behavior.
				await installGitHook({ promptIfMissing: false, quiet: true });

				if (options.reset) {
					if (repoUrl === "REMOVE") {
						console.log(chalk.green("\n✔ Repository binding removed."));
						console.log(
							chalk.yellow(
								"⚠ For full advantage of vem (automatic indexing, code search, and PR summaries), you should link a repo origin.",
							),
						);
					} else if (repoUrl) {
						console.log(
							chalk.green(`\n✔ Repository binding updated to: ${repoUrl}`),
						);
					}
				} else {
					if (!repoUrl || repoUrl === "REMOVE") {
						console.log(
							chalk.yellow(
								"\n⚠ For full advantage of vem (automatic indexing, code search, and PR summaries), you should link a repo origin.",
							),
						);
					} else {
						console.log(chalk.gray(`Repo: ${repoUrl}`));
					}
				}

				if (!options.reset) {
					console.log(chalk.green(`\n✔ Linked to project ${projectId}\n`));
				}
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Link Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Link Failed:"), String(error));
				}
			}
		});

	program
		.command("unlink")
		.description("Unlink this repo from a vem project")
		.action(async () => {
			try {
				const configService = new ConfigService();
				const projectId = await configService.getProjectId();

				if (!projectId) {
					console.log(chalk.yellow("\n⚠ Not linked to any project.\n"));
					return;
				}

				const apiKey = await ensureAuthenticated(configService);

				// Fetch Project Name
				let projectName = "Unknown Project";
				try {
					const res = await fetch(`${API_URL}/projects`, {
						headers: {
							Authorization: `Bearer ${apiKey}`,
							...(await buildDeviceHeaders(configService)),
						},
					});
					if (res.ok) {
						const { projects } = (await res.json()) as {
							projects: Array<{ id: string; name: string }>;
						};
						const found = projects.find((p) => p.id === projectId);
						if (found) projectName = found.name;
					}
				} catch (_) {
					// Ignore fetch error, just show ID
				}

				const response = await prompts({
					type: "confirm",
					name: "confirmed",
					message: `Are you sure you want to unlink from project ${chalk.bold(projectName)} (${projectId})?`,
					initial: false,
				});

				if (response.confirmed) {
					await configService.setProjectId(null);
					await configService.setProjectOrgId(null);
					await configService.setLinkedRemote(null);
					console.log(chalk.green("\n✔ Unlinked from project.\n"));
				} else {
					console.log(chalk.yellow("\nOperation cancelled.\n"));
				}
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red("\n✖ Unlink Failed:"), error.message);
				} else {
					console.error(chalk.red("\n✖ Unlink Failed:"), String(error));
				}
			}
		});

	const projectCmd = program.command("project").description("Project commands");

	projectCmd
		.command("open [projectId]")
		.description("Open the web app on the project page")
		.action(async (projectId) => {
			try {
				const configService = new ConfigService();
				const resolvedProjectId =
					projectId || (await configService.getProjectId());

				if (!resolvedProjectId) {
					console.error(
						chalk.red("\n✖ Project not linked. Run `vem link` first.\n"),
					);
					process.exit(1);
				}

				const projectUrl = `${WEB_URL}/project/${resolvedProjectId}`;
				console.log(chalk.blue(`\n🌐 Opening: ${projectUrl}\n`));
				openBrowser(projectUrl);
			} catch (error: any) {
				console.error(
					chalk.red("\n✖ Failed to open project:"),
					error?.message ?? String(error),
				);
			}
		});
}
