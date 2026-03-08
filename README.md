[<img src="https://cdn.jsdelivr.net/npm/@vemdev/cli@latest/logo.png" alt="vem logo" width="32" />](https://vem.dev)
[**v&nbsp;e&nbsp;m**](https://vem.dev)

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
- `vem login [key]` Authenticate with your VEM API key
- `vem link [projectId]` Link this repository to a VEM project
- `vem status` Show current memory and sync status
- `vem push` Push local memory snapshot to cloud
- `vem pull` Pull latest cloud snapshot to local files
- `vem task ...` Manage tasks
- `vem decision add ...` Record an architectural decision
- `vem context show|set` Read or update project context
- `vem search <query>` Search memory
- `vem ask <question>` Ask questions over project memory
- `vem doctor` Run setup and health checks
- `vem logout` Clear local authentication

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
