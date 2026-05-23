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
- `vem link [projectId]` Link this repository to a VEM project
- `vem unlink` Unlink this repository from a VEM project
- `vem status` Show current project status
- `vem insights` Show detailed usage metrics and workflow insights
- `vem push` Push local memory snapshot to cloud
- `vem pull` Pull latest cloud snapshot to local files
- `vem diff` Show differences between local and cloud state
- `vem pack` Bundle local memory into a context pack
- `vem finalize --file <path>` Apply a `vem_update` block from a file or stdin
- `vem task ...` Manage tasks (see [Task Management](#task-management))
- `vem decision add ...` Record an architectural decision
- `vem context show|set` Read or update project context
- `vem search <query>` Search memory
- `vem ask <question>` Ask questions over project memory
- `vem summarize` Analyze current git changes and suggest VEM memory updates
- `vem doctor` Run health checks on VEM setup
- `vem agent [command]` Run an AI agent session

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
vem task flow [id]              # Show task flow and dependencies
vem task score [id]             # Show or set the impact score (0-100)
vem task ready [id]             # Mark a task as ready (refined and ready to start)
vem task iterate <id>           # Iterate on a task that already has a PR
vem task spec <id>              # View or set acceptance criteria
vem task update <id> [options]  # Update task metadata (see options below)
```

### `vem task add` Options

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
| `--all` | Include completed tasks |
| `--deleted` | Show only deleted tasks |
| `--status <status>` | Filter by status: `todo`, `ready`, `in-review`, `in-progress`, `blocked`, `done` |
| `--done` | Show only completed tasks (alias for `--status done`) |
| `--cycle <id>` | Filter by cycle ID (e.g. `CYCLE-001`) |
| `--flow` | Show flow metrics column (cycle time) |

### `vem task start [id]` Options

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reasoning for starting the task |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task ready [id]` Options

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reasoning for marking the task ready |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task done [id]` Options

| Option | Description |
|---|---|
| `-e, --evidence <evidence>` | Evidence for completion (file path or command); comma-separated for multiple entries |
| `-r, --reasoning <text>` | Reasoning for completion |
| `--validation <steps>` | Comma-separated validation steps completed (required when the task has validation steps defined) |
| `--actor <name>` | Actor name recorded in the audit log |
| `--context-summary <summary>` | Summary of the task context to preserve after completion |

### `vem task block <id>` Options

| Option | Description |
|---|---|
| `-r, --reasoning <text>` | Reason for blocking the task |
| `--blocked-by <ids>` | Comma-separated task IDs that are blocking this task |
| `--actor <name>` | Actor name recorded in the audit log |

### `vem task score [id]` Options

| Option | Description |
|---|---|
| `--set <score>` | Set impact score manually (0–100) |
| `-r, --reasoning <text>` | Reasoning for the score change |

### `vem task spec <id>` Options

| Option | Description |
|---|---|
| `--set <criteria...>` | Set acceptance criteria (replaces all existing criteria) |
| `--add <criterion>` | Add a single acceptance criterion |
| `--clear` | Remove all acceptance criteria |

### `vem task unblock` Options

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

```bash
# Assign a task to a cycle
vem task update TASK-042 --cycle CYCLE-001

# Set tags, type, and an estimate
vem task update TASK-042 --tags "backend,auth" --type feature --estimate-hours 4

# Mark dependencies and set a due date
vem task update TASK-042 --depends-on TASK-010,TASK-011 --due-at 2025-06-15
```

### `vem task iterate <id>` Options

Continues work on a task that already has an open PR by pushing additional commits to the existing PR branch.

| Option | Description |
|---|---|
| `-p, --prompt <text>` | Follow-up instructions for the agent |
| `--run-id <runId>` | UUID of the specific run to iterate from (defaults to the latest run with a PR) |
| `--agent <name>` | Agent to use: `copilot` (default), `claude`, `gemini`, or `codex` |
| `--cloud` | Dispatch as a cloud run (`sandbox_job`) — requires Ultra plan |

## Cycle Management

Cycles are fixed-time project scopes (like sprints or Shape Up cycles).

```bash
vem cycle list                                                      # List all cycles
vem cycle create <name> --goal <text> [--appetite small|medium|large] [--start-at <iso>]  # Create a new cycle
vem cycle start <id>                                                # Start a planned cycle
vem cycle close <id>                 # Close an active cycle
vem cycle focus [id]                 # Focus on a cycle (set as current)
vem cycle validate <id>              # Validate cycle criteria and run sensors
vem cycle health [id]                # Show health metrics for a cycle
vem cycle retrospective <id>         # Generate a cycle retrospective report
```

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
vem plan create --title "My plan title" [--body <text>] [--file <path>]  # Create a new plan
vem plan run-tasks <plan-id>         # Execute queued tasks for a plan
vem plan cancel-tasks <plan-id>      # Cancel running tasks for a plan
```

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

Manage agent instruction sets (`.vem/instructions/`) and the project constitution.

```bash
vem instructions pull                # Pull instructions from the cloud
vem instructions pull --force        # Overwrite local files without prompting
vem instructions push                # Push local instructions to the cloud
vem instructions push -m <msg>       # Push with a custom commit message for the version
vem instructions status              # Compare local vs cloud instructions
vem instructions versions            # List instruction version history
vem instructions versions -n <n>     # Limit to n versions (default: 20)
vem instructions revert <versionId>  # Revert instructions to a previous version

vem instructions constitution show   # Show the project constitution
vem instructions constitution init   # Initialize a constitution file
vem instructions constitution edit   # Edit the constitution in $EDITOR
vem instructions constitution set    # Set the constitution from stdin or --file
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
vem decision add "Title" --context "Why" --decision "What was decided"
```

### Sync

```bash
vem push                             # Push local memory to cloud
vem push --dry-run                   # Preview what would be pushed without actually pushing
vem push --force                     # Push even if no changes detected
vem pull                             # Pull latest cloud snapshot
vem diff                             # Show local vs cloud differences
vem summarize                        # AI-suggested memory updates based on git diff
vem queue                            # List offline snapshot queue
vem queue --retry                    # Retry pushing all queued snapshots
vem queue --clear                    # Clear the offline queue
vem archive                          # Archive old memory files (decisions, changelog, tasks)
vem archive --decisions              # Archive decisions only
vem archive --changelog              # Archive changelog only
vem archive --tasks                  # Archive completed tasks only
vem archive --older-than 60          # Archive items older than 60 days
vem archive --keep 10                # Keep at least 10 recent items
```

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
vem review submit --file <path>      # Submit a vem_review JSON block from a file
cat review.json | vem review submit  # Submit a vem_review JSON block from stdin
```

## Runner

Runs a paired worker that executes queued web task runs. Intended for CI/CD or local background workers.

> **Prerequisites:** The repository must be initialised with `vem init` and linked to a VEM project with `vem link` before starting the runner. Without these steps the runner will fail immediately because it requires `.vem/config.json` to look up the project ID.

```bash
vem runner                           # Start the runner (polls for queued tasks)
vem runner --once                    # Claim at most one run and exit
vem runner --poll-interval <seconds> # Set polling interval (default: 3s)
vem runner --agent <name>            # Agent to use (default: copilot)
vem runner --unsafe                  # Disable Docker sandbox — runs agent directly on host with NO isolation
```

### Runner `--agent` Values

| Agent | Credential Required |
|---|---|
| `copilot` (default) | `GITHUB_TOKEN` or `GH_TOKEN` |
| `gh` | `GITHUB_TOKEN` or `GH_TOKEN` |
| `claude` | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini` CLI tool installed and authenticated |
| `codex` | `OPENAI_API_KEY` |

The same agent values and credential requirements apply to `vem task iterate --agent`.

> **Security note:** `--unsafe` removes all container sandboxing. The agent process runs directly on the host with full filesystem and network access. Only use this flag in trusted, isolated environments where Docker is unavailable. In CI or on shared machines, omit `--unsafe` to keep the default Docker sandbox isolation.

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
```

### Agent-Assisted Workflow

```bash
vem pack
vem agent --task TASK-001
vem agent --task TASK-001 --no-strict-memory   # Disable strict memory enforcement after agent runs
vem agent --task TASK-001 --auto-exit          # Automatically exit after agent finishes, skipping post-run prompts
vem finalize --file ./agent-response.md
```

## Troubleshooting

```bash
vem doctor              # Run health checks on VEM setup
vem doctor --json       # Output health check results as JSON (for automation scripts)
vem status
vem insights            # Show usage metrics and workflow insights
vem insights --json     # Output metrics as JSON
```

## Environment Variables

These variables are read by the CLI and runner. Most are optional; they allow operators and CI/CD environments to configure behaviour without passing flags on every invocation.

| Variable | Description |
|---|---|
| `VEM_API_KEY` | Authentication key for the vem API (used by `vem review submit`) |
| `VEM_API_URL` | Override the vem API base URL. Only needed when self-hosting or developing locally. Production builds embed the correct URL automatically. |
| `VEM_APP_URL` | Override the vem web app base URL |
| `VEM_TASK_RUN_ID` | Sandbox run ID (required for `vem review submit`) |
| `VEM_ACTIVE_TASK` | Active task ID for agent session heartbeat tracking |
| `VEM_CLI_SENTRY_DSN` | Sentry DSN for CLI error reporting; leave unset to disable error monitoring |
| `VEM_RUNNER_VERBOSE` | Set to `1` to enable verbose runner output |
| `VEM_DEBUG` | Set to `1` to enable agent debug logging |
| `VEM_STRICT_MEMORY` | Set to `0` to disable strict memory enforcement after agent runs |
| `VEM_RUNNER_INSTRUCTIONS` | Extra instructions injected into the runner agent prompt |
| `VEM_RUN_MODE` | Run mode selection (`implement`, `review`, `plan_creation`) |
| `SANDBOX_AGENT_TIMEOUT_SECONDS` | Timeout in seconds for sandboxed agent execution |
| `VEM_ACTOR` | Actor name recorded in audit logs |
| `VEM_AGENT_NAME` | Agent session tracking name |
| `VEM_AGENT` | Agent identifier used inside the sandbox |
| `VEM_CHILD_TASK_IDS` | Comma-separated child task IDs (set automatically during nested runs) |
| `GIT_AUTHOR_NAME` | Git author name passed into Docker sandbox git config |
| `GIT_AUTHOR_EMAIL` | Git author email passed into Docker sandbox git config |

## License

MIT License.

In plain terms:
- You can use, modify, and distribute this software, including commercially.
- You must keep the copyright and license notice.
- The software is provided "as is" without warranty.
