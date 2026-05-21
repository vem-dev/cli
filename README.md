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
vem task start TASK-001 --reasoning "Starting implementation"
vem task done TASK-001 --evidence "pnpm test" --reasoning "Tests passed and behavior validated"
vem task update TASK-001 --status in-review
vem task block TASK-001 --reason "Waiting on API design"
vem task unblock TASK-001
vem task delete TASK-001
vem task details [id]           # Show full task details
vem task subtasks [id]          # Show parent task and its subtasks
vem task context <id>           # View or update task context
vem task assign <id> [assignee] # Assign a task to a user
vem task sessions <id>          # Show all agent sessions attached to a task
vem task flow [id]              # Show task flow and dependencies
vem task score [id]             # Show or set the impact score (0-100)
vem task ready [id]             # Mark a task as ready (refined and ready to start)
vem task iterate <id>           # Iterate on a task
vem task spec <id>              # View or set acceptance criteria
```

## Cycle Management

Cycles are fixed-time project scopes (like sprints or Shape Up cycles).

```bash
vem cycle list                       # List all cycles
vem cycle create [name]              # Create a new cycle (interactive when name is omitted)
vem cycle start <id>                 # Start a planned cycle
vem cycle close <id>                 # Close an active cycle
vem cycle focus [id]                 # Focus on a cycle (set as current)
vem cycle validate <id>              # Validate cycle criteria and run sensors
vem cycle health [id]                # Show health metrics for a cycle
vem cycle retrospective <id>         # Generate a cycle retrospective report
```

## Plan Management

Plans are AI-generated task breakdowns for achieving a goal.

```bash
vem plan list                        # List all plans
vem plan get <plan-id>               # Show details of a specific plan
vem plan create                      # Create a new plan interactively
vem plan run-tasks <plan-id>         # Execute queued tasks for a plan
vem plan cancel-tasks <plan-id>      # Cancel running tasks for a plan
```

## Instructions

Manage agent instruction sets (`.vem/instructions/`) and the project constitution.

```bash
vem instructions pull                # Pull instructions from the cloud
vem instructions push                # Push local instructions to the cloud
vem instructions status              # Compare local vs cloud instructions
vem instructions versions            # List instruction version history
vem instructions revert <versionId>  # Revert instructions to a previous version

vem instructions constitution show   # Show the project constitution
vem instructions constitution init   # Initialize a constitution file
vem instructions constitution edit   # Edit the constitution in $EDITOR
vem instructions constitution set    # Set the constitution from stdin or --file
```

## Skills

Manage agent skills installed for this project (via `skills-lock.json`).

```bash
vem skills add <source>              # Install skills from a GitHub source (e.g. owner/skills)
vem skills list                      # List installed skills
vem skills remove <skill>            # Remove an installed skill
vem skills update [source]           # Update all skills or a specific source
vem skills push                      # Push local skills to the vem cloud
vem skills pull                      # Pull skills from the vem cloud
vem skills status                    # Compare local skills with the cloud snapshot
vem skills versions                  # List skills version history from the cloud
vem skills verify                    # Verify installed skills integrity
```

## Sensors

Sensors are custom health checks that run during cycle validation.

```bash
vem sensors list                     # List configured sensors
vem sensors add <name>               # Add a new sensor
vem sensors remove <name>            # Remove a sensor
vem sensors run [name]               # Run all sensors or a specific one
```

## Sessions

Browse and import Copilot CLI agent sessions stored in the cloud.

```bash
vem sessions list                    # List agent sessions for this project
vem sessions import <id>             # Import a session into local memory
```

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

```bash
vem review submit --file <path>      # Submit a vem_review JSON block from a file
cat review.json | vem review submit  # Submit a vem_review JSON block from stdin
```

## Runner

Runs a paired worker that executes queued web task runs. Intended for CI/CD or local background workers.

```bash
vem runner                           # Start the runner (polls for queued tasks)
vem runner --once                    # Claim at most one run and exit
vem runner --poll-interval <seconds> # Set polling interval (default: 3s)
```

## Typical Workflows

### Task Management

```bash
vem task add "Implement GitHub App webhook retries" --priority high --type feature
vem task list
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
vem finalize --file ./agent-response.md
```

## Troubleshooting

```bash
vem doctor
vem status
```

## License

MIT License.

In plain terms:
- You can use, modify, and distribute this software, including commercially.
- You must keep the copyright and license notice.
- The software is provided "as is" without warranty.
