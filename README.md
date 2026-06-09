![vem logo](https://cdn.jsdelivr.net/npm/@vemdev/cli@latest/logo-512.png)

# @vemdev/cli


The command-line interface for VEM project memory.

## Installation

```bash
npm install -g @vemdev/cli
```

## Prerequisites

- Node.js 20+
- A VEM account and API key
- Docker (required for `vem runner` default sandbox mode; use `--unsafe` to bypass on hosts where Docker is unavailable)

## Quick Start

```bash
vem init
vem login
vem link
vem status
vem --help
```

## Core Commands

- `vem init` Initialize `.vem/` memory files in the current repository
- `vem quickstart` Interactive guide to powerful VEM workflows
- `vem login [key]` Authenticate with your VEM API key
- `vem logout` Clear local authentication
- `vem link [projectId]` Link this repository to a VEM project (`--reset` to reset the origin URL)
- `vem unlink` Unlink this repository from a VEM project
- `vem status` Show current project status
- `vem insights` Show detailed usage metrics and workflow insights
- `vem push` Push local memory snapshot to cloud
- `vem pull` Pull latest cloud snapshot to local files
- `vem diff` Show differences between local and cloud state
- `vem pack` Bundle local memory into a context pack
- `vem finalize --file <path>` Apply a `vem_update` block from a file or stdin; also accepts piped stdin (e.g. `cat agent-response.md | vem finalize`)
- `vem task ...` Manage tasks (see [Task Management](#task-management))
- `vem decision add ...` Record an architectural decision
- `vem context show|set` Read or update project context
- `vem search <query>` Search memory
- `vem ask <question>` Ask questions over project memory
- `vem summarize` Analyze current git changes and suggest VEM memory updates
- `vem doctor` Run health checks on VEM setup
- `vem agent [command] [args...]` Run an AI agent session (e.g. `vem agent --task TASK-001 claude`; see [vem agent Options](#vem-agent-command-args-options))
- `vem runner` Run a paired worker that executes queued task runs (see [Runner](#runner))
- `vem cycle ...` Manage project cycles/sprints (see [Cycle Management](#cycle-management))
- `vem plan ...` Manage task plans (see [Plan Management](#plan-management))
- `vem sessions ...` View agent session history (see [Sessions](#sessions))
- `vem instructions ...` Manage project AI instructions (see [Instructions](#instructions))
- `vem constitution ...` Manage the Agent Constitution (see [Constitution](#constitution))
- `vem skills ...` Manage slash-command skills (see [Skills](#skills))
- `vem sensors ...` Manage feedback sensors (see [Sensors](#sensors))
- `vem review ...` Submit cycle validation reviews (see [Review](#review))
- `vem validation show|edit` Manage validation rules (see [Maintenance](#maintenance))
- `vem queue` List offline snapshot queue (see [Maintenance](#maintenance))
- `vem archive` Archive old memory files (see [Maintenance](#maintenance))
- `vem drift check` Check for architecture drift (see [Maintenance](#maintenance))
- `vem project open` Open the VEM web app on the project page

## Task Management

```bash
vem task add "Implement GitHub App webhook retries" --priority high --type feature
vem task list
vem task list --status in-progress
vem task start TASK-001 --reasoning "Starting implementation"
vem task done TASK-001 --evidence "pnpm test" --reasoning "Tests passed and behavior validated"
vem task block TASK-001 --reasoning "Waiting on API design"
vem task unblock TASK-001 --reasoning "Blocker resolved"
vem task delete TASK-001 --reasoning "No longer needed"
vem task details --id <id>       # Show full task details
vem task subtasks --parent <id> # Show parent task and its subtasks
vem task context <id>           # View or update task context
vem task assign <id> [assignee] # Assign a task to a user
vem task sessions <id>          # Show all agent sessions attached to a task
vem task flow [id]              # Show flow metrics: cycle time, lead time, WIP (project summary when no id given)
vem task score [id]             # Show or set the impact score (0-100)
vem task ready [id]             # Mark a task as ready (refined and ready to start)
vem task iterate <id>           # Iterate on a task that already has a PR
vem task spec <id>              # View or set acceptance criteria
vem task update <id> [options]  # Update task metadata (see options below)
```

### `vem task assign <id> [assignee]`

> **Interactive mode:** When `assignee` is omitted, the CLI fetches project collaborators and presents an interactive selector if the project is linked to the cloud.

> **Note:** Assignment is written to the local task cache immediately. Run `vem push` to sync the change to the cloud.

### `vem task add` Options

> **Interactive mode:** When `title` is omitted (`vem task add` with no arguments), the CLI enters an interactive wizard that guides you through setting the title, priority, and optional fields step-by-step.

| Option | Description |
|---|---|
| `-p, --priority <priority>` | Priority: `low`, `medium`, `high`, `critical` |
| `-d, --description <text>` | Task description |
| `--tags <tags>` | Comma-separated tags |
| `--type <type>` | Task type: `feature`, `bug`, `chore`, `spike`, `enabler` |
| `--estimate-hours <hours>` | Estimated hours (e.g. `2.5`) |
| `--depends-on <ids>` | Comma-separated task IDs this task depends on |
| `--blocked-by <ids>` | Comma-separated task IDs blocking this task |
| `--recurrence <rule>` | Recurrence rule: `weekly`, `monthly`, or a cron expression |
| `--due-at <iso>` | Due date as ISO string (e.g. `2025-06-01`) |
| `--validation <steps>` | Comma-separated validation steps |
| `--cycle <id>` | Assign to a cycle (e.g. `CYCLE-001`) |
| `--impact-score <score>` | Impact score 0–100 (RICE-based priority) |
| `--owner <id>` | Owner user ID |
| `--reviewer <id>` | Reviewer user ID |
| `--parent <id>` | Parent task ID (for subtasks) |
| `--order <number>` | Subtask display order |
| `--actor <name>` | Actor name recorded in the audit log |
| `-r, --reasoning <text>` | Reasoning for task creation |

### `vem task list` Options

| Option | Description |
|---|---|
| `--all` | Show all tasks, including completed and deleted tasks |
| `--deleted` | Show only deleted tasks |
| `--status <status>` | Filter by status: `todo`, `ready`, `in-review`, `in-progress`, `blocked`, `done` |
| `--done` | Show only completed (non-deleted) tasks (alias for `--status done`) |
| `--cycle <id>` | Filter by cycle ID (e.g. `CYCLE-001`) |
| `--flow` | Show 'Cycle' (cycle ID) and 'Score' (impact score) columns |

> **Note:** The `in-review` status is not settable via the CLI or MCP tools. It is set automatically by GitHub webhook integration when a PR is opened, or via the web dashboard.

### `vem task start [id]` Options

> **Interactive mode:** When `id` is omitted, the CLI presents an interactive selector of `todo` and `ready` tasks. This prompt is not available in non-interactive/scripted environments — always provide the task ID explicitly in CI or automation.

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reasoning for starting the task |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task ready [id]` Options

> **Interactive mode:** When `id` is omitted, the CLI presents an interactive selector of `todo` tasks. This prompt is not available in non-interactive/scripted environments — always provide the task ID explicitly in CI or automation.

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reasoning for marking the task ready |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task done [id]` Options

> **Interactive mode:** When `id` is omitted, the CLI presents an interactive selector of `in-progress` tasks. This prompt is not available in non-interactive/scripted environments — always provide the task ID explicitly in CI or automation.

| Option | Description |
|---|---|
| `-e, --evidence <evidence>` | Evidence for completion (file path or command); comma-separated for multiple entries |
| `-r, --reasoning <text>` | Reasoning for completion |
| `--validation <steps>` | Comma-separated validation steps completed (required in non-interactive/CI mode when the task has validation steps defined; an interactive prompt is shown when running in a terminal) |
| `--actor <name>` | Actor name recorded in the audit log |
| `--context-summary <summary>` | Summary of the task context to preserve after completion |

### `vem task block <id>` Options

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | **(Required)** Reason for blocking the task |
| `--blocked-by <ids>` | Comma-separated task IDs that are blocking this task |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task score [id]` Options

When `id` is omitted, displays a table of all active tasks with their current impact scores, highlighting tasks that have not yet been scored. Use `vem task score <id> --set <0-100>` to assign a score to a specific task.

| Option | Description |
|---|---|
| `--set <score>` | Set impact score manually (0–100) |
| `-r, --reasoning <text>` | Reasoning for the score change |

### `vem task flow [id]`

Shows flow metrics for a task or a project-level summary.

**With an ID** (`vem task flow TASK-042`):

| Field | Description |
|---|---|
| Lead time | Time from task creation to completion (`created → done`) |
| Cycle time | Time from task start to completion (`started → done`) |
| Time in each status | Breakdown of time spent in each status (e.g. `todo`, `in-progress`, `blocked`) |

**Without an ID** (`vem task flow`) — project summary:

| Field | Description |
|---|---|
| WIP (active tasks) | Number of tasks currently in progress |
| Throughput (last 7d) | Tasks completed in the last 7 days |
| Throughput (last 30d) | Tasks completed in the last 30 days |
| Avg cycle time | Average time from start to done across all completed tasks |
| Avg lead time | Average time from creation to done across all completed tasks |

### `vem task spec <id>` Options

| Option | Description |
|---|---|
| `--set <criteria...>` | Set acceptance criteria; each criterion is a separate argument (e.g. `--set "Tests pass" "Docs updated"`). Replaces all existing criteria. |
| `--add <criterion>` | Add a single acceptance criterion |
| `--clear` | Remove all acceptance criteria |

### `vem task unblock <id>` Options

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reason for unblocking the task |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task delete` Options

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reasoning for deletion |

### `vem task update <id>` Options

| Option | Description |
|---|---|
| `--cycle <id>` | Assign task to a cycle (e.g. `CYCLE-001`) |
| `--tags <tags>` | Comma-separated tags |
| `--type <type>` | Task type: `feature`, `bug`, `chore`, `spike`, `enabler` |
| `--estimate-hours <hours>` | Estimated hours (e.g. `2.5`) |
| `--depends-on <ids>` | Comma-separated task IDs this task depends on |
| `--blocked-by <ids>` | Comma-separated task IDs blocking this task |
| `--recurrence <rule>` | Recurrence rule: `weekly`, `monthly`, or a cron expression |
| `--due-at <iso>` | Due date as ISO string (e.g. `2025-06-01`) |
| `--validation <steps>` | Comma-separated validation steps (empty string to clear) |
| `--impact-score <score>` | Impact score 0–100 (RICE-based priority) |
| `--parent <id>` | Parent task ID (for subtasks) |
| `--order <number>` | Subtask display order |
| `--owner <id>` | Owner user ID |
| `--reviewer <id>` | Reviewer user ID |
| `--actor <name>` | Actor name recorded in the audit log |
| `-r, --reasoning <text>` | Reasoning for the update |

> **Note:** `title`, `priority`, and `description` cannot be changed via this command. Use the web dashboard to update these fields.

```bash
# Assign a task to a cycle
vem task update TASK-042 --cycle CYCLE-001

# Set tags, type, and an estimate
vem task update TASK-042 --tags "backend,auth" --type feature --estimate-hours 4

# Mark dependencies and set a due date
vem task update TASK-042 --depends-on TASK-010,TASK-011 --due-at 2025-06-15
```

### `vem task iterate <id>` Options

Starts an iterative agent run on a task that already has a PR. The agent continues from the existing PR branch and a new PR is opened with cumulative changes.

| Option | Description |
|---|---|
| `-p, --prompt <text>` | Follow-up instructions for the agent |
| `--run-id <runId>` | UUID of the specific run to iterate from (defaults to the latest run with a PR) |
| `--agent <name>` | Agent to use: `copilot` (default), `claude`, `gemini`, or `codex` |
| `--cloud` | Dispatch as a cloud run (`sandbox_job`) — requires Ultra plan |

### `vem task context <id>` Options

| Option | Description |
|---|---|
| `--set <text>` | Replace task context |
| `--append <text>` | Append to task context |
| `--clear` | Clear task context |

## Cycle Management

Cycles are fixed-time project scopes (like sprints or Shape Up cycles).

```bash
vem cycle list                                                      # List all cycles
vem cycle create <name> --goal <text> [--appetite small|medium|large] [--start-at <iso>]  # Create a new cycle (both <name> and --goal are required and enforced by the CLI argument parser)
vem cycle start <id>                                                # Start a planned cycle
vem cycle close <id>                 # Close an active cycle
vem cycle focus [id]                 # Show focused view: active cycle goal + its tasks (defaults to active cycle)
vem cycle validate <id>              # Validate cycle criteria and run sensors
vem cycle health [id]                # Show health metrics for a cycle
vem cycle retrospective <id>         # Generate a cycle retrospective report
```

### `vem cycle create` Options

| Option | Description |
|---|---|
| `--goal <text>` | (Required) Goal statement for the cycle |
| `--appetite <size>` | Time budget: `small`, `medium`, or `large` |
| `--start-at <iso>` | Start date as ISO string (e.g. `2025-06-01`) |

### `vem cycle close` Options

| Option | Description |
|---|---|
| `--strict` | Abort the close if pre-flight validation fails |
| `--force` | Skip pre-flight validation and close immediately (dangerous escape hatch — use with care) |

### `vem cycle validate` Options

| Option | Description |
|---|---|
| `--skip-sensors` | Skip feedback sensor checks |
| `--skip-ai` | Skip Phase 2 AI review (pre-flight only) |
| `--backend <cloud\|local>` | Execution backend for AI review; defaults to the value in cycle config |
| `--strict` | Exit with a non-zero error code if any check fails or warns |

## Plan Management

Plans are AI-generated task breakdowns for achieving a goal.

```bash
vem plan list                        # List all plans
vem plan list --status <status>      # Filter by status: pending|approved|rejected|done
vem plan list --json                 # Output as JSON
vem plan get <plan-id>               # Show details of a specific plan
vem plan get <plan-id> --json        # Output as JSON
vem plan create --title "My plan title" [--body <text>] [--file <path>]  # Create a new plan (--title is required)
vem plan run-tasks <plan-id>         # Execute queued tasks for a plan
vem plan cancel-tasks <plan-id>      # Cancel running tasks for a plan
```

### `vem plan create` Options

| Option | Description |
|---|---|
| `--title <title>` | **(Required)** Plan title |
| `--body <text>` | Plan body / description |
| `--file <path>` | Read plan body from a file |

### `vem plan run-tasks <plan-id>` Options

| Option | Description |
|---|---|
| `--backend <backend>` | Execution backend: `local_sandbox` (default), `local_runner`, or `sandbox_job` |
| `--yes` | Skip confirmation prompt |

### `vem plan cancel-tasks <plan-id>` Options

| Option | Description |
|---|---|
| `--delete-branch` | Also delete the shared GitHub PR branch |
| `--yes` | Skip confirmation prompt |

## Instructions

Manage agent instruction sets (`.vem/instructions/`). `vem instr` is a short alias for `vem instructions`.

```bash
vem instructions pull                # Pull instructions from the cloud
vem instructions pull --force        # Overwrite local files without prompting
vem instructions push                # Push local instructions to the cloud
vem instructions push -m <msg>       # Push with a custom commit message for the version
vem instructions status              # Compare local vs cloud instructions
vem instructions versions            # List instruction version history
vem instructions versions -n <n>     # Limit to n versions (default: 20)
vem instructions revert <versionId>  # Revert instructions to a previous version
```

### `vem instructions pull` Options

| Option | Description |
|---|---|
| `-f, --force` | Overwrite local files without prompting |

### `vem instructions push` Options

| Option | Description |
|---|---|
| `-m, --message <msg>` | Commit message for this version |

### `vem instructions versions` Options

| Option | Description |
|---|---|
| `-n, --limit <n>` | Maximum number of versions to show (default: 20) |

## Constitution

Manage the Agent Constitution — immutable principles for all AI agents in the project.

```bash
vem constitution show                # Show the project constitution
vem constitution init                # Initialize a constitution file
vem constitution edit                # Edit the constitution in $EDITOR
vem constitution set                 # Set the constitution from stdin
vem constitution set --file <path>   # Set the constitution from a file
```

### `vem constitution set` Options

| Option | Description |
|---|---|
| `--file <path>` | Read constitution from a file instead of stdin |

## Skills

Manage agent skills installed for this project (via `skills-lock.json`).

```bash
vem skills add <source>              # Install skills from a GitHub source (e.g. owner/skills)
vem skills add <source> --no-push    # Install without prompting to push to vem cloud
vem skills list                      # List installed skills
vem skills remove <skill>            # Remove an installed skill
vem skills remove <skill> --no-push  # Remove without prompting to push
vem skills update [source]           # Update all skills or a specific source
vem skills update [source] --no-push # Update without prompting to push
vem skills push                      # Push local skills to the vem cloud
vem skills push -m <msg>             # Push with a custom commit message for the version
vem skills pull                      # Pull skills from the vem cloud
vem skills pull --force              # Overwrite local files without prompting
vem skills status                    # Compare local skills with the cloud snapshot
vem skills versions                  # List skills version history from the cloud
vem skills versions -n <n>           # Limit to n versions (default: 20)
vem skills verify                    # Verify installed skills integrity
vem skills verify --fix              # Update checksums after manual review
```

### `vem skills add/remove/update` Options

| Option | Description |
|---|---|
| `--no-push` | Skip the prompt to push skills to vem cloud after the operation |

### `vem skills push` Options

| Option | Description |
|---|---|
| `-m, --message <msg>` | Commit message for this version |

### `vem skills pull` Options

| Option | Description |
|---|---|
| `-f, --force` | Overwrite local files without prompting |

### `vem skills versions` Options

| Option | Description |
|---|---|
| `-n, --limit <n>` | Maximum number of versions to show (default: 20) |

## Sensors

Sensors are custom health checks that run during cycle validation.

```bash
vem sensors list                     # List configured sensors
vem sensors add <name> --cmd <command>  # Add a new sensor (--cmd is required)
vem sensors remove <name>            # Remove a sensor
vem sensors run [name]               # Run all sensors or a specific one
```

### `vem sensors add` Options

| Option | Description |
|---|---|
| `--cmd <command>` | **(Required)** Shell command to run as the sensor check |
| `--description <text>` | Human-readable description of the sensor |

## Sessions

Browse and import Copilot CLI agent sessions stored in the cloud.

```bash
vem sessions list                    # List agent sessions for this project (default: last 20)
vem sessions list -n <number>        # Limit number of sessions shown (e.g. -n 50)
vem sessions list -b <branch>        # Filter sessions by branch name
vem sessions list --all              # Show sessions from all repositories
vem sessions import <id>             # Import a session into local memory
```

### `vem sessions list` Options

| Option | Description |
|---|---|
| `-n, --limit <number>` | Number of sessions to show (default: 20) |
| `-b, --branch <branch>` | Filter sessions by branch name |
| `--all` | Show sessions from all repositories (not just the current repo) |
| `--source <sources>` | Comma-separated sources to include: `copilot`, `claude`, `gemini`. Only these three agents produce local session files; `codex`, `cursor`, and `code` do not store local sessions. |

## Project

```bash
vem project open [projectId]         # Open the VEM web app on the project page
```

## Maintenance

### Context and Decisions

```bash
vem context show                     # Show project context and current state
vem context set --current-state "..." # Update current state
vem context set --context "..."       # Update full CONTEXT.md content
vem decision add "Title" --context "Why" --decision "What was decided" --tasks TASK-001,TASK-002
```

### `vem decision add` Options

| Option | Description |
|---|---|
| `--context <text>` | **(Required)** Context explaining why the decision was made |
| `--decision <text>` | **(Required)** The decision that was made |
| `--tasks <ids>` | Comma-separated task IDs related to this decision |

### Sync

```bash
vem push                             # Push local memory to cloud
vem push --dry-run                   # Preview what would be pushed without actually pushing
vem push --force                     # Push even if no changes detected
vem pull                             # Pull latest cloud snapshot
vem pull --force                     # Overwrite local changes without warning
vem diff                             # Show local vs cloud differences
vem diff --detailed                  # Show detailed content diffs
vem diff --json                      # Output as JSON
vem summarize                        # AI-suggested memory updates based on git diff
vem summarize --staged               # Analyze only staged changes
vem queue                            # List offline snapshot queue
vem queue --retry                    # Retry pushing all queued snapshots
vem queue --clear                    # Clear the offline queue
vem archive                          # Archive old memory files (decisions, changelog, tasks)
vem archive --all                    # Archive decisions, changelog, and tasks in one pass
vem archive --decisions              # Archive decisions only
vem archive --changelog              # Archive changelog only
vem archive --tasks                  # Archive completed tasks only
vem archive --older-than 60          # Archive items older than 60 days
vem archive --keep 10                # Keep at least 10 recent items
```

### `vem push` Options

| Option | Description |
|---|---|
| `--dry-run` | Preview what would be pushed without actually pushing |
| `--force` | Push even if no changes detected |

### `vem pull` Options

| Option | Description |
|---|---|
| `-f, --force` | Overwrite local changes without warning |

### `vem diff` Options

> **Note:** `vem diff` works without running `vem init` first — it can be used on any directory to compare local files against the cloud state.

| Option | Description |
|---|---|
| `--detailed` | Show detailed content diffs |
| `--json` | Output as JSON |

### `vem summarize` Options

| Option | Description |
|---|---|
| `--staged` | Analyze only staged changes |

### Validation Rules

```bash
vem validation show                  # Display current validation rules
vem validation edit                  # Edit validation rules in $EDITOR
```

### Architecture Drift

```bash
vem drift check                      # Check for architecture drift against ADR enforcement patterns
vem drift check --since <ref>        # Check drift from a specific git ref or ISO date
```

## Review

Used by AI agents inside cloud sandboxes to submit cycle validation reviews.

> **Note:** `vem review submit` is only functional inside a provisioned cloud sandbox container.
> The following environment variables must be set before invoking the command:
>
> | Variable | Description |
> |---|---|
> | `VEM_TASK_RUN_ID` | The sandbox run ID (required) |
> | `VEM_API_KEY` | Sandbox API key (required) |
> | `VEM_API_URL` | API base URL (optional; only needed when self-hosting or developing locally) |

```bash
vem review submit -f <path>          # Submit a vem_review JSON block from a file
vem review submit --file <path>      # Submit a vem_review JSON block from a file
cat review.json | vem review submit  # Submit a vem_review JSON block from stdin
```

## Runner

Runs a paired worker that executes queued web task runs. Intended for CI/CD or local background workers.

> **Prerequisites:** The repository must be initialised with `vem init` and linked to a VEM project with `vem link` before starting the runner. Without these steps the runner will fail immediately because it requires `.vem/config.json` to look up the project ID.

```bash
vem runner                           # Start the runner (polls for queued tasks)
vem runner --once                    # Claim at most one run and exit
vem runner --poll-interval <seconds> # Set polling interval (default: 3s, minimum: 2s)
vem runner --agent <name>            # Agent to use (default: copilot)
vem runner --unsafe                  # Disable Docker sandbox — runs agent directly on host with NO isolation
```

### Runner `--agent` Values

| Agent | Credential Required |
|---|---|
| `copilot` (default) | `GITHUB_TOKEN` or `GH_TOKEN` |
| `claude` | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini` CLI tool installed and authenticated |
| `codex` | `OPENAI_API_KEY` |

> **Note:** `cursor` and `code` (IDE-based agents) are **not supported** in headless runner mode. They require a running desktop environment and cannot operate inside Docker-sandboxed runner sessions.

For `vem task iterate --agent`, only `copilot`, `claude`, `gemini`, and `codex` are supported. `cursor` and `code` are interactive-only and apply exclusively to `vem agent`.

> **Security note:** `--unsafe` removes all container sandboxing. The agent process runs directly on the host with full filesystem and network access. Only use this flag in trusted, isolated environments where Docker is unavailable. In CI or on shared machines, omit `--unsafe` to keep the default Docker sandbox isolation.

### Runner `.env` Auto-loading

If a `.env` file exists in the current working directory, `vem runner` loads it automatically at startup. You can place `VEM_API_KEY`, agent credentials (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.), and other runner variables (e.g. `VEM_RUNNER_VERBOSE`) there without exporting them in your shell.

## Typical Workflows

### Task Management

```bash
vem task add "Implement GitHub App webhook retries" --priority high --type feature
vem task list
vem task update TASK-001 --cycle CYCLE-001 --tags "backend" --estimate-hours 3
vem task start TASK-001 --reasoning "Starting implementation"
vem task done TASK-001 --evidence "pnpm test" --reasoning "Tests passed and behavior validated"
```

### Context And Decisions

```bash
vem context show
vem context set --current-state "Webhook retries implemented and deployed to staging."
vem decision add "Use exponential backoff for webhook retries" --context "Temporary provider outages" --decision "Retry with capped exponential backoff"
```

### Sync And Search

```bash
vem push
vem pull
vem diff
vem search "webhook retries"
vem ask "What changed in task handling this week?"
vem ask "What changed in task handling this week?" --path src/webhooks
```

### `vem ask` Options

| Option | Description |
|---|---|
| `-p, --path <path>` | Limit results to a file path or directory |

### Agent-Assisted Workflow

```bash
vem pack                             # Bundle local memory into a context pack
vem pack --full                      # Include full snapshot content (default is compact)
vem pack --json                      # Output raw JSON instead of a fenced block
vem agent claude --task TASK-001
vem agent claude --task TASK-001 --no-strict-memory   # Disable strict memory enforcement after agent runs
vem agent claude --task TASK-001 --auto-exit          # Automatically exit after agent finishes, skipping post-run prompts
vem finalize --file ./agent-response.md
```

> **Sandbox mode:** When `VEM_TASK_RUN_ID` and `VEM_API_KEY` are set, `vem finalize` skips local file writes and submits the update directly to the VEM API. This is the mode used inside cloud sandbox agent runs.

> **Note:** Omitting the agent name (e.g. `vem agent --task TASK-001`) triggers an interactive selection prompt listing the AI agents detected on your system. This prompt is not available in non-interactive / scripted environments — always specify an agent name explicitly in CI or automation.

### `vem agent [command] [args...]` Options

| Option | Description |
|---|---|
| `-t, --task <taskId>` | Task to work on (e.g. `TASK-001`) |
| `--no-strict-memory` | Disable strict memory enforcement after agent runs |
| `--auto-exit` | Automatically exit after agent finishes, skipping post-run prompts |

### `vem agent` Agent Values

| Agent | Prerequisite |
|---|---|
| `copilot` | `GITHUB_TOKEN` or `GH_TOKEN` |
| `claude` | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini` CLI tool installed and authenticated |
| `codex` | `OPENAI_API_KEY` |
| `cursor` | Cursor IDE installed (`cursor` CLI available in `PATH`) |
| `code` | VS Code installed (`code` CLI available in `PATH`) |

## Troubleshooting

```bash
vem doctor              # Run health checks on VEM setup
vem doctor --json       # Output health check results as JSON (for automation scripts)
vem status
vem insights            # Show usage metrics and workflow insights
vem insights --json     # Output metrics as JSON
```

### `vem doctor` Exit Codes

| Exit Code | Meaning |
|---|---|
| `0` | All checks passed — environment is healthy |
| `1` | One or more warnings (non-fatal; safe to continue, but worth investigating) |
| `2` | One or more failures (blocking; environment is misconfigured or missing required dependencies) |

CI pipelines can branch on severity: treat exit 1 as advisory and exit 2 as a hard stop.

## Environment Variables

These variables are read by the CLI and runner. Most are optional; they allow operators and CI/CD environments to configure behaviour without passing flags on every invocation.

| Variable | Description |
|---|---|
| `VEM_API_KEY` | Authentication key for the vem API. Acts as a fallback for all authenticated CLI commands (overrides the stored login key). Also required for `vem review submit` inside sandbox containers. |
| `VEM_API_URL` | Override the vem API base URL. Only needed when self-hosting or developing locally. Production builds embed the correct URL automatically. |
| `VEM_APP_URL` | Override the vem web app base URL |
| `VEM_TASK_RUN_ID` | Sandbox run ID (required for `vem review submit`) |
| `VEM_ACTIVE_TASK` | Active task ID for agent session heartbeat tracking |
| `VEM_CLI_SENTRY_DSN` | Sentry DSN for CLI error reporting; leave unset to disable error monitoring |
| `VEM_RUNNER_VERBOSE` | Set to `1` to enable verbose runner output |
| `VEM_DEBUG` | Set to `1` to enable agent debug logging |
| `VEM_STRICT_MEMORY` | Set to `0` to disable strict memory enforcement after agent runs. When enabled (the default), the agent is required to produce a `vem_update` block with updated context and task evidence; omitting it causes the run to fail with an error. |
| `VEM_RUNNER_INSTRUCTIONS` | Extra instructions injected into the runner agent prompt |
| `VEM_RUN_MODE` | Run mode selection: `implement` (default) — run the normal coding agent; `review` — switch to a code-review-only prompt; `plan_creation` — generate a structured task plan and disable strict memory enforcement. Set automatically by `vem runner` from the task run record — rarely needs to be set manually. |
| `SANDBOX_AGENT_TIMEOUT_SECONDS` | Timeout in seconds for sandboxed agent execution |
| `VEM_ACTOR` | Actor name recorded in audit logs |
| `VEM_AGENT_NAME` | Agent session tracking name |
| `VEM_AGENT` | Agent identifier used inside the sandbox |
| `VEM_CHILD_TASK_IDS` | Comma-separated child task IDs (set automatically during nested runs) |
| `GIT_AUTHOR_NAME` | Git author name passed into Docker sandbox git config |
| `GIT_AUTHOR_EMAIL` | Git author email passed into Docker sandbox git config |
| `GITHUB_TOKEN` / `GH_TOKEN` | Required by the `copilot` agent for `vem agent` and `vem runner`. Either variable is accepted; `GH_TOKEN` is used as a fallback. |
| `ANTHROPIC_API_KEY` | Required by the `claude` agent for `vem agent` and `vem runner`. |
| `OPENAI_API_KEY` | Required by the `codex` agent for `vem agent` and `vem runner`. |

## License

MIT License.

In plain terms:
- You can use, modify, and distribute this software, including commercially.
- You must keep the copyright and license notice.
- The software is provided "as is" without warranty.
