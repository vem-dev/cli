#!/usr/bin/env node
import {
  CHANGELOG_DIR,
  CONTEXT_FILE,
  CURRENT_STATE_FILE,
  ConfigService,
  CycleService,
  DECISIONS_DIR,
  KNOWN_AGENT_INSTRUCTION_FILES,
  ScalableLogService,
  SyncService,
  TaskService,
  UsageMetricsService,
  WorkflowGuideService,
  applyVemUpdate,
  computeSessionStats,
  computeSnapshotHash,
  ensureVemDir,
  ensureVemFiles,
  formatVemPack,
  getRepoRoot,
  getVemDir,
  isVemInitialized,
  listAllAgentSessions,
  parseVemUpdateBlock
} from "./chunk-SOAUDPRS.js";
import {
  readCopilotSessionDetail
} from "./chunk-PO3WNPAJ.js";
import "./chunk-PMUCN3Y6.js";
import "./chunk-VL6CJCOB.js";
import "./chunk-PZ5AY32C.js";

// src/index.ts
import chalk19 from "chalk";
import { Command } from "commander";

// src/commands/agent.ts
import { execSync as execSync2, spawn as spawn2 } from "child_process";
import { access, readFile as readFile4, unlink, writeFile as writeFile2 } from "fs/promises";
import { join as join5 } from "path";
import chalk7 from "chalk";
import prompts4 from "prompts";

// src/runtime/auth.ts
import { spawn } from "child_process";
import chalk from "chalk";
var API_URL = "https://api.vem.dev";
var WEB_URL = "https://app.vem.dev";
function getApiUrlCandidates(apiUrl) {
  const candidates = [apiUrl];
  try {
    const url = new URL(apiUrl);
    if (url.hostname === "localhost") {
      candidates.push(apiUrl.replace("localhost", "127.0.0.1"));
      candidates.push(apiUrl.replace("localhost", "[::1]"));
    }
  } catch {
  }
  return Array.from(new Set(candidates));
}
async function buildDeviceHeaders(configService, options) {
  const { deviceId, deviceName } = await configService.getOrCreateDeviceId();
  const includeOrgContext = options?.includeOrgContext ?? true;
  const projectOrgId = includeOrgContext ? await configService.getProjectOrgId() : void 0;
  return {
    "X-Vem-Device-Id": deviceId,
    "X-Vem-Device-Name": deviceName,
    ...projectOrgId ? { "X-Org-Id": projectOrgId } : {}
  };
}
async function verifySession(apiUrl, apiKey, configService) {
  return fetch(`${apiUrl}/verify`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...await buildDeviceHeaders(configService, {
        includeOrgContext: false
      })
    }
  });
}
function openBrowser(url) {
  const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(start, [url]);
}
async function ensureAuthenticated(configService) {
  const apiKey = await configService.getApiKey();
  if (!apiKey) {
    console.error(chalk.red("\n\u2716 Not logged in. Run `vem login` first.\n"));
    process.exit(1);
  }
  try {
    let response = null;
    let lastError = null;
    for (const candidate of getApiUrlCandidates(API_URL)) {
      try {
        response = await verifySession(candidate, apiKey, configService);
        API_URL = candidate;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!response) throw lastError;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.error(
          chalk.red(
            "\n\u2716 Session expired or invalid. Run `vem login` to re-authenticate.\n"
          )
        );
        process.exit(1);
      }
      console.error(
        chalk.red(`
\u2716 Failed to verify session: ${response.statusText}
`)
      );
      process.exit(1);
    }
    return apiKey;
  } catch (err) {
    const message = err?.message ? String(err.message) : String(err);
    console.error(
      chalk.red(
        [
          "\n\u2716 Failed to reach API to verify session.",
          `   API: ${API_URL}`,
          `   Error: ${message}`,
          "   Fix: ensure the API is running and reachable, or set VEM_API_URL to the correct endpoint.",
          ""
        ].join("\n")
      )
    );
    process.exit(1);
  }
}
async function validateProject(projectId, apiKey, configService) {
  try {
    const res = await fetch(`${API_URL}/projects`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...await buildDeviceHeaders(configService)
      }
    });
    if (!res.ok) return { valid: false };
    const { projects } = await res.json();
    const found = projects.find((project) => project.id === projectId);
    return found ? { valid: true, name: found.name, orgId: found.org_id } : { valid: false };
  } catch {
    return { valid: true };
  }
}
async function tryAuthenticatedKey(configService) {
  const apiKey = await configService.getApiKey();
  if (!apiKey) return null;
  try {
    let response = null;
    for (const candidate of getApiUrlCandidates(API_URL)) {
      try {
        response = await verifySession(candidate, apiKey, configService);
        API_URL = candidate;
        break;
      } catch {
      }
    }
    if (!response || !response.ok) return null;
    return apiKey;
  } catch (_err) {
    return null;
  }
}

// src/runtime/git.ts
import { execSync } from "child_process";
import { createHash } from "crypto";
import { readdir, readFile, readlink } from "fs/promises";
import { join, relative } from "path";
import chalk2 from "chalk";
import prompts from "prompts";

// src/runtime/services.ts
var taskService = new TaskService();
var cycleService = new CycleService();
var syncService = new SyncService();
var metricsService = new UsageMetricsService();
var workflowGuide = new WorkflowGuideService(metricsService);
var TASK_CONTEXT_FILE = "task_context.md";
var parseCommaList = (value) => {
  if (value === void 0) return void 0;
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
};
var resolveActorName = (value) => {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  return process.env.VEM_AGENT_NAME || process.env.VEM_ACTOR || process.env.VEM_AGENT || void 0;
};

// src/runtime/git.ts
function getGitRemotes() {
  try {
    const output = execSync("git remote -v").toString().trim();
    const lines = output.split("\n");
    const remotes = /* @__PURE__ */ new Map();
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const url = parts[1];
        remotes.set(name, url);
      }
    }
    return Array.from(remotes.entries()).map(([name, url]) => ({
      name,
      url
    }));
  } catch (_e) {
    return [];
  }
}
function getPreferredRemote(remotes, preferredName = "origin") {
  if (remotes.length === 0) return null;
  return remotes.find((remote) => remote.name === preferredName) || remotes[0];
}
async function getGitRemoteSelection(options = {}) {
  try {
    const remotes = getGitRemotes();
    if (remotes.length === 0 && !options.forcePrompt) return null;
    if (remotes.length === 1 && !options.forcePrompt) return remotes[0];
    if (remotes.length > 1 && !options.forcePrompt && !options.promptOnMultiple) {
      return getPreferredRemote(
        remotes,
        options.preferredRemoteName || "origin"
      );
    }
    const choices = remotes.map((r) => ({
      title: `${r.name} (${r.url})`,
      value: r.name
    }));
    if (options.forcePrompt) {
      choices.push({
        title: chalk2.red("None / Unlink remote URL"),
        value: "REMOVE"
      });
    }
    if (choices.length === 0) return null;
    const response = await prompts({
      type: "select",
      name: "remoteName",
      message: options.forcePrompt ? "Select git remote to link or remove binding:" : "Multiple git remotes detected. Select one to link:",
      choices
    });
    const selectedRemoteName = response.remoteName;
    if (!selectedRemoteName) return null;
    if (selectedRemoteName === "REMOVE") return "REMOVE";
    return remotes.find((remote) => remote.name === selectedRemoteName) || null;
  } catch (_e) {
    return null;
  }
}
async function getGitRemote(options = {}) {
  const selection = await getGitRemoteSelection(options);
  if (selection === "REMOVE") return "REMOVE";
  return selection?.url || null;
}
function getGitHash() {
  try {
    const hash = execSync("git rev-parse HEAD").toString().trim();
    return hash || null;
  } catch (_e) {
    return null;
  }
}
async function computeVemHash() {
  try {
    const vemDir = await getVemDir();
    const hash = createHash("sha256");
    const walk = async (currentDir) => {
      const entries = await readdir(currentDir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name === "queue") {
          continue;
        }
        const fullPath = join(currentDir, entry.name);
        const relPath = relative(vemDir, fullPath).split("\\").join("/");
        if (relPath === "queue" || relPath.startsWith("queue/") || relPath === "config.json" || relPath === ".usage-metrics.json" || relPath === "exit_signal" || relPath === "current_context.md" || relPath === TASK_CONTEXT_FILE) {
          continue;
        }
        if (entry.isDirectory()) {
          hash.update(`dir:${relPath}\0`);
          await walk(fullPath);
        } else if (entry.isFile()) {
          hash.update(`file:${relPath}\0`);
          const data = await readFile(fullPath);
          hash.update(data);
        } else if (entry.isSymbolicLink()) {
          const target = await readlink(fullPath);
          hash.update(`link:${relPath}\0${target}\0`);
        }
      }
    };
    await walk(vemDir);
    return hash.digest("hex");
  } catch {
    return null;
  }
}
async function getCommits(limit = 20) {
  try {
    const output = execSync(
      `git log -n ${limit} --pretty=format:"%H|%an|%cI|%s"`
    ).toString();
    return output.split("\n").map((line) => {
      const [hash, author, date, ...msgParts] = line.split("|");
      return {
        hash,
        author_name: author,
        committed_at: date,
        message: msgParts.join("|")
      };
    }).filter((c) => c.hash && c.message);
  } catch (_e) {
    return [];
  }
}
async function isVemDirty(configService) {
  try {
    const currentHash = await computeVemHash();
    if (!currentHash) return false;
    const lastSyncedHash = await configService.getLastSyncedVemHash();
    if (!lastSyncedHash) return true;
    return currentHash !== lastSyncedHash;
  } catch (_e) {
    return true;
  }
}
function normalizeStatusPath(raw) {
  const trimmed = raw.trim();
  const pathPart = trimmed.length > 3 ? trimmed.slice(3).trim() : "";
  const withoutRename = pathPart.includes("->") ? pathPart.split("->").pop()?.trim() ?? pathPart : pathPart;
  return withoutRename.replace(/^"|"$/g, "");
}
async function hasNonVemChanges() {
  try {
    const root = await getRepoRoot();
    const status = execSync("git status --porcelain", { cwd: root }).toString().trim();
    if (!status) return false;
    return status.split("\n").map((line) => normalizeStatusPath(line)).some((path4) => path4.length > 0 && !path4.startsWith(".vem/"));
  } catch (_e) {
    return false;
  }
}
async function hasUncommittedChanges() {
  try {
    const root = await getRepoRoot();
    const status = execSync("git status --porcelain", { cwd: root }).toString().trim();
    return status.length > 0;
  } catch (_e) {
    return false;
  }
}

// src/runtime/hooks.ts
import fs from "fs";
import { writeFile } from "fs/promises";
import { join as join2 } from "path";
import chalk3 from "chalk";
import prompts2 from "prompts";
var VEM_PRE_PUSH_MARKER = "# vem pre-push hook";
var VEM_PRE_PUSH_VERSION_MARKER = "# vem-managed-hook:v2";
function getVemPrePushHookContent() {
  return `#!/bin/sh
${VEM_PRE_PUSH_MARKER}
${VEM_PRE_PUSH_VERSION_MARKER}
# Automatically run vem push when pushing code to the linked remote only.

REMOTE_NAME="$1"
REMOTE_URL="$2"

if ! command -v vem >/dev/null 2>&1; then
  echo "vem not found in PATH, skipping auto-push..."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
CONFIG_FILE="$REPO_ROOT/.vem/config.json"
LINKED_REMOTE_NAME=""
LINKED_REMOTE_URL=""

if [ -n "$REPO_ROOT" ] && [ -f "$CONFIG_FILE" ] && command -v node >/dev/null 2>&1; then
  LINKED_REMOTE_NAME="$(node -e 'try { const fs = require("fs"); const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (typeof c.linked_remote_name === "string") process.stdout.write(c.linked_remote_name); } catch {}' "$CONFIG_FILE")"
  LINKED_REMOTE_URL="$(node -e 'try { const fs = require("fs"); const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (typeof c.linked_remote_url === "string") process.stdout.write(c.linked_remote_url); } catch {}' "$CONFIG_FILE")"
fi

if [ -n "$LINKED_REMOTE_NAME" ] && [ "$REMOTE_NAME" != "$LINKED_REMOTE_NAME" ]; then
  echo "Skipping vem push for remote '$REMOTE_NAME' (linked: '$LINKED_REMOTE_NAME')."
  exit 0
fi

if [ -z "$LINKED_REMOTE_NAME" ] && [ -n "$LINKED_REMOTE_URL" ] && [ "$REMOTE_URL" != "$LINKED_REMOTE_URL" ]; then
  echo "Skipping vem push for remote '$REMOTE_NAME' (linked URL mismatch)."
  exit 0
fi

echo "Running vem push..."
vem push || echo "vem push failed, but continuing git push..."
`;
}
async function installGitHook(options = {}) {
  const promptIfMissing = options.promptIfMissing ?? true;
  const quiet = options.quiet ?? false;
  try {
    const root = await getRepoRoot();
    const hooksDir = join2(root, ".git", "hooks");
    const hookPath = join2(hooksDir, "pre-push");
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    const hookContent = getVemPrePushHookContent();
    if (fs.existsSync(hookPath)) {
      const existingHook = fs.readFileSync(hookPath, "utf-8");
      if (existingHook.includes(VEM_PRE_PUSH_MARKER)) {
        await writeFile(hookPath, hookContent, { mode: 493 });
        if (!quiet) {
          console.log(chalk3.green("\u2714 Git pre-push hook updated."));
        }
        return;
      }
      if (!quiet) {
        console.log(
          chalk3.yellow(
            "\n\u26A0 A pre-push hook already exists. Skipping vem hook installation."
          )
        );
      }
      return;
    }
    if (!promptIfMissing) {
      return;
    }
    const response = await prompts2({
      type: "confirm",
      name: "install",
      message: "Do you want to install a git pre-push hook to auto-sync with vem?",
      initial: true
    });
    if (!response.install) return;
    await writeFile(hookPath, hookContent, { mode: 493 });
    if (!quiet) {
      console.log(chalk3.green("\u2714 Git pre-push hook installed."));
    }
  } catch (error) {
    if (!quiet) {
      console.log(chalk3.yellow(`\u26A0 Failed to install git hook: ${error}`));
    }
  }
}

// src/runtime/io.ts
import { readdir as readdir2, readFile as readFile2 } from "fs/promises";
import { join as join3 } from "path";
async function detectVemUpdateInOutput(vemDir) {
  try {
    const logsDir = join3(vemDir, "logs");
    const files = await readdir2(logsDir).catch(() => []);
    const sortedFiles = files.filter((f) => f.endsWith(".log")).sort().reverse().slice(0, 5);
    for (const file of sortedFiles) {
      const content = await readFile2(join3(logsDir, file), "utf-8");
      if (content.includes("```vem_update") || content.includes("vem_update:")) {
        return join3(logsDir, file);
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function readStdin() {
  return new Promise((resolve3, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve3(data));
    process.stdin.on("error", reject);
  });
}

// src/runtime/metrics.ts
import chalk4 from "chalk";
var SIGNIFICANT_METRICS_COMMANDS = /* @__PURE__ */ new Set([
  "agent",
  "push",
  "finalize",
  "search",
  "ask",
  "archive",
  "task done",
  "insights"
]);
var HELP_FLAGS = /* @__PURE__ */ new Set(["--help", "-h"]);
var trackedCommandsThisProcess = /* @__PURE__ */ new Set();
var normalizeCommandName = (commandName) => commandName.trim().replace(/\s+/g, " ");
var getHelpMetricNameFromArgv = (argv) => {
  if (!argv || argv.length === 0) return null;
  if (argv[0] === "help") {
    const target = argv.slice(1).filter(
      (token) => token && !token.startsWith("-") && !HELP_FLAGS.has(token)
    );
    if (target.length === 0) return "help";
    return normalizeCommandName(`${target.join(" ")} help`);
  }
  const helpIndex = argv.findIndex((token) => HELP_FLAGS.has(token));
  if (helpIndex === -1) return null;
  const commandTokens = argv.slice(0, helpIndex).filter((token) => token && !token.startsWith("-"));
  if (commandTokens.length === 0) return "help";
  return normalizeCommandName(`${commandTokens.join(" ")} help`);
};
var getCommandPath = (actionCommand) => {
  const segments = [];
  let current = actionCommand;
  while (current) {
    const name = current.name();
    if (!name || name === "vem") break;
    segments.unshift(name);
    current = current.parent ?? null;
  }
  if (segments.length === 0) return null;
  return normalizeCommandName(segments.join(" "));
};
var shouldForceSyncCommand = (commandName) => {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) return false;
  if (SIGNIFICANT_METRICS_COMMANDS.has(normalized)) return true;
  return normalized === "help" || normalized.endsWith(" help");
};
var syncUsageMetrics = async (options) => {
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
      event: options?.event
    });
  } catch {
  }
};
var trackCommandUsage = async (commandName) => {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) return;
  if (trackedCommandsThisProcess.has(normalized)) return;
  trackedCommandsThisProcess.add(normalized);
  try {
    await metricsService.trackCommand(normalized);
    await syncUsageMetrics({
      force: shouldForceSyncCommand(normalized),
      event: { command: normalized }
    });
  } catch {
  }
};
var trackFeatureUsage = async (featureName) => {
  try {
    await metricsService.trackFeature(featureName);
    await syncUsageMetrics({
      force: true,
      event: { featureFlag: featureName }
    });
  } catch {
  }
};
var showWorkflowHint = async (commandName) => {
  try {
    const suggestion = await workflowGuide.getSuggestion(commandName);
    if (suggestion && await workflowGuide.shouldShowNudge(suggestion.type)) {
      console.log();
      if (suggestion.priority === "high") {
        console.log(chalk4.cyan(`\u{1F4A1} ${suggestion.title}`));
      } else {
        console.log(chalk4.gray(`\u{1F4A1} ${suggestion.title}`));
      }
      console.log(chalk4.gray(`   ${suggestion.message}`));
      if (suggestion.command) {
        console.log(chalk4.gray(`   Try: ${chalk4.white(suggestion.command)}`));
      }
      console.log();
    }
  } catch {
  }
};
var trackCommandUsageFromAction = async (actionCommand) => {
  const commandPath = getCommandPath(actionCommand);
  if (!commandPath) return;
  if (commandPath === "help") return;
  await trackCommandUsage(commandPath);
};
var trackHelpUsageFromArgv = async (argv) => {
  const helpMetric = getHelpMetricNameFromArgv(argv);
  if (!helpMetric) return;
  await trackCommandUsage(helpMetric);
};
var trackAgentSession = async (action, metadata) => {
  try {
    await syncUsageMetrics({
      force: true,
      event: {
        featureFlag: action,
        metadata
      }
    });
  } catch {
  }
};

// src/runtime/strict-memory.ts
import { readdir as readdir3, readFile as readFile3, stat } from "fs/promises";
import { join as join4 } from "path";
import chalk5 from "chalk";
import prompts3 from "prompts";
var STRICT_NO_CHANGE_CHANGELOG = "No user-facing changes in this session.";
var STRICT_NO_CHANGE_DECISIONS = "No architectural decisions in this session.";
function normalizeLines(value) {
  if (!value) return [];
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function normalizeAppendEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  return normalizeLines(value);
}
async function getFileMtimeMs(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs;
  } catch (_e) {
    return null;
  }
}
async function getLatestEntryMtimeMs(dirPath) {
  try {
    const entries = await readdir3(dirPath, { withFileTypes: true });
    let latest = null;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "archive") continue;
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const entryPath = join4(dirPath, entry.name);
      const mtime = await getFileMtimeMs(entryPath);
      if (mtime === null) continue;
      if (latest === null || mtime > latest) {
        latest = mtime;
      }
    }
    return latest;
  } catch (_e) {
    return null;
  }
}
async function collectStrictMemoryUpdate(agentUpdate) {
  const vemDir = await getVemDir();
  const contextPath = join4(vemDir, CONTEXT_FILE);
  const currentStatePath = join4(vemDir, CURRENT_STATE_FILE);
  const currentContext = (await readFile3(contextPath, "utf-8").catch(() => "")).toString();
  const currentStateExisting = (await readFile3(currentStatePath, "utf-8").catch(() => "")).toString();
  const contextValue = typeof agentUpdate?.context === "string" && agentUpdate.context.trim().length > 0 ? agentUpdate.context : currentContext;
  const currentStateValue = typeof agentUpdate?.current_state === "string" && agentUpdate.current_state.trim().length > 0 ? agentUpdate.current_state : currentStateExisting.trim().length > 0 ? currentStateExisting : "Agent session completed. Summary not provided in vem_update.";
  const changelogLines = normalizeAppendEntries(agentUpdate?.changelog_append);
  const changelogAppend = changelogLines.length > 0 ? changelogLines : [STRICT_NO_CHANGE_CHANGELOG];
  const decisionsLines = normalizeAppendEntries(agentUpdate?.decisions_append);
  const decisionsAppend = decisionsLines.length > 0 ? decisionsLines : [STRICT_NO_CHANGE_DECISIONS];
  return {
    context: contextValue,
    current_state: currentStateValue,
    changelog_append: changelogAppend,
    decisions_append: decisionsAppend
  };
}
async function promptAdditionalTaskNotes() {
  if (!process.stdin.isTTY) return void 0;
  const wantsNotes = await prompts3({
    type: "confirm",
    name: "value",
    message: "Add task notes for this session?",
    initial: false
  });
  if (!wantsNotes.value) return void 0;
  const notesPrompt = await prompts3({
    type: "text",
    name: "value",
    message: "Task notes:"
  });
  if (typeof notesPrompt.value !== "string") return void 0;
  const trimmed = notesPrompt.value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
async function enforceStrictMemoryUpdates(startedAtMs, strictMemory, options) {
  const additionalNotes = options?.onAdditionalNotes ? await promptAdditionalTaskNotes() : void 0;
  if (additionalNotes && options?.onAdditionalNotes) {
    try {
      await options.onAdditionalNotes(additionalNotes);
      console.log(chalk5.gray("Task notes updated."));
    } catch (error) {
      console.log(
        chalk5.yellow(
          `Could not persist task notes: ${error?.message || String(error)}`
        )
      );
    }
  }
  if (!strictMemory) return;
  if (!await hasNonVemChanges()) return;
  const vemDir = await getVemDir();
  const contextPath = join4(vemDir, CONTEXT_FILE);
  const currentStatePath = join4(vemDir, CURRENT_STATE_FILE);
  const contextMtime = await getFileMtimeMs(contextPath);
  const currentStateMtime = await getFileMtimeMs(currentStatePath);
  const changelogMtime = await getLatestEntryMtimeMs(
    join4(vemDir, CHANGELOG_DIR)
  );
  const decisionsMtime = await getLatestEntryMtimeMs(
    join4(vemDir, DECISIONS_DIR)
  );
  const contextUpdated = (contextMtime ?? 0) > startedAtMs;
  const currentStateUpdated = (currentStateMtime ?? 0) > startedAtMs;
  const changelogUpdated = (changelogMtime ?? 0) > startedAtMs;
  const decisionsUpdated = (decisionsMtime ?? 0) > startedAtMs;
  if (contextUpdated && currentStateUpdated && changelogUpdated && decisionsUpdated) {
    return;
  }
  console.log(
    chalk5.yellow(
      "\nStrict memory enforcement: applying agent memory update for CONTEXT, CURRENT_STATE, changelog, and decisions."
    )
  );
  const update = await collectStrictMemoryUpdate(options?.agentUpdate);
  const result = await applyVemUpdate(update);
  console.log(chalk5.green("\n\u2714 Strict memory update applied\n"));
  if (result.contextUpdated) {
    console.log(chalk5.gray("Context updated."));
  }
  if (result.currentStateUpdated) {
    console.log(chalk5.gray("Current state updated."));
  }
  if (result.changelogLines.length > 0) {
    console.log(
      chalk5.gray(`Changelog entries: ${result.changelogLines.length}`)
    );
  }
  if (result.decisionsAppended) {
    console.log(chalk5.gray("Decisions updated."));
  }
  const memorySynced = await syncProjectMemoryToRemote();
  if (memorySynced) {
    console.log(chalk5.gray("Project memory synced to cloud."));
  }
}
async function syncProjectMemoryToRemote() {
  try {
    const configService = new ConfigService();
    const [apiKey, projectId] = await Promise.all([
      tryAuthenticatedKey(configService),
      configService.getProjectId()
    ]);
    if (!apiKey || !projectId) return false;
    const vemDir = await getVemDir();
    const contextPath = join4(vemDir, CONTEXT_FILE);
    const currentStatePath = join4(vemDir, CURRENT_STATE_FILE);
    const [context, currentState, decisionsLog, changelogLog, taskList] = await Promise.all([
      readFile3(contextPath, "utf-8").catch(() => ""),
      readFile3(currentStatePath, "utf-8").catch(() => ""),
      new ScalableLogService(DECISIONS_DIR).getMonolithicContent().catch(() => ""),
      new ScalableLogService(CHANGELOG_DIR).getMonolithicContent().catch(() => ""),
      new TaskService().getTasks().catch(() => [])
    ]);
    const tasks = taskList.filter(
      (t) => t.status || Array.isArray(t.evidence) && t.evidence.length > 0 || t.task_context_summary || t.task_context
    ).map((t) => ({
      id: t.id,
      status: t.status,
      evidence: t.evidence ?? [],
      task_context: t.task_context ?? null,
      task_context_summary: t.task_context_summary ?? null
    }));
    const response = await fetch(`${API_URL}/projects/${projectId}/context`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...await buildDeviceHeaders(configService)
      },
      body: JSON.stringify({
        context: context.trim(),
        current_state: currentState.trim(),
        decisions: decisionsLog.trim(),
        changelog: changelogLog.trim(),
        ...tasks.length > 0 ? { tasks } : {}
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

// src/runtime/sync.ts
import chalk6 from "chalk";
async function performPush(payload, key, configService) {
  try {
    const res = await fetch(`${API_URL}/snapshots`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...await buildDeviceHeaders(configService)
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const json = await res.json();
      if (json.version) {
        await configService.setLastVersion(json.version);
      }
      return { success: true, data: json };
    }
    const data = await res.json().catch(() => ({}));
    return {
      success: false,
      status: res.status,
      error: data.error || res.statusText,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function processQueue(syncService2, configService, key) {
  const queue = await syncService2.getQueue();
  if (queue.length === 0) return;
  console.log(
    chalk6.blue(`
\u{1F504} Processing offline queue (${queue.length} items)...`)
  );
  let successCount = 0;
  for (const item of queue) {
    const result = await performPush(item.payload, key, configService);
    if (result.success) {
      await syncService2.removeFromQueue(item.id);
      successCount++;
    } else {
      console.log(
        chalk6.yellow(
          `  \u26A0 Failed to push queued snapshot ${item.id}: ${result.error}`
        )
      );
      if (result.status === 409 || result.status === 403 || result.status === 404) {
        break;
      }
    }
  }
  if (successCount > 0) {
    console.log(chalk6.green(`  \u2714 Successfully pushed ${successCount} items.`));
  }
}

// src/commands/agent.ts
function shellEscapeArg(arg) {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
function truncateForDisplay(value, maxChars) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 15)).trimEnd()}
...[truncated]`;
}
var AGENT_TASK_STATUSES = /* @__PURE__ */ new Set([
  "todo",
  "in-review",
  "in-progress",
  "blocked",
  "done"
]);
var MAX_CHILD_TASKS_IN_PROMPT = 12;
var TASK_STATUS_ORDER = {
  "in-review": 0,
  "in-progress": 1,
  todo: 2,
  ready: 3,
  blocked: 4,
  done: 5
};
var debugAgentSync = (...messages) => {
  if (process.env.VEM_DEBUG !== "1") return;
  console.log(chalk7.gray(`[agent-sync] ${messages.join(" ")}`));
};
var resolveApiKey = async (configService) => {
  const verified = await tryAuthenticatedKey(configService);
  if (verified) return verified;
  const stored = await configService.getApiKey();
  return typeof stored === "string" && stored.trim().length > 0 ? stored : null;
};
var asTrimmedString = (value) => {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
};
var normalizeAgentTask = (input) => {
  if (!input || typeof input !== "object") return null;
  const record = input;
  const id = asTrimmedString(record.id);
  const title = asTrimmedString(record.title);
  const statusRaw = asTrimmedString(record.status);
  if (!id || !title || !statusRaw || !AGENT_TASK_STATUSES.has(statusRaw)) {
    return null;
  }
  return {
    ...record,
    id,
    title,
    status: statusRaw,
    db_id: asTrimmedString(record.db_id),
    description: asTrimmedString(record.description),
    deleted_at: asTrimmedString(record.deleted_at)
  };
};
var fetchRemoteAgentTasks = async (configService) => {
  try {
    const [apiKey, projectId] = await Promise.all([
      resolveApiKey(configService),
      configService.getProjectId()
    ]);
    if (!apiKey || !projectId) return null;
    const query = new URLSearchParams({
      include_deleted: "true"
    });
    const response = await fetch(
      `${API_URL}/projects/${projectId}/tasks?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...await buildDeviceHeaders(configService)
        }
      }
    );
    if (!response.ok) return null;
    const body = await response.json();
    if (!Array.isArray(body.tasks)) return null;
    const normalized = body.tasks.map((task) => normalizeAgentTask(task)).filter((task) => Boolean(task));
    const deletedIds = new Set(
      normalized.filter((task) => Boolean(task.deleted_at)).map((task) => task.id)
    );
    const visible = normalized.filter((task) => !task.deleted_at);
    return { visible, deletedIds };
  } catch {
    return null;
  }
};
var fetchRemoteAgentTaskById = async (configService, _taskId, dbId) => {
  try {
    const apiKey = await resolveApiKey(configService);
    if (!apiKey) return null;
    const response = await fetch(`${API_URL}/tasks/${encodeURIComponent(dbId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...await buildDeviceHeaders(configService)
      }
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body.task) return null;
    return normalizeAgentTask(body.task);
  } catch {
    return null;
  }
};
var mergeAgentTasks = (localTasks, remote) => {
  if (!remote) return localTasks;
  const merged = new Map(
    remote.visible.map((task) => [task.id, task])
  );
  for (const localTask of localTasks) {
    if (localTask.deleted_at) continue;
    if (remote.deletedIds.has(localTask.id)) continue;
    if (merged.has(localTask.id)) continue;
    merged.set(localTask.id, localTask);
  }
  return Array.from(merged.values());
};
var updateTaskMetaRemote = async (configService, task, patch) => {
  try {
    const apiKey = await resolveApiKey(configService);
    if (!apiKey) {
      debugAgentSync("updateTaskMetaRemote skipped: no apiKey");
      return false;
    }
    const dbId = asTrimmedString(task.db_id);
    if (!dbId) {
      debugAgentSync("task lookup missing db_id", `task=${task.id}`);
      return false;
    }
    const normalizeStringArray = (value) => Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
    const normalizeNumber = (value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const normalizedEvidence = patch.evidence !== void 0 ? patch.evidence.map((entry) => entry.trim()).filter(Boolean) : void 0;
    const normalizedRelatedDecisions = patch.related_decisions !== void 0 ? patch.related_decisions.filter(
      (entry) => typeof entry === "string" && entry.trim().length > 0 || typeof entry === "object" && entry !== null && Boolean(entry.id)
    ) : void 0;
    const normalizedSessions = Array.isArray(patch.sessions) && patch.sessions.length > 0 ? patch.sessions : void 0;
    const payload = {
      title: asTrimmedString(task.title) ?? task.title,
      description: asTrimmedString(task.description) ?? null,
      priority: asTrimmedString(task.priority) ?? "medium",
      tags: normalizeStringArray(task.tags),
      type: asTrimmedString(task.type) ?? null,
      estimate_hours: normalizeNumber(task.estimate_hours),
      depends_on: normalizeStringArray(task.depends_on),
      blocked_by: normalizeStringArray(task.blocked_by),
      recurrence_rule: asTrimmedString(task.recurrence_rule) ?? null,
      owner_id: asTrimmedString(task.owner_id) ?? null,
      reviewer_id: asTrimmedString(task.reviewer_id) ?? null,
      parent_id: asTrimmedString(task.parent_id) ?? null,
      subtask_order: typeof task.subtask_order === "number" ? task.subtask_order : null,
      due_at: asTrimmedString(task.due_at) ?? null,
      validation_steps: normalizeStringArray(task.validation_steps),
      evidence: normalizeStringArray(task.evidence),
      related_decisions: Array.isArray(task.related_decisions) ? task.related_decisions : [],
      deleted_at: asTrimmedString(task.deleted_at) ?? null
    };
    if (patch.status !== void 0) payload.status = patch.status;
    if (normalizedEvidence !== void 0) payload.evidence = normalizedEvidence;
    if (normalizedRelatedDecisions !== void 0) {
      payload.related_decisions = normalizedRelatedDecisions;
    }
    if (normalizedSessions !== void 0) {
      payload.sessions = normalizedSessions;
    }
    if (patch.reasoning !== void 0) payload.reasoning = patch.reasoning;
    if (patch.actor !== void 0) {
      payload.actor = patch.actor.trim().length > 0 ? patch.actor.trim() : void 0;
    }
    if (patch.title !== void 0) payload.title = patch.title;
    if (patch.description !== void 0)
      payload.description = patch.description;
    if (patch.priority !== void 0) payload.priority = patch.priority;
    if (patch.tags !== void 0) payload.tags = patch.tags;
    if (patch.type !== void 0) payload.type = patch.type;
    if (patch.estimate_hours !== void 0)
      payload.estimate_hours = patch.estimate_hours;
    if (patch.depends_on !== void 0) payload.depends_on = patch.depends_on;
    if (patch.blocked_by !== void 0) payload.blocked_by = patch.blocked_by;
    if (patch.recurrence_rule !== void 0)
      payload.recurrence_rule = patch.recurrence_rule;
    if (patch.owner_id !== void 0) payload.owner_id = patch.owner_id;
    if (patch.reviewer_id !== void 0)
      payload.reviewer_id = patch.reviewer_id;
    if (patch.validation_steps !== void 0)
      payload.validation_steps = patch.validation_steps;
    if (patch.user_notes !== void 0) payload.user_notes = patch.user_notes;
    if (patch.github_issue_number !== void 0)
      payload.github_issue_number = patch.github_issue_number;
    if (patch.parent_id !== void 0) payload.parent_id = patch.parent_id;
    if (patch.subtask_order !== void 0)
      payload.subtask_order = patch.subtask_order;
    if (patch.due_at !== void 0) payload.due_at = patch.due_at;
    if (patch.raw_vem_update !== void 0)
      payload.raw_vem_update = patch.raw_vem_update;
    if (patch.cli_version !== void 0)
      payload.cli_version = patch.cli_version;
    if (patch.task_context !== void 0)
      payload.task_context = patch.task_context;
    if (patch.task_context_summary !== void 0)
      payload.task_context_summary = patch.task_context_summary;
    if (patch.changelog_entry !== void 0)
      payload.changelog_entry = patch.changelog_entry;
    const response = await fetch(
      `${API_URL}/tasks/${encodeURIComponent(dbId)}/meta`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...await buildDeviceHeaders(configService)
        },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      debugAgentSync(
        "task meta update failed:",
        String(response.status),
        response.statusText,
        errorBody ? `body=${errorBody}` : ""
      );
    }
    return response.ok;
  } catch (error) {
    debugAgentSync(
      "task meta update threw:",
      error?.message ? String(error.message) : String(error)
    );
    return false;
  }
};
var markTaskInProgressRemote = async (configService, task, actor) => {
  return updateTaskMetaRemote(configService, task, {
    status: "in-progress",
    reasoning: "Started via vem agent",
    actor
  });
};
var buildRemoteTaskContextPatch = (patch, updatedTask) => {
  const hasExplicitTaskContext = patch.task_context !== void 0;
  const hasExplicitTaskContextSummary = patch.task_context_summary !== void 0;
  const isDoneUpdate = patch.status === "done";
  const payload = {};
  if (isDoneUpdate) {
    payload.task_context = updatedTask.task_context ?? null;
    if (hasExplicitTaskContextSummary) {
      payload.task_context_summary = patch.task_context_summary || null;
    } else if (updatedTask.task_context_summary !== void 0) {
      payload.task_context_summary = updatedTask.task_context_summary || null;
    }
  } else {
    if (hasExplicitTaskContext) {
      payload.task_context = patch.task_context || null;
    }
    if (hasExplicitTaskContextSummary) {
      payload.task_context_summary = patch.task_context_summary || null;
    }
  }
  return Object.keys(payload).length > 0 ? payload : null;
};
var syncParsedTaskUpdatesToRemote = async (configService, update, result, activeTask) => {
  const hasTasks = Array.isArray(update.tasks) && update.tasks.length > 0;
  if (!hasTasks) {
    const hasContent = typeof update.context === "string" && update.context.trim().length > 0 || Array.isArray(update.changelog_append) && update.changelog_append.length > 0 || typeof update.changelog_append === "string" && update.changelog_append.trim().length > 0;
    if (activeTask && hasContent) {
      const changelogEntry = Array.isArray(update.changelog_append) ? update.changelog_append.join("\n").trim() || null : update.changelog_append?.trim() ?? null;
      await updateTaskMetaRemote(configService, activeTask, {
        raw_vem_update: JSON.parse(JSON.stringify(update)),
        cli_version: "0.1.56",
        ...changelogEntry ? { changelog_entry: changelogEntry } : {}
      });
    }
    return;
  }
  if (!result) return;
  const changelogReasoning = Array.isArray(update.changelog_append) ? update.changelog_append.join("\n").trim() : update.changelog_append?.trim() ?? void 0;
  const tasksMissingDbId = result.updatedTasks.filter(
    (t) => !asTrimmedString(t.db_id)
  );
  if (tasksMissingDbId.length > 0) {
    const remoteTasks = await fetchRemoteAgentTasks(configService);
    if (remoteTasks) {
      const remoteById = new Map(
        remoteTasks.visible.map((t) => [t.id, t])
      );
      for (const task of tasksMissingDbId) {
        const remote = remoteById.get(task.id);
        if (remote?.db_id) {
          task.db_id = remote.db_id;
          await taskService.updateTask(task.id, { db_id: remote.db_id });
        }
      }
    }
  }
  const patchById = new Map((update.tasks ?? []).map((entry) => [entry.id, entry]));
  for (const updatedTask of result.updatedTasks) {
    const patch = patchById.get(updatedTask.id);
    if (!patch) continue;
    const remoteTaskRef = updatedTask;
    await updateTaskMetaRemote(configService, remoteTaskRef, {
      status: patch.status ?? updatedTask.status,
      evidence: patch.evidence ?? updatedTask.evidence,
      related_decisions: patch.related_decisions ?? updatedTask.related_decisions,
      sessions: Array.isArray(updatedTask.sessions) ? updatedTask.sessions : void 0,
      reasoning: patch.reasoning ?? changelogReasoning,
      actor: patch.actor,
      // Forward all other task fields that may have changed
      ...patch.title !== void 0 ? { title: patch.title } : {},
      ...patch.description !== void 0 ? { description: patch.description } : {},
      ...patch.priority !== void 0 ? { priority: patch.priority } : {},
      ...patch.tags !== void 0 ? { tags: patch.tags } : {},
      ...patch.type !== void 0 ? { type: patch.type } : {},
      ...patch.estimate_hours !== void 0 ? { estimate_hours: patch.estimate_hours } : {},
      ...patch.depends_on !== void 0 ? { depends_on: patch.depends_on } : {},
      ...patch.blocked_by !== void 0 ? { blocked_by: patch.blocked_by } : {},
      ...patch.recurrence_rule !== void 0 ? { recurrence_rule: patch.recurrence_rule } : {},
      ...patch.owner_id !== void 0 ? { owner_id: patch.owner_id } : {},
      ...patch.reviewer_id !== void 0 ? { reviewer_id: patch.reviewer_id } : {},
      ...patch.validation_steps !== void 0 ? { validation_steps: patch.validation_steps } : {},
      ...patch.user_notes !== void 0 ? { user_notes: patch.user_notes } : {},
      ...patch.github_issue_number !== void 0 ? { github_issue_number: patch.github_issue_number } : {},
      ...patch.parent_id !== void 0 ? { parent_id: patch.parent_id } : {},
      ...patch.subtask_order !== void 0 ? { subtask_order: patch.subtask_order } : {},
      ...patch.due_at !== void 0 ? { due_at: patch.due_at } : {},
      raw_vem_update: JSON.parse(JSON.stringify(update)),
      cli_version: "0.1.56",
      // Task memory fields — stored in task_memory_entries on the API side.
      ...buildRemoteTaskContextPatch(patch, updatedTask) ?? {},
      changelog_entry: changelogReasoning ?? null
    });
  }
};
var mergeTaskContextWithNote = (existing, note) => {
  const trimmed = note.trim();
  if (!trimmed) return existing?.trim() || "";
  const noteBlock = `User note (${(/* @__PURE__ */ new Date()).toISOString()}):
${trimmed}`;
  const current = existing?.trim();
  return current && current.length > 0 ? `${current}

${noteBlock}` : noteBlock;
};
var appendTaskNotesToContext = async (configService, task, notes) => {
  const trimmed = notes.trim();
  if (!trimmed) return;
  const localTask = await taskService.getTask(task.id);
  if (localTask) {
    const merged = mergeTaskContextWithNote(localTask.task_context, trimmed);
    await taskService.updateTask(task.id, { task_context: merged });
  }
  try {
    const [apiKey, projectId] = await Promise.all([
      resolveApiKey(configService),
      configService.getProjectId()
    ]);
    if (!apiKey || !projectId) return;
    let remoteContext = "";
    const getResponse = await fetch(
      `${API_URL}/projects/${projectId}/tasks/${encodeURIComponent(task.id)}/context`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...await buildDeviceHeaders(configService)
        }
      }
    );
    if (getResponse.ok) {
      const body = await getResponse.json();
      remoteContext = typeof body.task_context === "string" ? body.task_context : "";
    }
    const mergedRemoteContext = mergeTaskContextWithNote(
      remoteContext,
      trimmed
    );
    await fetch(
      `${API_URL}/projects/${projectId}/tasks/${encodeURIComponent(task.id)}/context`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...await buildDeviceHeaders(configService)
        },
        body: JSON.stringify({
          task_context: mergedRemoteContext
        })
      }
    );
    const dbId = asTrimmedString(task.db_id);
    if (dbId) {
      let currentUserNotes = "";
      try {
        const notesGetResp = await fetch(
          `${API_URL}/tasks/${encodeURIComponent(dbId)}/meta`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...await buildDeviceHeaders(configService)
            }
          }
        );
        if (notesGetResp.ok) {
          const notesBody = await notesGetResp.json();
          currentUserNotes = typeof notesBody.user_notes === "string" ? notesBody.user_notes : "";
        }
      } catch {
      }
      const mergedUserNotes = currentUserNotes.trim().length > 0 ? `${currentUserNotes.trim()}

${trimmed}` : trimmed;
      await fetch(`${API_URL}/tasks/${encodeURIComponent(dbId)}/meta`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...await buildDeviceHeaders(configService)
        },
        body: JSON.stringify({ user_notes: mergedUserNotes })
      });
    }
  } catch {
  }
};
var normalizeTaskParentPointers = (tasks) => {
  const idSet = new Set(tasks.map((task) => task.id));
  const externalIdByDbId = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const dbId = asTrimmedString(task.db_id);
    if (!dbId) continue;
    externalIdByDbId.set(dbId, task.id);
  }
  return tasks.map((task) => {
    const parentId = asTrimmedString(task.parent_id);
    if (!parentId) return task;
    if (idSet.has(parentId)) return task;
    const resolvedParentId = externalIdByDbId.get(parentId);
    if (!resolvedParentId) return task;
    return {
      ...task,
      parent_id: resolvedParentId
    };
  });
};
var compareTasksForDisplay = (a, b) => {
  const statusDelta = (TASK_STATUS_ORDER[a.status] ?? 99) - (TASK_STATUS_ORDER[b.status] ?? 99);
  if (statusDelta !== 0) return statusDelta;
  const orderA = typeof a.subtask_order === "number" ? a.subtask_order : Number.MAX_SAFE_INTEGER;
  const orderB = typeof b.subtask_order === "number" ? b.subtask_order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return a.id.localeCompare(b.id);
};
var describeTask = (task, maxChars) => {
  if (!task.description) return "";
  return ` - ${task.description.slice(0, maxChars)}${task.description.length > maxChars ? "..." : ""}`;
};
var buildTaskPickerChoices = (tasks) => {
  const visible = tasks.filter(
    (task) => task.status !== "done" && !task.deleted_at
  );
  const byId = new Map(
    visible.map((task) => [task.id, task])
  );
  const childrenByParent = /* @__PURE__ */ new Map();
  const roots = [];
  for (const task of visible) {
    if (task.parent_id && byId.has(task.parent_id)) {
      const siblings = childrenByParent.get(task.parent_id) ?? [];
      siblings.push(task);
      childrenByParent.set(task.parent_id, siblings);
      continue;
    }
    roots.push(task);
  }
  const choices = [];
  const visited = /* @__PURE__ */ new Set();
  const walk = (task, depth) => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    const children = [...childrenByParent.get(task.id) ?? []].sort(
      compareTasksForDisplay
    );
    const indent = depth > 0 ? `${"  ".repeat(depth - 1)}|- ` : "";
    const scopeTag = depth === 0 && children.length > 0 ? chalk7.cyan(` [parent +${children.length}]`) : depth > 0 ? chalk7.gray(" [child]") : "";
    const desc = describeTask(task, 40);
    choices.push({
      title: `${indent}[${task.id}] ${task.title} (${task.status})${scopeTag}${chalk7.gray(desc)}`,
      value: task.id
    });
    for (const child of children) {
      walk(child, depth + 1);
    }
  };
  for (const root of [...roots].sort(compareTasksForDisplay)) {
    walk(root, 0);
  }
  for (const task of [...visible].sort(compareTasksForDisplay)) {
    if (visited.has(task.id)) continue;
    walk(task, 0);
  }
  return choices;
};
var sortChildTasksForScope = (tasks) => {
  return [...tasks].sort((a, b) => {
    const orderA = typeof a.subtask_order === "number" ? a.subtask_order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.subtask_order === "number" ? b.subtask_order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const statusDelta = (TASK_STATUS_ORDER[a.status] ?? 99) - (TASK_STATUS_ORDER[b.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    return a.id.localeCompare(b.id);
  });
};
var formatChildTaskLine = (task) => {
  const summary = task.description ? ` - ${task.description.slice(0, 120)}${task.description.length > 120 ? "..." : ""}` : "";
  return `- [${task.id}] ${task.title} (${task.status})${summary}`;
};
function registerAgentCommands(program2) {
  program2.command("agent [command] [args...]").description("Wrap an AI agent with vem context and task tracking").option("-t, --task <taskId>", "Specify the task ID to work on").option(
    "--no-strict-memory",
    "Disable strict memory enforcement after agent runs"
  ).option(
    "--auto-exit",
    "Automatically exit after agent finishes, skipping post-run prompts"
  ).action(async (command, args, options) => {
    await trackCommandUsage("agent");
    await trackFeatureUsage("agent");
    try {
      await ensureVemDir();
      await ensureVemFiles();
      const configService = new ConfigService();
      const key = await configService.getApiKey();
      if (key) {
        console.log(chalk7.blue("\u{1F504} Syncing with cloud..."));
        await processQueue(syncService, configService, key);
        const projectId = await configService.getProjectId();
        const repoUrl = projectId ? null : await getGitRemote();
        if (repoUrl || projectId) {
          if (await isVemDirty(configService)) {
            console.log(
              chalk7.yellow(
                "  \u26A0 Local .vem memory has unsynced changes. Skipping auto-sync to avoid overwrite."
              )
            );
          } else {
            try {
              const query = new URLSearchParams();
              if (repoUrl) query.set("repo_url", repoUrl);
              if (projectId) query.set("project_id", projectId);
              const res = await fetch(
                `${API_URL}/snapshots/latest?${query}`,
                {
                  headers: {
                    Authorization: `Bearer ${key}`,
                    ...await buildDeviceHeaders(configService)
                  }
                }
              );
              if (res.ok) {
                const data = await res.json();
                if (data.snapshot) {
                  await syncService.unpack(data.snapshot);
                  const localHash = await computeVemHash();
                  await configService.setLastSyncedVemHash(localHash);
                  if (data.version) {
                    await configService.setLastVersion(data.version);
                  }
                  console.log(
                    chalk7.gray(
                      `  Synced to version ${data.version || "unknown"}`
                    )
                  );
                }
              } else if (res.status === 409) {
                console.log(
                  chalk7.yellow(
                    "  \u26A0 Conflict detected during sync. Using local memory. Resolve with `vem pull`/`vem push` later."
                  )
                );
              }
            } catch (_e) {
              console.log(
                chalk7.yellow(
                  "  \u26A0 Could not reach cloud. Using local memory."
                )
              );
            }
          }
        }
      }
      let selectedCommand = command;
      if (!selectedCommand) {
        const knownTools = [
          { name: "codex", label: "Codex (OpenAI)" },
          { name: "claude", label: "Claude (Anthropic)" },
          { name: "gemini", label: "Gemini (Google)" },
          { name: "copilot", label: "GitHub Copilot" },
          { name: "gh", args: ["copilot"], label: "GitHub Copilot (via gh)" },
          { name: "cursor", label: "Cursor IDE" },
          { name: "code", label: "VS Code" }
        ];
        const availableTools = [];
        for (const tool of knownTools) {
          try {
            execSync2(`command -v ${tool.name}`, { stdio: "ignore" });
            availableTools.push({
              title: tool.label,
              value: { cmd: tool.name, args: tool.args || [] }
            });
          } catch (_e) {
          }
        }
        if (availableTools.length === 0) {
          console.log(
            chalk7.red("No supported AI agent CLIs found on your system.")
          );
          console.log(
            chalk7.gray(
              "Supported: claude, gemini, copilot, gh copilot, cursor, code"
            )
          );
          return;
        }
        const response = await prompts4({
          type: "select",
          name: "tool",
          message: "Select an AI Agent to launch:",
          choices: availableTools
        });
        if (!response.tool) {
          console.log(chalk7.yellow("Selection cancelled."));
          return;
        }
        selectedCommand = response.tool.cmd;
        if (response.tool.args && response.tool.args.length > 0) {
          args = [...response.tool.args, ...args || []];
        }
      }
      const localTasks = await taskService.getTasks();
      const remoteTasks = await fetchRemoteAgentTasks(configService);
      const tasks = normalizeTaskParentPointers(
        mergeAgentTasks(localTasks, remoteTasks)
      );
      const startActor = resolveActorName();
      const moveTaskToInProgress = async (task) => {
        const localTask = await taskService.getTask(task.id);
        if (localTask) {
          await taskService.updateTask(task.id, { status: "in-progress" });
        }
        await markTaskInProgressRemote(configService, task, startActor);
        task.status = "in-progress";
      };
      let activeTask;
      if (options.task) {
        activeTask = tasks.find((t) => t.id === options.task);
        if (!activeTask) {
          console.error(chalk7.red(`Task ${options.task} not found.`));
          return;
        }
        if (activeTask.status !== "in-progress" && activeTask.status !== "done") {
          await moveTaskToInProgress(activeTask);
        }
      }
      if (!activeTask) {
        const choices = buildTaskPickerChoices(tasks);
        choices.unshift({ title: "+ Create new task", value: "new" });
        const response = await prompts4({
          type: "select",
          name: "taskId",
          message: "Select a task to work on:",
          choices
        });
        if (!response.taskId) {
          console.log(chalk7.yellow("No task selected. Exiting."));
          return;
        }
        if (response.taskId === "new") {
          const newTask = await prompts4([
            { type: "text", name: "title", message: "Task Title:" },
            {
              type: "text",
              name: "description",
              message: "Description (optional):"
            }
          ]);
          if (newTask.title) {
            activeTask = await taskService.addTask(
              newTask.title,
              newTask.description,
              "medium"
            );
            await taskService.updateTask(activeTask.id, {
              status: "in-progress"
            });
            await trackFeatureUsage("task_driven");
            console.log(
              chalk7.green(`
\u2714 Created and started: ${activeTask.id}
`)
            );
          }
        } else {
          activeTask = tasks.find((t) => t.id === response.taskId);
          if (activeTask) {
            if (activeTask.status === "todo") {
              await moveTaskToInProgress(activeTask);
            }
            await trackFeatureUsage("task_driven");
            console.log(
              chalk7.green(`
\u2714 Switched to task: ${activeTask.id}
`)
            );
          }
        }
      }
      if (!activeTask) return;
      console.log(
        chalk7.green(`
Checked in: ${activeTask.id} - ${activeTask.title}
`)
      );
      process.env.VEM_ACTIVE_TASK = activeTask.id;
      let sessionIdsBefore = /* @__PURE__ */ new Set();
      let gitRootForSessions;
      try {
        gitRootForSessions = execSync2("git rev-parse --show-toplevel", {
          encoding: "utf-8"
        }).trim();
        const sessionsBefore = await listAllAgentSessions(gitRootForSessions);
        sessionIdsBefore = new Set(sessionsBefore.map((s) => s.id));
      } catch {
      }
      let attachedSessionRef = null;
      const allChildTasks = sortChildTasksForScope(
        tasks.filter(
          (task) => task.parent_id === activeTask.id && !task.deleted_at
        )
      );
      const actionableChildTasks = allChildTasks.filter(
        (task) => task.status !== "done"
      );
      const scopedChildTasks = actionableChildTasks.length > 0 ? actionableChildTasks : allChildTasks;
      const scopedChildTaskIds = scopedChildTasks.map((task) => task.id);
      process.env.VEM_CHILD_TASK_IDS = scopedChildTaskIds.join(",");
      console.log(chalk7.blue("\u{1F4DD} Generating context for agent..."));
      const snapshot = await syncService.packForAgent();
      const vemDir = await getVemDir();
      const contextFile = join5(vemDir, "current_context.md");
      const contextContent = formatVemPack(snapshot);
      await writeFile2(contextFile, contextContent);
      console.log(chalk7.gray(`Context written to ${contextFile}`));
      if (activeTask) {
        const refreshedTask = await taskService.getTask(activeTask.id);
        const taskForContext = refreshedTask || activeTask;
        const taskContextFile = join5(vemDir, TASK_CONTEXT_FILE);
        const taskContextBody = taskForContext.task_context && taskForContext.task_context.trim().length > 0 ? truncateForDisplay(taskForContext.task_context, 12e3) : "_No task context yet. Use `vem task context` to add notes._";
        const summaryBlock = taskForContext.task_context_summary ? `

## Previous Task Context Summary
${truncateForDisplay(taskForContext.task_context_summary, 4e3)}` : "";
        const childTasksContextBlock = scopedChildTasks.length > 0 ? `

## Child Tasks In Scope
${scopedChildTasks.map((task) => formatChildTaskLine(task)).join(
          "\n"
        )}

Treat these child tasks as required implementation scope for this run.` : "";
        const taskContextContent = `# ACTIVE TASK
Task: ${taskForContext.id} \u2014 ${taskForContext.title}
Status: ${taskForContext.status}

## Task Context
${taskContextBody}${summaryBlock}${childTasksContextBlock}

---
This file is generated for the active task. Update task context via:
\`vem task context ${taskForContext.id} --set "..." \` or \`--append "..." \`
`;
        await writeFile2(taskContextFile, taskContextContent);
        console.log(chalk7.gray(`Task context written to ${taskContextFile}`));
      }
      const strictMemory = (options.strictMemory ?? true) && process.env.VEM_STRICT_MEMORY !== "0";
      const sessionStartedAt = Date.now();
      console.log(chalk7.bold(`
\u{1F916} Launching ${selectedCommand}...
`));
      let launchArgs = args || [];
      const baseCmd = selectedCommand.split(/[/\\]/).pop();
      const agentName = resolveActorName() || baseCmd || "Agent";
      await trackAgentSession("agent_start", {
        agentName,
        taskId: activeTask?.id,
        command: selectedCommand
      });
      const heartbeatInterval = setInterval(async () => {
        await trackAgentSession("agent_heartbeat", {
          agentName,
          taskId: activeTask?.id,
          command: selectedCommand
        });
      }, 45 * 1e3);
      const promptChildTasks = scopedChildTasks.slice(
        0,
        MAX_CHILD_TASKS_IN_PROMPT
      );
      const extraChildCount = scopedChildTasks.length - promptChildTasks.length;
      const childTaskPromptBlock = promptChildTasks.length > 0 ? ` Parent task scope also includes child tasks: ${promptChildTasks.map((task) => `[${task.id}] ${task.title} (${task.status})`).join(
        "; "
      )}${extraChildCount > 0 ? `; plus ${extraChildCount} more` : ""}. Treat these as part of implementation scope and update them in \`vem_update.tasks\` when progress is made.` : "";
      const runnerInstructions = process.env.VEM_RUNNER_INSTRUCTIONS?.trim();
      const runnerInstructionsBlock = runnerInstructions ? ` Additional web-run instructions: ${runnerInstructions}.` : "";
      const agentPrompt = `You are working on task ${activeTask?.id || "N/A"}.${childTaskPromptBlock}${runnerInstructionsBlock} Read .vem/current_context.md for project context and .vem/task_context.md for task-specific context. STRICT MEMORY: if you make changes, you must provide a vem_update block that includes context (full updated CONTEXT.md), current_state, changelog_append, decisions_append, and tasks (array \u2014 use the field name "tasks", not "task_update": [{ "id": "${activeTask?.id || "TASK-ID"}", "status": "done", "evidence": [...], "task_context_summary": "..." }]). Complete the task using these instructions. When completing tasks, include your agent name and confirm required validation steps (build/tests) in evidence.`;
      if (baseCmd === "gemini" || baseCmd === "echo") {
        console.log(
          chalk7.cyan(`Auto-injecting context via --prompt-interactive...`)
        );
        launchArgs = ["-i", agentPrompt, ...launchArgs];
      } else if (baseCmd === "codex") {
        const codexSubcommands = /* @__PURE__ */ new Set([
          "exec",
          "e",
          "review",
          "login",
          "logout",
          "mcp",
          "mcp-server",
          "app-server",
          "completion",
          "sandbox",
          "debug",
          "apply",
          "a",
          "resume",
          "fork",
          "cloud",
          "features",
          "help"
        ]);
        const firstNonOption = launchArgs.find(
          (arg) => !arg.startsWith("-")
        );
        const isSubcommand = !!firstNonOption && codexSubcommands.has(firstNonOption);
        const hasPrompt = !!firstNonOption && !isSubcommand;
        if (!isSubcommand && !hasPrompt) {
          console.log(
            chalk7.cyan("Auto-injecting context via initial Codex prompt...")
          );
          launchArgs = [...launchArgs, agentPrompt];
        } else {
          console.log(
            chalk7.cyan(
              "Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) \u2014 use field name 'tasks', not 'task_update'."
            )
          );
        }
      } else if (baseCmd === "claude") {
        const claudeSubcommands = /* @__PURE__ */ new Set([
          "doctor",
          "install",
          "mcp",
          "plugin",
          "setup-token",
          "update",
          "upgrade"
        ]);
        const firstNonOption = launchArgs.find(
          (arg) => !arg.startsWith("-")
        );
        const isSubcommand = !!firstNonOption && claudeSubcommands.has(firstNonOption);
        const hasPrompt = !!firstNonOption && !isSubcommand;
        if (!isSubcommand) {
          console.log(
            chalk7.cyan(
              "Auto-injecting context via --append-system-prompt..."
            )
          );
          if (!hasPrompt) {
            const childScopeText = scopedChildTaskIds.length > 0 ? ` and child tasks ${scopedChildTaskIds.join(", ")}` : "";
            const initialPrompt = `Read .vem/current_context.md and .vem/task_context.md, then start working on task ${activeTask?.id}: ${activeTask?.title}${childScopeText}`;
            launchArgs = [
              "--append-system-prompt",
              agentPrompt,
              ...launchArgs,
              initialPrompt
            ];
          } else {
            launchArgs = [
              "--append-system-prompt",
              agentPrompt,
              ...launchArgs
            ];
          }
        } else {
          console.log(
            chalk7.cyan(
              "Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) \u2014 use field name 'tasks', not 'task_update'."
            )
          );
        }
      } else if (baseCmd === "copilot") {
        const firstNonOption = launchArgs.find(
          (arg) => !arg.startsWith("-")
        );
        const hasInteractiveFlag = launchArgs.some(
          (arg) => arg === "-i" || arg === "--interactive"
        );
        const hasPrompt = !!firstNonOption || hasInteractiveFlag;
        if (!hasPrompt) {
          const childScopeText = scopedChildTaskIds.length > 0 ? ` and child tasks ${scopedChildTaskIds.join(", ")}` : "";
          const autonomousPrompt = options.autoExit ? `${agentPrompt}

Your task is ${activeTask?.id}: ${activeTask?.title}${childScopeText}.

This is a fully autonomous session \u2014 you MUST complete the FULL implementation before exiting:
1. Read .vem/task_context.md and .vem/current_context.md for task and project context
2. Explore the repository (list dirs, read package.json and relevant source files)
3. Write ALL required code changes \u2014 create or edit files, do not just describe them
4. Run existing tests/builds to verify your changes compile and pass
5. Output the vem_update block only after all code changes are made

Start implementing NOW. Do NOT stop after reading context \u2014 proceed directly to writing code.` : `${agentPrompt}

Your task is ${activeTask?.id}: ${activeTask?.title}${childScopeText}.

Start by reading .vem/task_context.md and .vem/current_context.md for task and project context. Then explore the repository structure (list directories, read key files like package.json, README, and relevant source files) to understand the codebase before writing any code. Implement all required changes, run any existing tests or builds to verify, then provide the vem_update block.`;
          if (options.autoExit) {
            console.log(
              chalk7.cyan(
                "Auto-injecting context via -p flag (autonomous mode)..."
              )
            );
            launchArgs = [...launchArgs, "-p", autonomousPrompt, "--yolo"];
          } else {
            console.log(chalk7.cyan("Auto-injecting context via -i flag..."));
            launchArgs = [...launchArgs, "-i", autonomousPrompt];
          }
        } else {
          console.log(
            chalk7.cyan(
              "Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) \u2014 use field name 'tasks', not 'task_update'."
            )
          );
        }
      } else {
        console.log(
          chalk7.cyan(
            "Tip: Ask the agent to read .vem/current_context.md and .vem/task_context.md, and to return a vem_update block that includes context, current_state, changelog_append, decisions_append, and tasks (array: [{ id, status: 'done', evidence: [...], task_context_summary }]) \u2014 use field name 'tasks', not 'task_update'."
          )
        );
      }
      const exitSignalFile = join5(vemDir, "exit_signal");
      await unlink(exitSignalFile).catch(() => {
      });
      const child = spawn2(selectedCommand, launchArgs, {
        stdio: "inherit",
        // detached: put the child in its own process group so we can
        // kill the entire group (copilot + any LSP/daemon children it
        // spawns) after it exits, preventing orphaned processes from
        // holding the PTY slave open and blocking setsid --pty.
        detached: true,
        env: {
          ...process.env,
          VEM_ACTIVE_TASK: activeTask?.id || "",
          VEM_CHILD_TASK_IDS: scopedChildTaskIds.join(","),
          VEM_AGENT_NAME: agentName
        }
      });
      let startError = null;
      let exitCode = null;
      await new Promise((resolve3) => {
        child.on("exit", (code, signal) => {
          exitCode = code;
          if (code === null && signal) {
            console.error(
              chalk7.red(`Agent process killed by signal: ${signal}`)
            );
          }
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
          }
          resolve3();
        });
        child.on("error", (err) => {
          startError = err;
          resolve3();
        });
      });
      const capturedError = startError;
      if (capturedError?.code === "ENOENT") {
        const shell = process.env.SHELL || "/bin/zsh";
        const shellCommand = [selectedCommand, ...launchArgs].map((arg) => shellEscapeArg(arg)).join(" ");
        console.error(
          chalk7.red(`Failed to start agent: ${capturedError.message}`)
        );
        console.log(
          chalk7.yellow(
            `Retrying via ${shell} to resolve shell aliases/functions...`
          )
        );
        const shellChild = spawn2(shell, ["-ic", shellCommand], {
          stdio: "inherit",
          detached: true,
          env: {
            ...process.env,
            VEM_ACTIVE_TASK: activeTask?.id || "",
            VEM_CHILD_TASK_IDS: scopedChildTaskIds.join(","),
            VEM_AGENT_NAME: agentName
          }
        });
        const shellResult = await new Promise((resolve3) => {
          shellChild.on("exit", (code) => {
            try {
              process.kill(-shellChild.pid, "SIGTERM");
            } catch {
            }
            resolve3({ exitCode: code, error: null });
          });
          shellChild.on(
            "error",
            (err) => resolve3({ exitCode: null, error: err })
          );
        });
        if (shellResult.error) {
          startError = shellResult.error;
        } else {
          startError = null;
          exitCode = shellResult.exitCode;
        }
      }
      clearInterval(heartbeatInterval);
      await trackAgentSession("agent_stop", {
        agentName,
        taskId: activeTask?.id,
        command: selectedCommand
      });
      if (activeTask && gitRootForSessions) {
        try {
          const sessionsAfter = await listAllAgentSessions(gitRootForSessions);
          const newSession = sessionsAfter.find(
            (s) => !sessionIdsBefore.has(s.id)
          );
          if (newSession) {
            const localTask = await taskService.getTask(activeTask.id);
            const existingSessions = localTask?.sessions || [];
            const alreadyAttached = existingSessions.some(
              (s) => s.id === newSession.id
            );
            attachedSessionRef = {
              id: newSession.id,
              source: newSession.source,
              started_at: (/* @__PURE__ */ new Date()).toISOString(),
              summary: activeTask.title ?? newSession.summary
            };
            let updatedSessions;
            if (!alreadyAttached) {
              const filtered = existingSessions.filter(
                (s) => !sessionIdsBefore.has(s.id)
              );
              updatedSessions = [...filtered, attachedSessionRef];
            } else {
              updatedSessions = existingSessions;
            }
            const stats = await computeSessionStats(
              newSession.id,
              newSession.source
            );
            if (stats) {
              updatedSessions = updatedSessions.map(
                (s) => s.id === newSession.id ? { ...s, stats } : s
              );
              attachedSessionRef = { ...attachedSessionRef, stats };
              const parts = [];
              if (stats.tool_call_count != null)
                parts.push(`${stats.tool_call_count} tool calls`);
              if (stats.turn_count != null)
                parts.push(`${stats.turn_count} turns`);
              if (stats.session_duration_ms != null)
                parts.push(
                  `${Math.round(stats.session_duration_ms / 6e4)}m`
                );
              console.log(
                chalk7.gray(
                  `\u{1F4CA} Session stats: ${parts.join(", ") || "computed"}`
                )
              );
            }
            if (localTask) {
              await taskService.updateTask(activeTask.id, {
                sessions: updatedSessions
              });
            }
            await updateTaskMetaRemote(
              configService,
              activeTask,
              { sessions: updatedSessions }
            );
            console.log(
              chalk7.gray(
                `\u{1F4CE} Session ${newSession.id.slice(0, 8)} attached to ${activeTask.id}`
              )
            );
          }
        } catch {
        }
      }
      if (startError) {
        console.error(
          chalk7.red(`Failed to start agent: ${startError.message}`)
        );
        if (startError.code === "ENOENT") {
          console.error(
            chalk7.yellow(
              `Command "${selectedCommand}" was not found in PATH. Run \`vem agent\` to select an installed tool, or install ${selectedCommand}.`
            )
          );
        }
        return;
      }
      console.log(chalk7.gray(`
Agent exited with code ${exitCode}
`));
      let dynamicAutoExit = false;
      try {
        await access(exitSignalFile);
        dynamicAutoExit = true;
        await unlink(exitSignalFile);
        console.log(
          chalk7.cyan("\u{1F44B} Received dynamic exit signal from agent.")
        );
      } catch {
      }
      let shouldAutoExit = options.autoExit || dynamicAutoExit;
      const updateFile = await detectVemUpdateInOutput(vemDir);
      let parsedAgentUpdate = null;
      let appliedUpdateResult = null;
      if (updateFile) {
        console.log(
          chalk7.cyan("\u{1F4DD} Detected vem_update block in agent output")
        );
        try {
          const content = await readFile4(updateFile, "utf-8");
          parsedAgentUpdate = parseVemUpdateBlock(content);
        } catch (error) {
          console.error(
            chalk7.red("Failed to parse vem_update block:"),
            error.message
          );
          console.log(
            chalk7.yellow(
              `You can manually inspect/update it later: vem finalize -f ${updateFile}`
            )
          );
        }
        if (parsedAgentUpdate) {
          if (shouldAutoExit) {
            console.log(
              chalk7.gray(
                `  (Auto-applying due to ${dynamicAutoExit ? "dynamic signal" : "--auto-exit"})`
              )
            );
          }
          try {
            appliedUpdateResult = await applyVemUpdate(parsedAgentUpdate);
            console.log(chalk7.green("\u2714 Applied vem_update"));
            await syncParsedTaskUpdatesToRemote(
              configService,
              parsedAgentUpdate,
              appliedUpdateResult,
              activeTask
            );
            const syncedMemory = await syncProjectMemoryToRemote();
            if (syncedMemory) {
              console.log(chalk7.gray("\u2714 Synced vem_update memory to cloud"));
            }
            await trackCommandUsage("finalize");
            const taskMarkedDoneInUpdate = appliedUpdateResult?.updatedTasks?.some(
              (t) => t.id === activeTask?.id && t.status === "done"
            );
            if (taskMarkedDoneInUpdate && !shouldAutoExit) {
              shouldAutoExit = true;
              console.log(
                chalk7.cyan(
                  "\u2714 Task marked done via vem_update \u2014 auto-closing."
                )
              );
            }
          } catch (error) {
            console.error(
              chalk7.red("Failed to apply update:"),
              error.message
            );
            console.log(
              chalk7.yellow(
                `You can manually apply it later: vem finalize -f ${updateFile}`
              )
            );
          }
        }
      }
      if (shouldAutoExit) {
        const wasTaskCompleted = appliedUpdateResult?.updatedTasks?.some(
          (t) => t.id === activeTask?.id && t.status === "done"
        );
        let taskDoneViaMcp = false;
        if (dynamicAutoExit && activeTask && !wasTaskCompleted) {
          const liveTasks = await taskService.getTasks();
          const liveTask = liveTasks.find((t) => t.id === activeTask.id);
          taskDoneViaMcp = liveTask?.status === "done";
        }
        if (wasTaskCompleted || taskDoneViaMcp) {
          console.log(
            chalk7.green(
              `\u2714 Task ${activeTask?.id} was marked as done${taskDoneViaMcp ? " via MCP" : " in the update"}.`
            )
          );
        } else if (activeTask) {
          console.log(
            chalk7.yellow(
              `\u26A0 Task ${activeTask.id} remains ${activeTask.status}. Use vem_update 'tasks' field to mark it 'done' with evidence.`
            )
          );
        }
        await enforceStrictMemoryUpdates(sessionStartedAt, strictMemory, {
          agentUpdate: parsedAgentUpdate,
          onAdditionalNotes: async (notes) => {
            if (!activeTask) return;
            await appendTaskNotesToContext(configService, activeTask, notes);
          }
        });
        if (strictMemory) {
          await trackFeatureUsage("strict_memory");
        }
        console.log(
          chalk7.gray(
            "\nTip: Run `vem push` to save your memory progress to the cloud.\n"
          )
        );
        if (!dynamicAutoExit)
          console.log(chalk7.blue("\n\u{1F44B} Auto-exiting as requested."));
        return;
      }
      const freshTasks = await taskService.getTasks();
      let localActiveTask = activeTask ? freshTasks.find((t) => t.id === activeTask.id) : void 0;
      const remoteActiveTask = activeTask?.db_id ? await fetchRemoteAgentTaskById(
        configService,
        activeTask.id,
        activeTask.db_id
      ) : null;
      if (localActiveTask && remoteActiveTask && localActiveTask.status !== remoteActiveTask.status) {
        await taskService.updateTask(localActiveTask.id, {
          status: remoteActiveTask.status
        });
        localActiveTask = {
          ...localActiveTask,
          status: remoteActiveTask.status
        };
      }
      const freshActiveTask = remoteActiveTask ?? localActiveTask ?? (activeTask ? activeTask : void 0);
      debugAgentSync(
        "post-run candidate:",
        `active=${activeTask?.id ?? "none"}`,
        `local=${localActiveTask?.id ?? "none"}`,
        `remote=${remoteActiveTask?.id ?? "none"}`,
        `resolved=${freshActiveTask?.id ?? "none"}`,
        `status=${freshActiveTask?.status ?? "none"}`
      );
      if (freshActiveTask && freshActiveTask.status !== "done") {
        const postRun = await prompts4({
          type: "confirm",
          name: "done",
          message: `Did you complete task ${freshActiveTask.id}?`,
          initial: false
        });
        if (postRun.done) {
          const evidence = await prompts4({
            type: "text",
            name: "desc",
            message: "Briefly describe what was done (evidence):",
            initial: "Completed via agent session"
          });
          let reasoningText = "";
          const reasoning = await prompts4({
            type: "text",
            name: "text",
            message: "Reasoning for completion (leave empty to auto-generate):"
          });
          reasoningText = reasoning.text;
          let contextSummary;
          if (freshActiveTask.task_context) {
            const summary = await prompts4({
              type: "text",
              name: "text",
              message: "Provide a brief task context summary to keep after completion (optional):"
            });
            contextSummary = summary.text || void 0;
          }
          if (!reasoningText || reasoningText.trim() === "") {
            console.log(chalk7.blue("\u{1F916} Auto-generating reasoning..."));
            try {
              const prompt = `Generate a concise one-sentence reasoning for completing task "${freshActiveTask.title}". Evidence: "${evidence.desc}". Return ONLY the sentence.`;
              if (baseCmd === "gemini" || baseCmd === "claude" || baseCmd === "echo") {
                const genChild = spawn2(
                  selectedCommand,
                  [...args || [], prompt],
                  {
                    stdio: ["ignore", "pipe", "ignore"]
                  }
                );
                let output = "";
                for await (const chunk of genChild.stdout) {
                  output += chunk;
                }
                reasoningText = output.trim() || "Automated completion via agent";
              } else {
                reasoningText = "Automated completion via agent session";
              }
              console.log(chalk7.gray(`Generated: ${reasoningText}`));
            } catch (_e) {
              console.error(
                chalk7.yellow(
                  "Failed to auto-generate reasoning. Using default."
                )
              );
              reasoningText = "Completed via agent session";
            }
          }
          const requiredValidation = freshActiveTask.validation_steps ?? [];
          if (requiredValidation.length > 0) {
            const confirmed = [];
            for (const step of requiredValidation) {
              const response = await prompts4({
                type: "confirm",
                name: "done",
                message: `Validation step completed? ${step}`,
                initial: true
              });
              if (!response.done) {
                console.log(
                  chalk7.yellow(
                    "Task completion cancelled. Complete all validation steps first."
                  )
                );
                return;
              }
              confirmed.push(step);
            }
            for (const step of confirmed) {
              const entry = `Validated: ${step}`;
              if (!evidence.desc.includes(entry)) {
                evidence.desc = `${evidence.desc}
${entry}`;
              }
            }
          }
          if (localActiveTask) {
            await taskService.updateTask(freshActiveTask.id, {
              status: "done",
              evidence: [evidence.desc],
              reasoning: reasoningText,
              task_context_summary: contextSummary,
              actor: agentName
            });
          }
          const remoteTaskRef = freshActiveTask ?? activeTask;
          const remoteMetaUpdated = await updateTaskMetaRemote(
            configService,
            remoteTaskRef,
            {
              status: "done",
              evidence: [evidence.desc],
              reasoning: reasoningText,
              actor: agentName,
              ...contextSummary !== void 0 ? { task_context_summary: contextSummary || null } : {}
            }
          );
          activeTask.status = "done";
          if (!remoteMetaUpdated) {
            console.log(
              chalk7.yellow(
                "  \u26A0 Could not sync done status to cloud. Local cache was updated."
              )
            );
          }
          console.log(
            chalk7.green(
              `
\u2714 Task ${freshActiveTask.id} marked as done${remoteMetaUpdated ? " (cloud + local cache)" : " (local cache)"}.`
            )
          );
        } else {
          const statusCheck = await prompts4({
            type: "select",
            name: "status",
            message: "Update task status?",
            choices: [
              { title: "Keep In Progress", value: "in-progress" },
              { title: "Move to Blocked", value: "blocked" },
              { title: "Move to Todo (Pause)", value: "todo" }
            ]
          });
          if (statusCheck.status && statusCheck.status !== activeTask.status) {
            if (localActiveTask) {
              await taskService.updateTask(activeTask.id, {
                status: statusCheck.status
              });
            }
            const remoteStatusUpdated = await updateTaskMetaRemote(
              configService,
              activeTask,
              {
                status: statusCheck.status,
                reasoning: "Updated via vem agent post-run prompt",
                actor: agentName
              }
            );
            activeTask.status = statusCheck.status;
            if (!remoteStatusUpdated) {
              console.log(
                chalk7.yellow(
                  "  \u26A0 Could not sync status to cloud. Local cache was updated."
                )
              );
            }
            console.log(
              chalk7.green(`
\u2714 Task status updated to ${statusCheck.status}`)
            );
          }
        }
      }
      await enforceStrictMemoryUpdates(sessionStartedAt, strictMemory, {
        agentUpdate: parsedAgentUpdate,
        onAdditionalNotes: async (notes) => {
          if (!activeTask) return;
          await appendTaskNotesToContext(configService, activeTask, notes);
        }
      });
      if (strictMemory) {
        await trackFeatureUsage("strict_memory");
      }
      console.log(
        chalk7.gray(
          "\nTip: Run `vem push` to save your memory progress to the cloud.\n"
        )
      );
    } catch (error) {
      console.error(chalk7.red("Agent Wrapper Error:"), error.message);
    }
  });
}

// src/commands/auth.ts
import http from "http";
import chalk8 from "chalk";
function registerAuthCommands(program2) {
  program2.command("logout").description("Clear your API Key and logout from CLI").action(async () => {
    try {
      const configService = new ConfigService();
      await configService.setApiKey(null);
      console.log(chalk8.green("\n\u2714 Logged out successfully\n"));
    } catch (error) {
      console.error(chalk8.red("\n\u2716 Logout Failed:"), error.message);
    }
  });
  program2.command("login [key]").description("Authenticate CLI with your API Key").action(async (key) => {
    try {
      const configService = new ConfigService();
      if (key) {
        await configService.setApiKey(key);
        console.log(chalk8.green("\n\u2714 API Key saved successfully\n"));
        return;
      }
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        if (req.method === "OPTIONS") {
          res.writeHead(200);
          res.end();
          return;
        }
        if (url.pathname === "/callback") {
          const receivedKey = url.searchParams.get("key");
          if (receivedKey) {
            await configService.setApiKey(receivedKey);
            try {
              const API_URL2 = "https://api.vem.dev";
              const headers = await buildDeviceHeaders(configService);
              await fetch(`${API_URL2}/verify`, {
                headers: {
                  Authorization: `Bearer ${receivedKey}`,
                  ...headers
                }
              });
              console.log(chalk8.gray("   Device registered successfully."));
            } catch (_e) {
              console.log(
                chalk8.yellow(
                  "   \u26A0 Could not verify key with server immediately."
                )
              );
            }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.write(`
							<html>
								<head>
 									<title>vem Login Successful</title>
									<meta charset="UTF-8">
									<meta name="viewport" content="width=device-width, initial-scale=1.0">
									<link rel="preconnect" href="https://fonts.googleapis.com">
									<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
									<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
									<link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none"><rect x="18" y="46" width="74" height="44" rx="12" stroke="%234ade80" stroke-width="6" opacity="0.9" /><rect x="30" y="32" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.6" /><rect x="42" y="18" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.35" /></svg>'>
								</head>
								<body style="background-color: #0a0a0a; color: #ffffff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0;">
									<div style="text-align: center; background: #171717; padding: 48px; border-radius: 16px; border: 1px solid #262626; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); max-width: 400px; width: 100%;">
										
										<!-- Brand Logo -->
										<div style="margin-bottom: 24px; display: flex; justify-content: center; align-items: center; gap: 12px;">
											<svg width="48" height="48" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
												<rect x="18" y="46" width="74" height="44" rx="12" stroke="#4ade80" stroke-width="6" opacity="0.9" />
												<rect x="30" y="32" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.6" />
												<rect x="42" y="18" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.35" />
											</svg>
											<span style="font-family: 'Space Grotesk', sans-serif; font-size: 32px; font-weight: 700; letter-spacing: -1px; color: #fff;">vem</span>
										</div>

										<h1 style="color: #4ade80; margin: 0 0 12px 0; font-size: 20px; font-weight: 600;">Login Successful</h1>
										<p style="color: #a3a3a3; margin: 0 0 32px 0; line-height: 1.5;">Your CLI is now authenticated.</p>
										
										<div style="font-size: 13px; color: #525252; padding-top: 20px; border-top: 1px solid #262626;">
											You can close this tab and return to your terminal.
										</div>
									</div>
									<script>setTimeout(() => window.close(), 3000);</script>
								</body>
							</html>
						`);
            res.end();
            console.log(chalk8.green("\n\u2714 Login successful! API Key saved."));
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 500);
          } else {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Missing key parameter.");
            console.error(
              chalk8.red("\n\u2716 Callback received but no key found.")
            );
            server.close();
            process.exit(1);
          }
        } else {
          res.writeHead(404);
          res.end("Not Found");
        }
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          const port = addr.port;
          configService.getOrCreateDeviceId().then(({ deviceId, deviceName }) => {
            const loginUrl = `${WEB_URL}/cli/login?port=${port}&deviceId=${deviceId}&deviceName=${encodeURIComponent(deviceName)}`;
            console.log(chalk8.blue(`
\u{1F310} Opening browser to: ${loginUrl}`));
            console.log(
              chalk8.gray(`   (Listening on port ${port} for callback)`)
            );
            openBrowser(loginUrl);
          });
        }
      });
    } catch (error) {
      console.error(chalk8.red("Failed to save key:"), error);
    }
  });
}

// src/commands/cycle.ts
import chalk9 from "chalk";
import Table from "cli-table3";
var APPETITE_LABELS = {
  small: "~1 week",
  medium: "~2 weeks",
  large: "~4\u20136 weeks"
};
var STATUS_LABEL = {
  planned: chalk9.gray("PLANNED"),
  active: chalk9.cyan("ACTIVE"),
  closed: chalk9.green("CLOSED")
};
function registerCycleCommands(program2) {
  const cycleCmd = program2.command("cycle").description("Manage goal cycles (Context-Flow)");
  cycleCmd.command("list").description("List all cycles").action(async () => {
    await trackCommandUsage("cycle list");
    try {
      const cycles = await cycleService.getCycles();
      if (cycles.length === 0) {
        console.log(
          chalk9.gray(
            "\n  No cycles yet. Create one with: vem cycle create\n"
          )
        );
        return;
      }
      const table = new Table({
        head: ["ID", "Status", "Name", "Goal", "Appetite", "Start"],
        style: { head: ["cyan"] },
        colWidths: [12, 10, 24, 40, 12, 14],
        wordWrap: true
      });
      for (const c of cycles) {
        table.push([
          chalk9.white(c.id),
          STATUS_LABEL[c.status] ?? chalk9.gray(c.status),
          c.name,
          chalk9.gray(c.goal.length > 38 ? `${c.goal.slice(0, 38)}\u2026` : c.goal),
          c.appetite ? chalk9.gray(APPETITE_LABELS[c.appetite] ?? c.appetite) : chalk9.gray("\u2014"),
          c.start_at ? chalk9.white(
            new Date(c.start_at).toLocaleDateString(void 0, {
              month: "short",
              day: "numeric"
            })
          ) : chalk9.gray("\u2014")
        ]);
      }
      console.log(chalk9.bold("\n\u{1F504}  Cycles\n"));
      console.log(table.toString());
      console.log();
    } catch (error) {
      console.error(chalk9.red(`Failed to list cycles: ${error.message}`));
    }
  });
  cycleCmd.command("create [name]").description("Create a new goal cycle").option(
    "--goal <text>",
    "The outcome this cycle is working towards (required)"
  ).option(
    "--appetite <size>",
    "Time budget: small (~1w), medium (~2w), large (~4-6w)"
  ).option("--start-at <iso>", "Start date ISO string (YYYY-MM-DD)").action(async (name, options) => {
    await trackCommandUsage("cycle create");
    try {
      const cycleName = typeof name === "string" && name.trim().length > 0 ? name.trim() : void 0;
      const goalInput = typeof options.goal === "string" ? options.goal.trim() : void 0;
      const appetiteInput = typeof options.appetite === "string" ? options.appetite.trim() : void 0;
      if (!cycleName || !goalInput) {
        console.error(
          chalk9.red(
            '\n\u2716 Both a name and --goal are required.\n  Example: vem cycle create "Auth hardening" --goal "Harden auth flows and add MFA" --appetite medium\n'
          )
        );
        process.exitCode = 1;
        return;
      }
      const validAppetites = /* @__PURE__ */ new Set(["small", "medium", "large"]);
      if (appetiteInput && !validAppetites.has(appetiteInput)) {
        console.error(
          chalk9.red(
            `
\u2716 Invalid appetite "${appetiteInput}". Use: small, medium, large
`
          )
        );
        process.exitCode = 1;
        return;
      }
      const startAt = typeof options.startAt === "string" && options.startAt.trim() ? new Date(
        options.startAt.length === 10 ? `${options.startAt}T00:00:00.000Z` : options.startAt
      ).toISOString() : void 0;
      const cycle = await cycleService.createCycle({
        name: cycleName,
        goal: goalInput,
        appetite: appetiteInput,
        start_at: startAt
      });
      console.log(chalk9.green(`
\u2714 Cycle created: ${cycle.id}
`));
      console.log(`  ${chalk9.white(cycle.name)}`);
      console.log(`  ${chalk9.gray("Goal:")} ${cycle.goal}`);
      if (cycle.appetite) {
        console.log(
          `  ${chalk9.gray("Appetite:")} ${APPETITE_LABELS[cycle.appetite] ?? cycle.appetite}`
        );
      }
      console.log(
        chalk9.gray(
          `
  Tip: Start it with \`vem cycle start ${cycle.id}\` then assign tasks with \`vem task update <id> --cycle ${cycle.id}\`
`
        )
      );
    } catch (error) {
      console.error(chalk9.red(`Failed to create cycle: ${error.message}`));
    }
  });
  cycleCmd.command("start <id>").description("Mark a cycle as active").action(async (id) => {
    await trackCommandUsage("cycle start");
    try {
      const cycle = await cycleService.getCycle(id);
      if (!cycle) {
        console.error(chalk9.red(`
\u2716 Cycle ${id} not found.
`));
        process.exitCode = 1;
        return;
      }
      if (cycle.status === "active") {
        console.log(chalk9.yellow(`
  Cycle ${id} is already active.
`));
        return;
      }
      const existing = await cycleService.getActiveCycle();
      if (existing && existing.id !== id) {
        console.error(
          chalk9.yellow(
            `
\u26A0  Another cycle is already active: ${existing.id} (${existing.name})
  Close it first with: vem cycle close ${existing.id}
`
          )
        );
        process.exitCode = 1;
        return;
      }
      const updated = await cycleService.updateCycle(id, {
        status: "active"
      });
      console.log(chalk9.cyan(`
\u2714 Cycle ${id} is now active
`));
      console.log(`  ${chalk9.white(updated.name)}`);
      console.log(`  ${chalk9.gray("Goal:")} ${updated.goal}`);
      console.log();
    } catch (error) {
      console.error(chalk9.red(`Failed to start cycle: ${error.message}`));
    }
  });
  cycleCmd.command("close <id>").description("Close a cycle").action(async (id) => {
    await trackCommandUsage("cycle close");
    try {
      const cycle = await cycleService.getCycle(id);
      if (!cycle) {
        console.error(chalk9.red(`
\u2716 Cycle ${id} not found.
`));
        process.exitCode = 1;
        return;
      }
      if (cycle.status === "closed") {
        console.log(chalk9.yellow(`
  Cycle ${id} is already closed.
`));
        return;
      }
      const updated = await cycleService.updateCycle(id, {
        status: "closed"
      });
      console.log(chalk9.green(`
\u2714 Cycle ${id} closed
`));
      const tasks = await taskService.getTasks();
      const cycleTasks = tasks.filter(
        (t) => t.cycle_id === id && !t.deleted_at
      );
      if (cycleTasks.length > 0) {
        const done = cycleTasks.filter((t) => t.status === "done").length;
        const total = cycleTasks.length;
        console.log(
          `  ${chalk9.gray("Tasks:")} ${chalk9.green(String(done))} done / ${chalk9.white(String(total))} total`
        );
      }
      console.log(
        chalk9.gray(
          `  Closed: ${new Date(updated.closed_at).toLocaleDateString()}
`
        )
      );
    } catch (error) {
      console.error(chalk9.red(`Failed to close cycle: ${error.message}`));
    }
  });
  cycleCmd.command("focus [id]").description(
    "Show focused view: active cycle goal + its tasks (defaults to active cycle)"
  ).action(async (id) => {
    await trackCommandUsage("cycle focus");
    try {
      let cycle = null;
      if (id) {
        cycle = await cycleService.getCycle(id);
        if (!cycle) {
          console.error(chalk9.red(`
\u2716 Cycle ${id} not found.
`));
          process.exitCode = 1;
          return;
        }
      } else {
        cycle = await cycleService.getActiveCycle();
        if (!cycle) {
          console.log(
            chalk9.yellow(
              "\n  No active cycle. Start one with: vem cycle start <id>\n"
            )
          );
          return;
        }
      }
      console.log(chalk9.bold(`
\u{1F3AF}  ${cycle.id}: ${cycle.name}
`));
      console.log(
        `  ${chalk9.gray("Status:")} ${STATUS_LABEL[cycle.status] ?? chalk9.gray(cycle.status)}`
      );
      console.log(`  ${chalk9.gray("Goal:")}   ${chalk9.white(cycle.goal)}`);
      if (cycle.appetite) {
        console.log(
          `  ${chalk9.gray("Appetite:")} ${APPETITE_LABELS[cycle.appetite] ?? cycle.appetite}`
        );
      }
      if (cycle.start_at) {
        console.log(
          `  ${chalk9.gray("Started:")} ${new Date(cycle.start_at).toLocaleDateString()}`
        );
      }
      const tasks = await taskService.getTasks();
      const cycleTasks = tasks.filter(
        (t) => t.cycle_id === cycle.id && !t.deleted_at
      );
      if (cycleTasks.length === 0) {
        console.log(
          chalk9.gray(
            `
  No tasks assigned to this cycle yet.
  Assign with: vem task update <id> --cycle ${cycle.id}
`
          )
        );
        return;
      }
      const statusOrder = {
        "in-progress": 0,
        "in-review": 1,
        ready: 2,
        todo: 3,
        blocked: 4,
        done: 5
      };
      cycleTasks.sort(
        (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
      );
      const table = new Table({
        head: ["ID", "Status", "Title", "Priority", "Score"],
        style: { head: ["cyan"] },
        colWidths: [12, 10, 44, 10, 8],
        wordWrap: true
      });
      const fmtStatus = (s) => {
        switch (s) {
          case "in-progress":
            return chalk9.blue("IN PROG");
          case "in-review":
            return chalk9.magenta("IN REVW");
          case "ready":
            return chalk9.cyan("READY");
          case "blocked":
            return chalk9.yellow("BLOCKED");
          case "done":
            return chalk9.green("DONE");
          default:
            return chalk9.gray("TODO");
        }
      };
      for (const t of cycleTasks) {
        const score = t.impact_score;
        table.push([
          chalk9.white(t.id),
          fmtStatus(t.status),
          t.title,
          t.priority ? t.priority === "high" || t.priority === "critical" ? chalk9.red(t.priority) : chalk9.white(t.priority) : chalk9.gray("\u2014"),
          score !== void 0 ? chalk9.yellow(String(Math.round(score))) : chalk9.gray("\u2014")
        ]);
      }
      const done = cycleTasks.filter((t) => t.status === "done").length;
      console.log(
        `
  ${chalk9.white(String(done))}/${chalk9.white(String(cycleTasks.length))} tasks done
`
      );
      console.log(table.toString());
      console.log();
    } catch (error) {
      console.error(
        chalk9.red(`Failed to show cycle focus: ${error.message}`)
      );
    }
  });
}

// src/commands/instructions.ts
import * as fs2 from "fs/promises";
import * as path from "path";
import chalk10 from "chalk";
import prompts5 from "prompts";
async function getRepoRoot2() {
  const { execSync: execSync4 } = await import("child_process");
  try {
    return execSync4("git rev-parse --show-toplevel", {
      encoding: "utf-8"
    }).trim();
  } catch {
    return process.cwd();
  }
}
async function readLocalInstructions() {
  const repoRoot = await getRepoRoot2();
  const result = [];
  for (const relativePath of KNOWN_AGENT_INSTRUCTION_FILES) {
    const absPath = path.join(repoRoot, relativePath);
    try {
      const content = await fs2.readFile(absPath, "utf-8");
      result.push({ path: relativePath, content });
    } catch {
    }
  }
  return result;
}
function registerInstructionCommands(program2) {
  const instructionsCmd = program2.command("instructions").alias("instr").description("Manage and sync agent instruction files");
  instructionsCmd.command("pull").description(
    "Pull the latest instructions from the cloud and write them to local files"
  ).option("-f, --force", "Overwrite local files without prompt").action(async (options) => {
    await trackCommandUsage("instructions.pull");
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk10.red(
            "Error: No project linked. Run `vem link <projectId>` first."
          )
        );
        process.exitCode = 1;
        return;
      }
      console.log(chalk10.blue("\u2B07  Fetching instructions from cloud..."));
      const res = await fetch(
        `${API_URL}/projects/${projectId}/instructions`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            ...await buildDeviceHeaders(configService)
          }
        }
      );
      if (!res.ok) {
        const data2 = await res.json().catch(() => ({}));
        throw new Error(
          `API Error ${res.status}: ${data2.error || res.statusText}`
        );
      }
      const data = await res.json();
      const instructions = data.instructions ?? [];
      if (instructions.length === 0) {
        console.log(
          chalk10.yellow("No instructions configured for this project.")
        );
        return;
      }
      const repoRoot = await getRepoRoot2();
      let written = 0;
      let skipped = 0;
      for (const entry of instructions) {
        if (typeof entry.path !== "string" || typeof entry.content !== "string")
          continue;
        if (!entry.content.trim()) continue;
        const dest = path.resolve(repoRoot, entry.path);
        const resolvedRoot = path.resolve(repoRoot);
        if (!dest.startsWith(`${resolvedRoot}${path.sep}`) && dest !== resolvedRoot) {
          console.warn(chalk10.yellow(`Skipping unsafe path: ${entry.path}`));
          continue;
        }
        if (!options.force) {
          const fileExists = await fs2.access(dest).then(() => true).catch(() => false);
          if (fileExists) {
            const { overwrite } = await prompts5({
              type: "confirm",
              name: "overwrite",
              message: `File ${entry.path} (${dest}) already exists. Overwrite?`,
              initial: false
            });
            if (!overwrite) {
              console.log(chalk10.yellow(`  \u2298 Skipped ${entry.path}`));
              skipped++;
              continue;
            }
          }
        }
        await fs2.mkdir(path.dirname(dest), { recursive: true });
        await fs2.writeFile(dest, entry.content, "utf-8");
        console.log(chalk10.green(`  \u2714 ${entry.path}`));
        written++;
      }
      const skippedMsg = skipped > 0 ? `, ${skipped} skipped` : "";
      console.log(
        chalk10.green(
          `
\u2714 Pulled ${written} instruction file(s)${skippedMsg}.
`
        )
      );
    } catch (error) {
      console.error(
        chalk10.red("\n\u2716 Instructions pull failed:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exitCode = 1;
    }
  });
  instructionsCmd.command("push").description("Push local instruction files to the cloud").option("-m, --message <msg>", "Commit message for this version").action(async (options) => {
    await trackCommandUsage("instructions.push");
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk10.red(
            "Error: No project linked. Run `vem link <projectId>` first."
          )
        );
        process.exitCode = 1;
        return;
      }
      const localInstructions = await readLocalInstructions();
      if (localInstructions.length === 0) {
        console.log(
          chalk10.yellow("No instruction files found locally. Looked for:")
        );
        for (const f of KNOWN_AGENT_INSTRUCTION_FILES) {
          console.log(chalk10.gray(`  ${f}`));
        }
        return;
      }
      console.log(
        chalk10.blue(
          `\u2B06  Pushing ${localInstructions.length} instruction file(s)...`
        )
      );
      const res = await fetch(
        `${API_URL}/projects/${projectId}/instructions`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            ...await buildDeviceHeaders(configService)
          },
          body: JSON.stringify({
            instructions: localInstructions,
            commit_message: options.message
          })
        }
      );
      if (!res.ok) {
        const data2 = await res.json().catch(() => ({}));
        throw new Error(
          `API Error ${res.status}: ${data2.error || res.statusText}`
        );
      }
      const data = await res.json();
      for (const entry of localInstructions) {
        console.log(chalk10.green(`  \u2714 ${entry.path}`));
      }
      const versionNote = data.version_number ? ` (saved as v${data.version_number})` : "";
      console.log(chalk10.green(`
\u2714 Instructions pushed${versionNote}.
`));
    } catch (error) {
      console.error(
        chalk10.red("\n\u2716 Instructions push failed:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exitCode = 1;
    }
  });
  instructionsCmd.command("status").description("Check if local instruction files are in sync with the cloud").action(async () => {
    await trackCommandUsage("instructions.status");
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk10.red(
            "Error: No project linked. Run `vem link <projectId>` first."
          )
        );
        process.exitCode = 1;
        return;
      }
      const [localInstructions, cloudRes] = await Promise.all([
        readLocalInstructions(),
        fetch(`${API_URL}/projects/${projectId}/instructions`, {
          headers: {
            Authorization: `Bearer ${key}`,
            ...await buildDeviceHeaders(configService)
          }
        })
      ]);
      if (!cloudRes.ok) {
        const data = await cloudRes.json().catch(() => ({}));
        throw new Error(
          `API Error ${cloudRes.status}: ${data.error || cloudRes.statusText}`
        );
      }
      const cloudData = await cloudRes.json();
      const cloudInstructions = cloudData.instructions ?? [];
      const localMap = new Map(
        localInstructions.map((e) => [e.path, e.content])
      );
      const cloudMap = new Map(
        cloudInstructions.map((e) => [e.path, e.content])
      );
      const allPaths = /* @__PURE__ */ new Set([...localMap.keys(), ...cloudMap.keys()]);
      let inSync = true;
      console.log(chalk10.bold("\nInstruction file sync status:\n"));
      for (const filePath of [...allPaths].sort()) {
        const local = localMap.get(filePath);
        const cloud = cloudMap.get(filePath);
        if (local === void 0) {
          console.log(
            chalk10.yellow(`  \u2193 ${filePath}`) + chalk10.gray(" (cloud only \u2014 run `vem instructions pull`)")
          );
          inSync = false;
        } else if (cloud === void 0) {
          console.log(
            chalk10.cyan(`  \u2191 ${filePath}`) + chalk10.gray(" (local only \u2014 run `vem instructions push`)")
          );
          inSync = false;
        } else if (local !== cloud) {
          console.log(
            chalk10.magenta(`  \u2260 ${filePath}`) + chalk10.gray(" (differs \u2014 run pull or push to sync)")
          );
          inSync = false;
        } else {
          console.log(
            chalk10.green(`  \u2714 ${filePath}`) + chalk10.gray(" (in sync)")
          );
        }
      }
      if (allPaths.size === 0) {
        console.log(chalk10.gray("  No instructions configured."));
      }
      console.log(
        inSync ? chalk10.green("\n\u2714 All instruction files are in sync.\n") : chalk10.yellow("\n\u26A0 Some instruction files are out of sync.\n")
      );
    } catch (error) {
      console.error(
        chalk10.red("\n\u2716 Instructions status check failed:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exitCode = 1;
    }
  });
  instructionsCmd.command("versions").description("List instruction version history from the cloud").option("-n, --limit <n>", "Maximum number of versions to show", "20").action(async (options) => {
    await trackCommandUsage("instructions.versions");
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk10.red(
            "Error: No project linked. Run `vem link <projectId>` first."
          )
        );
        process.exitCode = 1;
        return;
      }
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(options.limit ?? "20", 10) || 20)
      );
      const res = await fetch(
        `${API_URL}/projects/${projectId}/instructions/versions?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            ...await buildDeviceHeaders(configService)
          }
        }
      );
      if (!res.ok) {
        const data2 = await res.json().catch(() => ({}));
        throw new Error(
          `API Error ${res.status}: ${data2.error || res.statusText}`
        );
      }
      const data = await res.json();
      const versions = data.versions ?? [];
      if (versions.length === 0) {
        console.log(chalk10.yellow("No instruction versions found."));
        return;
      }
      console.log(chalk10.bold("\nInstruction Version History:\n"));
      for (const [index, version] of versions.entries()) {
        const isLatest = index === 0;
        const date = new Date(version.created_at).toLocaleString();
        const tag = isLatest ? chalk10.green(" [current]") : "";
        const msg = version.commit_message ? chalk10.gray(` \u2014 ${version.commit_message}`) : "";
        const author = version.author ? chalk10.gray(` by ${version.author}`) : "";
        console.log(
          `  ${chalk10.bold(`v${version.version_number}`)}${tag}${msg}${author}`
        );
        console.log(chalk10.gray(`    ${date} \xB7 id: ${version.id}`));
      }
      console.log();
    } catch (error) {
      console.error(
        chalk10.red("\n\u2716 Failed to fetch versions:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exitCode = 1;
    }
  });
  instructionsCmd.command("revert <versionId>").description("Revert instructions to a specific version by version ID").action(async (versionId) => {
    await trackCommandUsage("instructions.revert");
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk10.red(
            "Error: No project linked. Run `vem link <projectId>` first."
          )
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        chalk10.blue(`\u27F2  Reverting instructions to version ${versionId}...`)
      );
      const res = await fetch(
        `${API_URL}/projects/${projectId}/instructions/versions/${versionId}/revert`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            ...await buildDeviceHeaders(configService)
          }
        }
      );
      if (!res.ok) {
        const data2 = await res.json().catch(() => ({}));
        throw new Error(
          `API Error ${res.status}: ${data2.error || res.statusText}`
        );
      }
      const data = await res.json();
      console.log(
        chalk10.green(
          `\u2714 Reverted to v${data.reverted_from} (new version: v${data.version_number})`
        )
      );
      console.log(
        chalk10.gray("  Run `vem instructions pull` to update local files.")
      );
    } catch (error) {
      console.error(
        chalk10.red("\n\u2716 Revert failed:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exitCode = 1;
    }
  });
}

// src/commands/maintenance.ts
import { execSync as execSync3 } from "child_process";
import path2 from "path";
import chalk11 from "chalk";
import fs3 from "fs-extra";
function registerMaintenanceCommands(program2) {
  const getCurrentStateFromLocalCache = async () => {
    try {
      const vemDir = await getVemDir();
      const currentStatePath = path2.join(vemDir, CURRENT_STATE_FILE);
      if (!await fs3.pathExists(currentStatePath)) return "";
      return await fs3.readFile(currentStatePath, "utf-8");
    } catch {
      return "";
    }
  };
  const writeCurrentStateToLocalCache = async (content) => {
    const vemDir = await getVemDir();
    const currentStatePath = path2.join(vemDir, CURRENT_STATE_FILE);
    await fs3.writeFile(currentStatePath, content, "utf-8");
  };
  const resolveRemoteProjectAuth = async () => {
    const configService = new ConfigService();
    const [apiKey, projectId] = await Promise.all([
      tryAuthenticatedKey(configService),
      configService.getProjectId()
    ]);
    if (!apiKey || !projectId) return null;
    return { configService, apiKey, projectId };
  };
  const decisionCmd = program2.command("decision").description("Manage architectural decisions");
  decisionCmd.command("add <title>").description("Record an architectural decision").option("--context <text>", "Why this decision was needed").option("--decision <text>", "What was decided").option(
    "--tasks <ids>",
    "Comma-separated task IDs (e.g., TASK-001,TASK-002)"
  ).action(
    async (title, options) => {
      try {
        if (!options.context || !options.decision) {
          console.error(
            chalk11.red("\n\u2716 Both --context and --decision are required.\n")
          );
          console.log(chalk11.gray("Example:"));
          console.log(
            chalk11.gray('  vem decision add "Use Zod for validation" \\')
          );
          console.log(
            chalk11.gray('    --context "Need runtime type checking" \\')
          );
          console.log(
            chalk11.gray(
              '    --decision "Chose Zod over Yup for better TypeScript inference" \\'
            )
          );
          console.log(chalk11.gray("    --tasks TASK-042,TASK-043"));
          return;
        }
        const relatedTasks = options.tasks ? options.tasks.split(",").map((t) => t.trim()).filter(Boolean) : void 0;
        let savedToCloud = false;
        const remoteAuth = await resolveRemoteProjectAuth();
        if (remoteAuth) {
          const response = await fetch(
            `${API_URL}/projects/${remoteAuth.projectId}/decisions`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${remoteAuth.apiKey}`,
                "Content-Type": "application/json",
                ...await buildDeviceHeaders(remoteAuth.configService)
              },
              body: JSON.stringify({
                title,
                context: options.context,
                decision: options.decision,
                related_tasks: relatedTasks ?? []
              })
            }
          );
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(
              payload.error || "Failed to store decision in cloud"
            );
          }
          savedToCloud = true;
        }
        const configService = new ConfigService();
        await configService.recordDecision(
          title,
          options.context,
          options.decision,
          relatedTasks
        );
        console.log(
          chalk11.green(
            `
\u2714 Decision recorded${savedToCloud ? " (cloud + local cache)" : " (local cache)"}: ${title}`
          )
        );
        if (relatedTasks && relatedTasks.length > 0) {
          console.log(
            chalk11.gray(`  Related tasks: ${relatedTasks.join(", ")}`)
          );
        }
        console.log();
      } catch (error) {
        console.error(
          chalk11.red(`
\u2716 Failed to record decision: ${error.message}
`)
        );
      }
    }
  );
  const contextCmd = program2.command("context").description("Manage project context and current state");
  contextCmd.command("show").description("Show project context and current state").action(async () => {
    try {
      const remoteAuth = await resolveRemoteProjectAuth();
      if (remoteAuth) {
        const response = await fetch(
          `${API_URL}/projects/${remoteAuth.projectId}/context`,
          {
            headers: {
              Authorization: `Bearer ${remoteAuth.apiKey}`,
              ...await buildDeviceHeaders(remoteAuth.configService)
            }
          }
        );
        if (response.ok) {
          const payload = await response.json();
          console.log(chalk11.bold("\nProject Context"));
          console.log(chalk11.gray(`Source: ${payload.source || "db"}`));
          console.log(payload.context || "");
          console.log(chalk11.bold("\nCurrent State"));
          console.log(payload.current_state || "");
          if (payload.decisions && payload.decisions.trim().length > 0) {
            console.log(chalk11.bold("\nDecisions"));
            console.log(payload.decisions);
          }
          console.log("");
          return;
        }
      }
      const configService = new ConfigService();
      const [context, currentState] = await Promise.all([
        configService.getContext(),
        getCurrentStateFromLocalCache()
      ]);
      console.log(chalk11.bold("\nProject Context (local cache)"));
      console.log(context || "");
      console.log(chalk11.bold("\nCurrent State (local cache)"));
      console.log(currentState || "");
      console.log("");
    } catch (error) {
      console.error(
        chalk11.red(`
\u2716 Failed to read context: ${error.message}
`)
      );
    }
  });
  contextCmd.command("set").description("Set project context and/or current state").option("--context <text>", "Full CONTEXT.md content").option("--current-state <text>", "Full CURRENT_STATE.md content").action(async (options) => {
    try {
      if (options.context === void 0 && options.currentState === void 0) {
        console.error(
          chalk11.red(
            "\n\u2716 Provide at least one of --context or --current-state.\n"
          )
        );
        return;
      }
      let savedToCloud = false;
      const remoteAuth = await resolveRemoteProjectAuth();
      if (remoteAuth) {
        const response = await fetch(
          `${API_URL}/projects/${remoteAuth.projectId}/context`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${remoteAuth.apiKey}`,
              "Content-Type": "application/json",
              ...await buildDeviceHeaders(remoteAuth.configService)
            },
            body: JSON.stringify({
              ...options.context !== void 0 ? { context: options.context } : {},
              ...options.currentState !== void 0 ? { current_state: options.currentState } : {}
            })
          }
        );
        if (response.ok) {
          savedToCloud = true;
        } else {
          const payload = await response.json().catch(() => ({}));
          console.log(
            chalk11.yellow(
              `Cloud context update failed; continuing with local cache only: ${payload.error || response.statusText}`
            )
          );
        }
      }
      const configService = new ConfigService();
      if (options.context !== void 0) {
        await configService.updateContext(options.context);
      }
      if (options.currentState !== void 0) {
        await writeCurrentStateToLocalCache(options.currentState);
      }
      console.log(
        chalk11.green(
          `
\u2714 Context updated${savedToCloud ? " (cloud + local cache)" : " (local cache)"}
`
        )
      );
    } catch (error) {
      console.error(
        chalk11.red(`
\u2716 Failed to update context: ${error.message}
`)
      );
    }
  });
  program2.command("diff").description("Show differences between local and cloud state").option("--detailed", "Show detailed content diffs").option("--json", "Output as JSON").action(async (options) => {
    try {
      const { DiffService } = await import("./dist-27CAVU4D.js");
      const diffService = new DiffService();
      const result = await diffService.compareWithLastPush();
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk11.bold("\nVEM Diff (local vs. cloud)"));
      console.log(chalk11.gray("\u2500".repeat(50)));
      if (result.tasks.added.length > 0 || result.tasks.modified.length > 0) {
        console.log(chalk11.bold("\nTasks:"));
        for (const id of result.tasks.added) {
          console.log(chalk11.green(`  + ${id} (new)`));
        }
        for (const mod of result.tasks.modified) {
          console.log(chalk11.yellow(`  ~ ${mod.id} (${mod.changes})`));
        }
      }
      if (result.decisions.added.length > 0) {
        console.log(chalk11.bold("\nDecisions:"));
        console.log(
          chalk11.green(`  + ${result.decisions.added.length} new decisions`)
        );
      }
      if (result.changelog.added.length > 0) {
        console.log(chalk11.bold("\nChangelog:"));
        console.log(
          chalk11.green(`  + ${result.changelog.added.length} new entries`)
        );
      }
      if (result.currentState.changed) {
        console.log(chalk11.bold("\nCurrent State:"));
        console.log(
          chalk11.yellow(
            `  ~ Modified locally (${result.currentState.lineCount} lines)`
          )
        );
      }
      console.log(chalk11.gray(`
${"\u2500".repeat(50)}`));
      console.log(
        chalk11.bold(`Summary: ${result.summary.totalChanges} changes`)
      );
      if (result.summary.totalChanges > 0) {
        console.log(chalk11.gray("Run: vem push\n"));
      } else {
        console.log(chalk11.gray("No changes to push\n"));
      }
    } catch (error) {
      console.error(
        chalk11.red(`
\u2716 Failed to generate diff: ${error.message}
`)
      );
    }
  });
  program2.command("doctor").description("Run health checks on VEM setup").option("--json", "Output as JSON").action(async (options) => {
    try {
      const { DoctorService } = await import("./dist-27CAVU4D.js");
      const doctorService = new DoctorService();
      const results = await doctorService.runAllChecks();
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        process.exit(
          results.some((r) => r.status === "fail") ? 2 : results.some((r) => r.status === "warn") ? 1 : 0
        );
        return;
      }
      console.log(chalk11.bold("\nVEM Health Check"));
      console.log(chalk11.gray("\u2500".repeat(50)));
      let hasErrors = false;
      let hasWarnings = false;
      for (const result of results) {
        let icon = "";
        let color;
        if (result.status === "pass") {
          icon = "\u2713";
          color = chalk11.green;
        } else if (result.status === "warn") {
          icon = "\u26A0";
          color = chalk11.yellow;
          hasWarnings = true;
        } else {
          icon = "\u2717";
          color = chalk11.red;
          hasErrors = true;
        }
        console.log(color(`${icon} ${result.name}`));
        console.log(chalk11.gray(`  ${result.message}`));
        if (result.fix) {
          console.log(chalk11.gray(`  \u2192 ${result.fix}`));
        }
      }
      console.log(chalk11.gray("\u2500".repeat(50)));
      if (hasErrors) {
        console.log(chalk11.red("\n\u2717 Issues found that need attention\n"));
        process.exit(2);
      } else if (hasWarnings) {
        console.log(chalk11.yellow("\n\u26A0 Minor issues found\n"));
        process.exit(1);
      } else {
        console.log(chalk11.green("\n\u2713 All checks passed\n"));
        process.exit(0);
      }
    } catch (error) {
      console.error(
        chalk11.red(`
\u2716 Failed to run health checks: ${error.message}
`)
      );
      process.exit(2);
    }
  });
  program2.command("summarize").description("Analyze current changes and suggest VEM memory updates").option("--staged", "Analyze only staged changes").action(async (options) => {
    await trackCommandUsage("summarize");
    try {
      const configService = new ConfigService();
      const key = await tryAuthenticatedKey(configService);
      const projectId = await configService.getProjectId();
      if (!key || !projectId) {
        console.error(
          chalk11.red("\n\u2716 Authentication or project link missing.\n")
        );
        return;
      }
      console.log(chalk11.blue("Analyzing local changes..."));
      const diffCmd = options.staged ? "git diff --cached" : "git diff HEAD";
      const diff = execSync3(diffCmd).toString();
      if (!diff.trim()) {
        console.log(chalk11.yellow("No changes detected to summarize."));
        return;
      }
      const res = await fetch(`${API_URL}/projects/${projectId}/summarize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...await buildDeviceHeaders(configService)
        },
        body: JSON.stringify({ diff })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Summarization request failed");
      }
      const { suggestions } = await res.json();
      console.log(chalk11.bold("\n\u2728 AI-Suggested Memory Updates"));
      console.log(chalk11.gray("\u2500".repeat(50)));
      if (suggestions.changelog) {
        console.log(chalk11.cyan("\n[Changelog]"));
        console.log(suggestions.changelog);
      }
      if (suggestions.decisions?.length > 0) {
        console.log(chalk11.cyan("\n[Decisions]"));
        suggestions.decisions.forEach((d) => {
          console.log(chalk11.bold(`- ${d.title}`));
          console.log(chalk11.gray(`  ${d.decision}`));
        });
      }
      if (suggestions.context_updates) {
        console.log(chalk11.cyan("\n[Context Updates]"));
        console.log(suggestions.context_updates);
      }
      if (suggestions.current_state_updates) {
        console.log(chalk11.cyan("\n[Current State Updates]"));
        console.log(suggestions.current_state_updates);
      }
      console.log(chalk11.gray(`
${"\u2500".repeat(50)}`));
      console.log(
        chalk11.gray(
          "Tip: Use these suggestions to update your .vem/ files before pushing.\n"
        )
      );
    } catch (error) {
      console.error(
        chalk11.red(`
\u2716 Failed to generate summary: ${error.message}
`)
      );
    }
  });
}

// src/commands/project.ts
import chalk12 from "chalk";
import prompts6 from "prompts";
async function runInteractiveLinkFlow(apiKey, configService) {
  let projectId;
  let projectOrgId = await configService.getProjectOrgId();
  const res = await fetch(`${API_URL}/projects`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...await buildDeviceHeaders(configService, {
        includeOrgContext: false
      })
    }
  });
  if (!res.ok) {
    console.error(
      chalk12.red(`
\u2716 Failed to fetch projects: ${res.statusText}
`)
    );
    return null;
  }
  const {
    projects,
    workspaces: listedWorkspaces,
    current_org_id: currentOrgId
  } = await res.json();
  const CREATE_NEW = "CREATE_NEW";
  const BACK = "BACK";
  const workspaceMap = /* @__PURE__ */ new Map();
  for (const workspace of listedWorkspaces || []) {
    if (!workspace?.id) continue;
    workspaceMap.set(workspace.id, {
      id: workspace.id,
      label: workspace.name || workspace.id,
      isPersonal: Boolean(workspace.is_personal)
    });
  }
  for (const candidate of projects) {
    if (!candidate.org_id) continue;
    const existing = workspaceMap.get(candidate.org_id);
    if (!existing) {
      workspaceMap.set(candidate.org_id, {
        id: candidate.org_id,
        label: candidate.org_name || candidate.org_id || "Organization",
        isPersonal: Boolean(candidate.is_personal)
      });
    } else if (candidate.is_personal) {
      existing.isPersonal = true;
    }
  }
  if (workspaceMap.size === 0 && currentOrgId) {
    workspaceMap.set(currentOrgId, {
      id: currentOrgId,
      label: "Personal",
      isPersonal: true
    });
  }
  const workspaceChoices = Array.from(workspaceMap.values()).sort((a, b) => {
    if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  const chooseProjectForWorkspace = async (workspace, allowBack) => {
    const workspaceProjects = projects.filter(
      (item) => item.org_id === workspace.id
    );
    const choices = [
      {
        title: chalk12.green("+ Create New Project"),
        value: CREATE_NEW,
        description: `Create a new project in ${workspace.label}`
      }
    ];
    if (workspaceProjects.length > 0) {
      for (const item of workspaceProjects) {
        choices.push({
          title: `${item.name} (${item.id})`,
          value: item.id,
          description: item.repo_url ? `Repo: ${item.repo_url}` : void 0
        });
      }
    } else {
      choices.push({
        title: chalk12.gray("No projects yet"),
        value: "NO_PROJECTS",
        disabled: true
      });
    }
    if (allowBack) {
      choices.push({
        title: chalk12.gray("\u2190 Back"),
        value: BACK
      });
    }
    const message = workspace.isPersonal ? "Select a personal project to link:" : `Select a project in ${workspace.label}:`;
    const response = await prompts6({
      type: "select",
      name: "projectId",
      message,
      choices
    });
    const selectedProjectId = response.projectId;
    if (!selectedProjectId) return { type: "cancel" };
    if (selectedProjectId === BACK) return { type: "back" };
    if (selectedProjectId === CREATE_NEW) {
      const projectInput = await prompts6({
        type: "text",
        name: "name",
        message: `Enter project name for ${workspace.label}:`,
        validate: (value) => value.length < 3 ? "Name must be at least 3 characters" : true
      });
      if (!projectInput.name) {
        return { type: "cancel" };
      }
      const repoUrl2 = await getGitRemote({ promptOnMultiple: true });
      const createHeaders = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...await buildDeviceHeaders(configService, {
          includeOrgContext: false
        }),
        "X-Org-Id": workspace.id
      };
      const createRes = await fetch(`${API_URL}/projects`, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({
          name: projectInput.name,
          repo_url: repoUrl2 === "REMOVE" ? void 0 : repoUrl2 || void 0
        })
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        if (createRes.status === 403) {
          console.error(
            chalk12.red(
              `
\u2716 Check failed: ${err.error || "Tier limit reached"}
`
            )
          );
        } else if (createRes.status === 409) {
          console.error(
            chalk12.red(
              `
\u2716 ${err.error || "Failed to create project: Already exists."}
`
            )
          );
        } else {
          console.error(
            chalk12.red(
              `
\u2716 Failed to create project: ${err.error || createRes.statusText}
`
            )
          );
        }
        return { type: "cancel" };
      }
      const { project } = await createRes.json();
      console.log(chalk12.green(`
\u2714 Project created: ${project.id}`));
      return {
        type: "selected",
        projectId: project.id,
        orgId: project.org_id || workspace.id
      };
    }
    const selected = workspaceProjects.find(
      (item) => item.id === selectedProjectId
    );
    return {
      type: "selected",
      projectId: selectedProjectId,
      orgId: selected?.org_id || workspace.id
    };
  };
  const hasOrgWorkspace = workspaceChoices.some((item) => !item.isPersonal);
  if (!hasOrgWorkspace) {
    const personalWorkspace = workspaceChoices.find((item) => item.isPersonal);
    const activeWorkspace = personalWorkspace || workspaceChoices[0];
    if (!activeWorkspace) {
      console.log(chalk12.yellow("\nNo available workspaces found.\n"));
      return null;
    }
    const selection = await chooseProjectForWorkspace(activeWorkspace, false);
    if (selection.type !== "selected") {
      console.log(chalk12.yellow("\nOperation cancelled.\n"));
      return null;
    }
    projectId = selection.projectId;
    projectOrgId = selection.orgId || projectOrgId;
  } else {
    while (!projectId) {
      const workspaceResponse = await prompts6({
        type: "select",
        name: "workspaceId",
        message: "Select personal or organization workspace:",
        choices: workspaceChoices.map((workspace) => ({
          title: workspace.isPersonal ? `Personal (${workspace.label})` : workspace.label,
          value: workspace.id
        }))
      });
      const selectedWorkspaceId = workspaceResponse.workspaceId;
      if (!selectedWorkspaceId) {
        console.log(chalk12.yellow("\nOperation cancelled.\n"));
        return null;
      }
      const selectedWorkspace = workspaceMap.get(selectedWorkspaceId);
      if (!selectedWorkspace) {
        console.log(chalk12.yellow("\nOperation cancelled.\n"));
        return null;
      }
      const selection = await chooseProjectForWorkspace(
        selectedWorkspace,
        true
      );
      if (selection.type === "cancel") {
        console.log(chalk12.yellow("\nOperation cancelled.\n"));
        return null;
      }
      if (selection.type === "back") {
        continue;
      }
      projectId = selection.projectId;
      projectOrgId = selection.orgId || projectOrgId;
    }
  }
  if (!projectId) return null;
  await configService.setProjectId(projectId);
  await configService.setProjectOrgId(projectOrgId || null);
  const repoSelection = await getGitRemoteSelection({
    forcePrompt: false,
    promptOnMultiple: true
  });
  const repoUrl = repoSelection === "REMOVE" ? "REMOVE" : repoSelection?.url ?? null;
  const linkedRemoteName = repoSelection === "REMOVE" ? null : repoSelection?.name ?? null;
  try {
    const patchRes = await fetch(`${API_URL}/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...await buildDeviceHeaders(configService),
        ...projectOrgId ? { "X-Org-Id": projectOrgId } : {}
      },
      body: JSON.stringify({
        repo_url: repoUrl === "REMOVE" ? null : repoUrl || void 0
      })
    });
    if (!patchRes.ok) {
      const err = await patchRes.text().catch(() => "");
      console.log(
        chalk12.yellow(
          `  \u26A0 Warning: Failed to update server-side repo URL: ${err || patchRes.statusText}`
        )
      );
    }
  } catch (_err) {
    console.log(
      chalk12.yellow("  \u26A0 Warning: Could not reach server to update repo URL.")
    );
  }
  if (repoUrl === "REMOVE" || !repoUrl) {
    await configService.setLinkedRemote(null);
  } else {
    await configService.setLinkedRemote({
      name: linkedRemoteName,
      url: repoUrl
    });
  }
  await installGitHook({ promptIfMissing: false, quiet: true });
  if (!repoUrl || repoUrl === "REMOVE") {
    console.log(
      chalk12.yellow(
        "\n\u26A0 For full advantage of vem (automatic indexing, code search, and PR summaries), you should link a repo origin."
      )
    );
  } else {
    console.log(chalk12.gray(`Repo: ${repoUrl}`));
  }
  console.log(chalk12.green(`
\u2714 Linked to project ${projectId}
`));
  return projectId;
}
function registerProjectCommands(program2) {
  program2.command("link [projectId]").description("Link this repo to a vem project").option("--reset", "Reset the linked repository origin").action(async (projectId, options) => {
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
            chalk12.red(
              "\n\u2716 Not linked to any project. Link a project first or provide a projectId.\n"
            )
          );
          return;
        }
      }
      if (projectIdArg) {
        const check = await validateProject(projectId, apiKey, configService);
        if (!check.valid) {
          console.error(
            chalk12.red(
              `
\u2716 Project ${projectId} not found. It may have been deleted or you may not have access.
`
            )
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
        promptOnMultiple: true
      });
      const repoUrl = repoSelection === "REMOVE" ? "REMOVE" : repoSelection?.url ?? null;
      const linkedRemoteName = repoSelection === "REMOVE" ? null : repoSelection?.name ?? null;
      if (projectId && (options.reset || !projectIdArg)) {
        try {
          const res = await fetch(`${API_URL}/projects/${projectId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              ...await buildDeviceHeaders(configService),
              ...projectOrgId ? { "X-Org-Id": projectOrgId } : {}
            },
            body: JSON.stringify({
              repo_url: repoUrl === "REMOVE" ? null : repoUrl || void 0
            })
          });
          if (!res.ok) {
            const err = await res.text().catch(() => "");
            console.log(
              chalk12.yellow(
                `  \u26A0 Warning: Failed to update server-side repo URL: ${err || res.statusText}`
              )
            );
          }
        } catch (_err) {
          console.log(
            chalk12.yellow(
              "  \u26A0 Warning: Could not reach server to update repo URL."
            )
          );
        }
      }
      if (repoUrl === "REMOVE" || !repoUrl) {
        await configService.setLinkedRemote(null);
      } else {
        await configService.setLinkedRemote({
          name: linkedRemoteName,
          url: repoUrl
        });
      }
      await installGitHook({ promptIfMissing: false, quiet: true });
      if (options.reset) {
        if (repoUrl === "REMOVE") {
          console.log(chalk12.green("\n\u2714 Repository binding removed."));
          console.log(
            chalk12.yellow(
              "\u26A0 For full advantage of vem (automatic indexing, code search, and PR summaries), you should link a repo origin."
            )
          );
        } else if (repoUrl) {
          console.log(
            chalk12.green(`
\u2714 Repository binding updated to: ${repoUrl}`)
          );
        }
      } else {
        if (!repoUrl || repoUrl === "REMOVE") {
          console.log(
            chalk12.yellow(
              "\n\u26A0 For full advantage of vem (automatic indexing, code search, and PR summaries), you should link a repo origin."
            )
          );
        } else {
          console.log(chalk12.gray(`Repo: ${repoUrl}`));
        }
      }
      if (!options.reset) {
        console.log(chalk12.green(`
\u2714 Linked to project ${projectId}
`));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk12.red("\n\u2716 Link Failed:"), error.message);
      } else {
        console.error(chalk12.red("\n\u2716 Link Failed:"), String(error));
      }
    }
  });
  program2.command("unlink").description("Unlink this repo from a vem project").action(async () => {
    try {
      const configService = new ConfigService();
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.log(chalk12.yellow("\n\u26A0 Not linked to any project.\n"));
        return;
      }
      const apiKey = await ensureAuthenticated(configService);
      let projectName = "Unknown Project";
      try {
        const res = await fetch(`${API_URL}/projects`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...await buildDeviceHeaders(configService)
          }
        });
        if (res.ok) {
          const { projects } = await res.json();
          const found = projects.find((p) => p.id === projectId);
          if (found) projectName = found.name;
        }
      } catch (_) {
      }
      const response = await prompts6({
        type: "confirm",
        name: "confirmed",
        message: `Are you sure you want to unlink from project ${chalk12.bold(projectName)} (${projectId})?`,
        initial: false
      });
      if (response.confirmed) {
        await configService.setProjectId(null);
        await configService.setProjectOrgId(null);
        await configService.setLinkedRemote(null);
        console.log(chalk12.green("\n\u2714 Unlinked from project.\n"));
      } else {
        console.log(chalk12.yellow("\nOperation cancelled.\n"));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk12.red("\n\u2716 Unlink Failed:"), error.message);
      } else {
        console.error(chalk12.red("\n\u2716 Unlink Failed:"), String(error));
      }
    }
  });
  const projectCmd = program2.command("project").description("Project commands");
  projectCmd.command("open [projectId]").description("Open the web app on the project page").action(async (projectId) => {
    try {
      const configService = new ConfigService();
      const resolvedProjectId = projectId || await configService.getProjectId();
      if (!resolvedProjectId) {
        console.error(
          chalk12.red("\n\u2716 Project not linked. Run `vem link` first.\n")
        );
        process.exit(1);
      }
      const projectUrl = `${WEB_URL}/project/${resolvedProjectId}`;
      console.log(chalk12.blue(`
\u{1F310} Opening: ${projectUrl}
`));
      openBrowser(projectUrl);
    } catch (error) {
      console.error(
        chalk12.red("\n\u2716 Failed to open project:"),
        error?.message ?? String(error)
      );
    }
  });
}

// src/commands/runner.ts
import { execFileSync, spawn as spawn3 } from "child_process";
import { existsSync } from "fs";
import { dirname as dirname2, resolve as resolve2 } from "path";
import chalk13 from "chalk";
function sleep(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
function getCliEntrypoint() {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error("Unable to determine CLI entrypoint.");
  }
  return entry;
}
function runGit(args, options) {
  const output = execFileSync("git", args, {
    encoding: "utf-8",
    stdio: options?.stdio ?? "pipe"
  });
  return typeof output === "string" ? output.trim() : "";
}
function runGitIn(cwd, args, options) {
  const output = execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    stdio: options?.stdio ?? "pipe"
  });
  return typeof output === "string" ? output.trim() : "";
}
function hasDirtyWorktree() {
  return runGit(["status", "--porcelain"]).trim().length > 0;
}
function getRepoRoot3() {
  return runGit(["rev-parse", "--show-toplevel"]);
}
function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
var KNOWN_RUNNER_AGENTS = [
  "copilot",
  "gh",
  "claude",
  "gemini",
  "codex"
];
function hasSandboxCredentials(agent) {
  if (agent === "claude") {
    return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0;
  }
  if (agent === "copilot" || agent === "gh") {
    const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (envToken && envToken.trim().length > 0) return true;
    try {
      const token = execFileSync("gh", ["auth", "token"], {
        encoding: "utf-8"
      }).trim();
      return token.length > 0;
    } catch {
      return false;
    }
  }
  if (agent === "gemini") {
    return typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.trim().length > 0;
  }
  if (agent === "codex") {
    return typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim().length > 0;
  }
  return true;
}
function getAvailableAgentCommands(selectedAgent, sandbox) {
  const isAvailable = (command) => commandExists(command) && (!sandbox || hasSandboxCredentials(command));
  const knownAvailable = KNOWN_RUNNER_AGENTS.filter(
    (command) => isAvailable(command)
  );
  const selectedAvailable = isAvailable(selectedAgent);
  if (selectedAvailable && !knownAvailable.includes(
    selectedAgent
  )) {
    return [selectedAgent, ...knownAvailable];
  }
  return knownAvailable;
}
function getRunnerCapabilities(agent, sandbox = true, agentPinned = false) {
  const repoRoot = getRepoRoot3();
  let branch = null;
  try {
    branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    branch = null;
  }
  const availableAgents = getAvailableAgentCommands(agent, sandbox);
  return {
    task_runs: true,
    web_terminal: true,
    sandbox,
    available_agents: availableAgents,
    selected_agent: agent,
    agent_mode: agentPinned ? "pinned" : "selectable",
    workspace: {
      cwd: repoRoot,
      branch,
      dirty: hasDirtyWorktree(),
      shell: "/bin/sh",
      agent_command: agent,
      agent_available: commandExists(agent)
    }
  };
}
function checkDockerAvailable() {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.error(chalk13.red("\u2717 Docker is not running or not installed."));
    console.error(
      chalk13.yellow(
        "  The vem runner requires Docker to run agents in a secure sandbox."
      )
    );
    console.error(
      chalk13.gray(
        "  Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
      )
    );
    console.error(
      chalk13.gray(
        "  Or run without sandbox (no isolation): vem runner --unsafe"
      )
    );
    process.exit(1);
  }
}
var SANDBOX_IMAGE_NAME = "vem-sandbox:latest";
function getSandboxImageDir() {
  const cliDist = getCliEntrypoint();
  const distDir = dirname2(cliDist);
  const candidates = [
    resolve2(distDir, "Dockerfile.sandbox"),
    resolve2(distDir, "..", "Dockerfile.sandbox"),
    resolve2(distDir, "..", "..", "apps", "cli", "Dockerfile.sandbox")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return dirname2(candidate);
    }
  }
  throw new Error(
    "Dockerfile.sandbox not found. Ensure the vem CLI is installed correctly."
  );
}
function buildSandboxImage() {
  console.log(chalk13.cyan("  Building sandbox Docker image (first use)..."));
  const contextDir = getSandboxImageDir();
  execFileSync(
    "docker",
    ["build", "-t", SANDBOX_IMAGE_NAME, "-f", "Dockerfile.sandbox", "."],
    { cwd: contextDir, stdio: "inherit" }
  );
  console.log(chalk13.green("  \u2713 Sandbox image built."));
}
function ensureSandboxImage() {
  try {
    execFileSync("docker", ["image", "inspect", SANDBOX_IMAGE_NAME], {
      stdio: "ignore"
    });
  } catch {
    buildSandboxImage();
  }
}
function collectSandboxCredentials(agent) {
  const creds = {};
  const addFromEnv = (key) => {
    if (process.env[key]) creds[key] = process.env[key];
  };
  addFromEnv("VEM_API_KEY");
  addFromEnv("VEM_API_URL");
  if (agent === "claude") {
    addFromEnv("ANTHROPIC_API_KEY");
    if (!creds.ANTHROPIC_API_KEY) {
      console.error(
        chalk13.red(
          `\u2717 ANTHROPIC_API_KEY is not set. Required for --agent claude.`
        )
      );
      process.exit(1);
    }
  } else if (agent === "copilot" || agent === "gh") {
    const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (envToken) {
      creds.GITHUB_TOKEN = envToken;
    } else {
      try {
        const token = execFileSync("gh", ["auth", "token"], {
          encoding: "utf-8"
        }).trim();
        if (token) creds.GITHUB_TOKEN = token;
      } catch {
      }
    }
    if (!creds.GITHUB_TOKEN) {
      console.error(
        chalk13.red(`\u2717 GitHub token not found. Required for --agent copilot.`)
      );
      console.error(
        chalk13.gray("  Set GITHUB_TOKEN env var or run: gh auth login")
      );
      process.exit(1);
    }
  } else if (agent === "gemini") {
    addFromEnv("GEMINI_API_KEY");
    if (!creds.GEMINI_API_KEY) {
      console.error(
        chalk13.red(`\u2717 GEMINI_API_KEY is not set. Required for --agent gemini.`)
      );
      process.exit(1);
    }
  } else if (agent === "codex") {
    addFromEnv("OPENAI_API_KEY");
    if (!creds.OPENAI_API_KEY) {
      console.error(
        chalk13.red(`\u2717 OPENAI_API_KEY is not set. Required for --agent codex.`)
      );
      process.exit(1);
    }
  }
  if (process.env.GIT_AUTHOR_NAME)
    creds.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME;
  if (process.env.GIT_AUTHOR_EMAIL)
    creds.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL;
  return creds;
}
function sanitizeBranchSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function buildTaskRunPrTitle(taskExternalId, taskTitle) {
  const normalizedTitle = taskTitle?.trim();
  return normalizedTitle ? `Implement ${taskExternalId}: ${normalizedTitle}` : `Implement ${taskExternalId}`;
}
async function resolveGitRemote(configService) {
  const linkedRemote = (await configService.getLinkedRemoteName())?.trim();
  const preferredRemote = linkedRemote || "origin";
  try {
    return {
      name: preferredRemote,
      url: runGit(["remote", "get-url", preferredRemote])
    };
  } catch {
    if (preferredRemote !== "origin") {
      try {
        return { name: "origin", url: runGit(["remote", "get-url", "origin"]) };
      } catch {
        return { name: preferredRemote, url: null };
      }
    }
    return { name: preferredRemote, url: null };
  }
}
function prepareTaskBranch(taskExternalId, baseBranch, remoteName) {
  try {
    runGit(["fetch", remoteName]);
  } catch {
  }
  const remoteBaseRef = `${remoteName}/${baseBranch}`;
  let checkoutRef = baseBranch;
  try {
    runGit(["rev-parse", "--verify", remoteBaseRef]);
    checkoutRef = remoteBaseRef;
  } catch {
    checkoutRef = baseBranch;
  }
  const baseHash = runGit(["rev-parse", checkoutRef]);
  const branchName = `vem/${sanitizeBranchSegment(taskExternalId)}-${Date.now().toString(36)}`;
  runGit(["checkout", "-b", branchName, checkoutRef]);
  return { baseHash, branchName, checkoutRef };
}
function getCommitHashesSince(baseHash) {
  const output = runGit(["rev-list", `${baseHash}..HEAD`]);
  return output.split("\n").map((entry) => entry.trim()).filter(Boolean);
}
var _deviceHeadersCache = null;
function getCachedDeviceHeaders(configService) {
  if (!_deviceHeadersCache) {
    _deviceHeadersCache = buildDeviceHeaders(configService);
  }
  return _deviceHeadersCache;
}
var FETCH_TIMEOUT_MS = 3e4;
async function apiRequest(configService, apiKey, path4, init) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...await getCachedDeviceHeaders(configService),
    ...init?.headers ?? {}
  };
  return fetch(`${API_URL}${path4}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
}
async function appendRunLogs(configService, apiKey, runId, entries) {
  if (entries.length === 0) return;
  await apiRequest(configService, apiKey, `/task-runs/${runId}/logs`, {
    method: "POST",
    body: JSON.stringify({ entries })
  });
}
async function sendRunnerHeartbeat(configService, apiKey, projectId, status, currentTaskRunId, capabilities) {
  await apiRequest(
    configService,
    apiKey,
    `/projects/${projectId}/runners/heartbeat`,
    {
      method: "POST",
      body: JSON.stringify({
        status,
        current_task_run_id: currentTaskRunId,
        capabilities
      })
    }
  );
}
async function completeTaskRunWithRetry(configService, apiKey, runId, payload, attempts = 5) {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await apiRequest(
        configService,
        apiKey,
        `/task-runs/${runId}/complete`,
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );
      if (response.ok) return;
      const bodyText = await response.text().catch(() => "");
      lastError = `HTTP ${response.status}${bodyText ? `: ${bodyText}` : ""}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      await sleep(1e3 * attempt);
    }
  }
  throw new Error(`Failed to complete run ${runId}: ${lastError}`);
}
async function executeClaimedRun(input) {
  const {
    configService,
    apiKey,
    projectId,
    agent,
    useSandbox,
    agentPinned,
    run
  } = input;
  const repoRoot = getRepoRoot3();
  let sequence = 1;
  let heartbeatTimer = null;
  let cancellationRequested = false;
  let timedOut = false;
  let branchName = null;
  let baseHash = null;
  let originalBranch = null;
  let commitHashes = [];
  let completionStatus = "failed";
  let exitCode = null;
  let completionError = null;
  let createPr = false;
  const baseBranch = run.agent_base_branch || "main";
  const remote = await resolveGitRemote(configService);
  try {
    if (hasDirtyWorktree()) {
      throw new Error(
        "Runner repository has uncommitted changes. Commit or stash them before starting web-triggered runs."
      );
    }
    try {
      originalBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      originalBranch = null;
    }
    const preparedBranch = prepareTaskBranch(
      run.task_external_id,
      baseBranch,
      remote.name
    );
    baseHash = preparedBranch.baseHash;
    branchName = preparedBranch.branchName;
    await appendRunLogs(configService, apiKey, run.id, [
      {
        sequence: sequence++,
        stream: "system",
        chunk: `Prepared branch ${branchName} from ${preparedBranch.checkoutRef}
`
      }
    ]);
    const child = spawn3(
      process.execPath,
      [
        getCliEntrypoint(),
        "agent",
        agent,
        "--task",
        run.task_external_id,
        "--auto-exit"
      ],
      {
        env: {
          ...process.env,
          VEM_RUNNER_INSTRUCTIONS: run.user_prompt?.trim() || ""
        },
        cwd: repoRoot,
        // detached: true puts the child in its own process group so we can
        // kill the entire tree (vem agent + copilot subprocess) with -pid.
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    heartbeatTimer = setInterval(async () => {
      try {
        const response = await apiRequest(
          configService,
          apiKey,
          `/task-runs/${run.id}/heartbeat`,
          { method: "POST", body: JSON.stringify({}) }
        );
        const data = await response.json().catch(() => ({}));
        if (data.run?.cancellation_requested_at && !cancellationRequested) {
          cancellationRequested = true;
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          await appendRunLogs(configService, apiKey, run.id, [
            {
              sequence: sequence++,
              stream: "system",
              chunk: "Cancellation requested from web UI. Stopping agent process.\n"
            }
          ]);
        }
        const maxRuntimeAt = data.run?.max_runtime_at ? new Date(data.run.max_runtime_at) : null;
        if (maxRuntimeAt && maxRuntimeAt.getTime() <= Date.now() && !timedOut && !cancellationRequested) {
          timedOut = true;
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          await appendRunLogs(configService, apiKey, run.id, [
            {
              sequence: sequence++,
              stream: "system",
              chunk: "Run exceeded the maximum runtime. Stopping agent process.\n"
            }
          ]);
        }
      } catch {
      }
    }, 3e4);
    child.stdout.on("data", async (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      void appendRunLogs(configService, apiKey, run.id, [
        { sequence: sequence++, stream: "stdout", chunk: text }
      ]);
    });
    child.stderr.on("data", async (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      void appendRunLogs(configService, apiKey, run.id, [
        { sequence: sequence++, stream: "stderr", chunk: text }
      ]);
    });
    const result = await new Promise((resolve3) => {
      child.on("exit", (code, signal) => resolve3({ code, signal }));
      child.on("error", (error) => {
        completionError = error.message;
        resolve3({ code: null, signal: null });
      });
    });
    exitCode = result.code;
    if (completionError) {
      completionStatus = cancellationRequested ? "cancelled" : "failed";
    } else if (timedOut) {
      completionStatus = "interrupted";
      completionError = "Run exceeded the maximum runtime and was stopped.";
    } else if (cancellationRequested) {
      completionStatus = "cancelled";
    } else if (result.signal) {
      completionStatus = "interrupted";
      completionError = `Agent process terminated with signal ${result.signal}.`;
    } else if (result.code === 0) {
      completionStatus = "completed";
    } else {
      completionStatus = "failed";
      completionError = `Agent process exited with code ${result.code ?? "unknown"}.`;
    }
    if (baseHash) {
      if (completionStatus === "completed" && hasDirtyWorktree()) {
        runGit(["add", "-A"], { stdio: "inherit" });
        runGit(
          [
            "commit",
            "-m",
            `chore(${run.task_external_id}): apply agent changes`
          ],
          { stdio: "inherit" }
        );
      }
      commitHashes = getCommitHashesSince(baseHash);
      if (completionStatus === "completed" && branchName && commitHashes.length > 0) {
        try {
          runGit(["push", "-u", remote.name, branchName], { stdio: "inherit" });
          createPr = true;
        } catch (error) {
          completionError = error instanceof Error ? `Push to ${remote.name} failed: ${error.message}` : `Push to ${remote.name} failed: ${String(error)}`;
        }
      }
    }
  } catch (error) {
    completionStatus = "failed";
    completionError = error instanceof Error ? error.message : String(error);
    await appendRunLogs(configService, apiKey, run.id, [
      {
        sequence: sequence++,
        stream: "system",
        chunk: `${completionError}
`
      }
    ]);
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (originalBranch) {
      try {
        runGit(["checkout", originalBranch]);
      } catch {
      }
    }
    await completeTaskRunWithRetry(configService, apiKey, run.id, {
      status: completionStatus,
      exit_code: exitCode,
      error_message: completionError,
      branch_name: branchName,
      commit_hashes: commitHashes,
      create_pr: createPr,
      pr_title: buildTaskRunPrTitle(run.task_external_id, run.task_title),
      pr_body: run.user_prompt?.trim() ? `Triggered from VEM web.

Instructions:
${run.user_prompt.trim()}` : "Triggered from VEM web.",
      summary: completionStatus === "completed" ? "Runner completed the queued task run." : `Runner finished with status ${completionStatus}.`
    });
    await sendRunnerHeartbeat(
      configService,
      apiKey,
      projectId,
      "idle",
      null,
      getRunnerCapabilities(agent, useSandbox, agentPinned)
    );
  }
}
async function executeClaimedRunInSandbox(input) {
  const { configService, apiKey, projectId, agent, run, credentials } = input;
  const repoRoot = getRepoRoot3();
  let sequence = 1;
  let heartbeatTimer = null;
  let worktreePath = null;
  let branchName = null;
  let baseHash = null;
  let commitHashes = [];
  let completionStatus = "failed";
  let exitCode = null;
  let completionError = null;
  let createPr = false;
  let dockerProcess = null;
  let containerName = null;
  let cancellationRequested = false;
  let timedOut = false;
  let fullDockerLogLines = [];
  const baseBranch = run.agent_base_branch || "main";
  const remote = await resolveGitRemote(configService);
  worktreePath = `/tmp/vem-run-${run.id}-${Date.now().toString(36)}`;
  branchName = `vem/${sanitizeBranchSegment(run.task_external_id)}-${Date.now().toString(36)}`;
  try {
    ensureSandboxImage();
    try {
      runGit(["fetch", remote.name]);
    } catch {
    }
    const remoteUrl = remote.url;
    try {
      baseHash = runGit(["rev-parse", `${remote.name}/${baseBranch}`]);
    } catch {
      baseHash = runGit(["rev-parse", baseBranch]);
    }
    if (existsSync(worktreePath)) {
      execFileSync("rm", ["-rf", worktreePath], { stdio: "ignore" });
    }
    console.log(chalk13.gray(`  Cloning ${baseBranch} \u2192 ${worktreePath}`));
    execFileSync(
      "git",
      [
        "clone",
        "--quiet",
        `file://${repoRoot}`,
        "--branch",
        baseBranch,
        "--single-branch",
        worktreePath
      ],
      { stdio: "pipe" }
    );
    runGitIn(worktreePath, ["checkout", "-b", branchName]);
    if (remoteUrl) {
      runGitIn(worktreePath, ["remote", "set-url", "origin", remoteUrl]);
    }
    await appendRunLogs(configService, apiKey, run.id, [
      {
        sequence: sequence++,
        stream: "system",
        chunk: `Prepared sandbox clone at ${worktreePath} on branch ${branchName} (base: ${baseBranch})
`
      }
    ]);
    const envArgs = [];
    for (const [key, value] of Object.entries(credentials)) {
      envArgs.push("-e", `${key}=${value}`);
    }
    envArgs.push(
      "-e",
      `VEM_RUNNER_INSTRUCTIONS=${run.task_instructions?.trim() || run.user_prompt?.trim() || ""}`,
      "-e",
      `VEM_AGENT=${agent}`,
      "-e",
      `VEM_TASK_ID=${run.task_external_id}`
    );
    containerName = `vem-run-${run.id.slice(0, 8)}-${Date.now().toString(36)}`;
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--memory",
      "4g",
      "--cpus",
      "2",
      "-v",
      `${worktreePath}:/workspace`,
      "-w",
      "/workspace",
      ...envArgs,
      SANDBOX_IMAGE_NAME
      // No command — entrypoint calls /run-task.sh when no command is given
    ];
    dockerProcess = spawn3("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    heartbeatTimer = setInterval(async () => {
      try {
        const heartbeatRes = await apiRequest(
          configService,
          apiKey,
          `/task-runs/${run.id}/heartbeat`,
          {
            method: "POST",
            body: JSON.stringify({ project_id: projectId })
          }
        );
        if (!heartbeatRes.ok) return;
        const data = await heartbeatRes.json();
        const cancellationRequestedAt = data.run?.cancellation_requested_at ?? data.cancellation_requested_at ?? null;
        const maxRuntimeAt = data.run?.max_runtime_at ?? data.max_runtime_at ?? null;
        if (cancellationRequestedAt && !cancellationRequested) {
          cancellationRequested = true;
          completionStatus = "cancelled";
          if (dockerProcess?.pid) {
            try {
              if (containerName) {
                execFileSync("docker", ["stop", containerName], {
                  stdio: "ignore"
                });
              } else {
                dockerProcess.kill("SIGTERM");
              }
            } catch {
            }
          }
          await appendRunLogs(configService, apiKey, run.id, [
            {
              sequence: sequence++,
              stream: "system",
              chunk: "Cancellation requested from web UI. Stopping sandbox container.\n"
            }
          ]);
        }
        if (maxRuntimeAt && !timedOut) {
          const maxRuntime = new Date(maxRuntimeAt).getTime();
          if (Date.now() > maxRuntime) {
            timedOut = true;
            completionStatus = "failed";
            completionError = "Run exceeded the maximum runtime and was timed out.";
            if (dockerProcess?.pid) {
              try {
                if (containerName) {
                  execFileSync("docker", ["stop", containerName], {
                    stdio: "ignore"
                  });
                }
              } catch {
              }
            }
            await appendRunLogs(configService, apiKey, run.id, [
              {
                sequence: sequence++,
                stream: "system",
                chunk: "Run exceeded the maximum runtime. Stopping sandbox container.\n"
              }
            ]);
          }
        }
      } catch {
      }
    }, 3e4);
    const stdoutChunks = [];
    const streamLogs = (stream, data) => {
      const chunk = data.toString("utf-8");
      if (stream === "stdout") stdoutChunks.push(chunk);
      appendRunLogs(configService, apiKey, run.id, [
        { sequence: sequence++, stream, chunk }
      ]).catch(() => {
      });
      process.stdout.write(chunk);
    };
    dockerProcess.stdout?.on("data", (d) => streamLogs("stdout", d));
    dockerProcess.stderr?.on("data", (d) => streamLogs("stderr", d));
    exitCode = await new Promise((resolve3) => {
      dockerProcess.once("exit", (code) => resolve3(code ?? 1));
      dockerProcess.once("error", () => resolve3(1));
    });
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (exitCode === 0 && !cancellationRequested && !timedOut) {
      completionStatus = "completed";
      try {
        const output = runGitIn(worktreePath, [
          "rev-list",
          `${baseHash}..HEAD`
        ]);
        commitHashes = output.split("\n").map((h) => h.trim()).filter(Boolean);
      } catch {
      }
      createPr = commitHashes.length > 0;
    } else if (!cancellationRequested && !timedOut) {
      completionStatus = "failed";
    }
    fullDockerLogLines = stdoutChunks.join("").split("\n").filter(Boolean).slice(-1e3);
    if (completionStatus === "completed" && commitHashes.length > 0) {
      try {
        runGitIn(worktreePath, ["push", "-u", "origin", branchName], {
          stdio: "inherit"
        });
        await appendRunLogs(configService, apiKey, run.id, [
          {
            sequence: sequence++,
            stream: "system",
            chunk: `Pushed branch ${branchName} to ${remote.name}.
`
          }
        ]);
      } catch (pushErr) {
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        await appendRunLogs(configService, apiKey, run.id, [
          {
            sequence: sequence++,
            stream: "system",
            chunk: `Warning: failed to push branch: ${msg}
`
          }
        ]);
        createPr = false;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    completionError = msg;
    completionStatus = "failed";
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    await appendRunLogs(configService, apiKey, run.id, [
      {
        sequence: sequence++,
        stream: "system",
        chunk: `Sandbox run error: ${msg}
`
      }
    ]).catch(() => {
    });
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (dockerProcess) {
      try {
        if (containerName) {
          execFileSync("docker", ["stop", containerName], { stdio: "ignore" });
        }
      } catch {
      }
      dockerProcess = null;
    }
    if (worktreePath && existsSync(worktreePath)) {
      try {
        execFileSync("rm", ["-rf", worktreePath], { stdio: "ignore" });
      } catch {
      }
    }
    await completeTaskRunWithRetry(configService, apiKey, run.id, {
      project_id: projectId,
      status: completionStatus,
      exit_code: exitCode,
      error_message: completionError,
      branch_name: branchName,
      commit_hashes: commitHashes,
      create_pr: createPr,
      pr_title: buildTaskRunPrTitle(run.task_external_id, run.task_title),
      pr_body: run.user_prompt?.trim() ? `Triggered from VEM web.

Instructions:
${run.user_prompt.trim()}` : "Triggered from VEM web.",
      // Pass the full Docker log so the API can parse the vem_update block
      // reliably even when some live-streamed chunks were dropped.
      full_log_lines: fullDockerLogLines.length > 0 ? fullDockerLogLines : void 0
    });
  }
}
async function appendTerminalLogs(configService, apiKey, sessionId, entries) {
  if (entries.length === 0) return;
  await apiRequest(
    configService,
    apiKey,
    `/terminal-sessions/${sessionId}/logs`,
    {
      method: "POST",
      body: JSON.stringify({ entries })
    }
  );
}
async function executeClaimedTerminalSession(input) {
  const {
    configService,
    apiKey,
    projectId,
    agent,
    useSandbox,
    agentPinned,
    session
  } = input;
  const repoRoot = getRepoRoot3();
  let sequence = 2;
  let heartbeatTimer = null;
  let completionStatus = "failed";
  let exitCode = null;
  let completionError = null;
  let cancellationRequested = false;
  try {
    await appendTerminalLogs(configService, apiKey, session.id, [
      {
        sequence: sequence++,
        stream: "system",
        chunk: `Executing command in ${repoRoot}
$ ${session.command}
`
      }
    ]);
    const child = spawn3("/bin/sh", ["-lc", session.command], {
      cwd: session.working_directory?.trim() || repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    heartbeatTimer = setInterval(async () => {
      try {
        const response = await apiRequest(
          configService,
          apiKey,
          `/terminal-sessions/${session.id}/heartbeat`,
          { method: "POST", body: JSON.stringify({}) }
        );
        const data = await response.json().catch(() => ({}));
        if (data.session?.cancellation_requested_at && !cancellationRequested) {
          cancellationRequested = true;
          child.kill("SIGTERM");
          await appendTerminalLogs(configService, apiKey, session.id, [
            {
              sequence: sequence++,
              stream: "system",
              chunk: "Cancellation requested from web UI. Stopping command.\n"
            }
          ]);
        }
      } catch {
      }
    }, 1e4);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      void appendTerminalLogs(configService, apiKey, session.id, [
        { sequence: sequence++, stream: "stdout", chunk: text }
      ]);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      void appendTerminalLogs(configService, apiKey, session.id, [
        { sequence: sequence++, stream: "stderr", chunk: text }
      ]);
    });
    const result = await new Promise((resolve3) => {
      child.on("exit", (code, signal) => resolve3({ code, signal }));
      child.on("error", (error) => {
        completionError = error.message;
        resolve3({ code: null, signal: null });
      });
    });
    exitCode = result.code;
    if (completionError) {
      completionStatus = cancellationRequested ? "cancelled" : "failed";
    } else if (cancellationRequested) {
      completionStatus = "cancelled";
    } else if (result.signal) {
      completionStatus = "interrupted";
      completionError = `Command terminated with signal ${result.signal}.`;
    } else if (result.code === 0) {
      completionStatus = "completed";
    } else {
      completionStatus = "failed";
      completionError = `Command exited with code ${result.code ?? "unknown"}.`;
    }
  } catch (error) {
    completionStatus = "failed";
    completionError = error instanceof Error ? error.message : String(error);
    await appendTerminalLogs(configService, apiKey, session.id, [
      {
        sequence: sequence++,
        stream: "system",
        chunk: `${completionError}
`
      }
    ]);
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    await apiRequest(
      configService,
      apiKey,
      `/terminal-sessions/${session.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          status: completionStatus,
          exit_code: exitCode,
          error_message: completionError,
          terminal_reason: completionStatus === "cancelled" ? "Command cancelled from workspace UI." : null
        })
      }
    );
    await sendRunnerHeartbeat(
      configService,
      apiKey,
      projectId,
      "idle",
      null,
      getRunnerCapabilities(agent, useSandbox, agentPinned)
    );
  }
}
function registerRunnerCommands(program2) {
  program2.command("runner").description("Run a paired worker that executes queued web task runs").option(
    "--agent <command>",
    "Agent command to launch for claimed tasks",
    "copilot"
  ).option("--poll-interval <seconds>", "Polling interval in seconds", "10").option("--once", "Claim at most one run and then exit").option(
    "--unsafe",
    "Disable Docker sandbox (run agent directly on host \u2014 no isolation)"
  ).action(async (options, command) => {
    const configService = new ConfigService();
    const apiKey = await ensureAuthenticated(configService);
    const projectId = await configService.getProjectId();
    if (!projectId) {
      throw new Error("This repository is not linked to a VEM project.");
    }
    const useSandbox = !options.unsafe;
    if (useSandbox) {
      checkDockerAvailable();
      ensureSandboxImage();
    }
    const pollIntervalMs = Math.max(
      2e3,
      Number.parseInt(String(options.pollInterval ?? "10"), 10) * 1e3
    );
    const agent = String(options.agent);
    const optionSource = typeof command.getOptionValueSource === "function" ? command.getOptionValueSource("agent") : void 0;
    const agentPinned = optionSource === "cli";
    const modeLabel = useSandbox ? "sandbox (Docker)" : "unsafe (direct)";
    console.log(
      chalk13.cyan(
        `Starting paired runner for project ${projectId} using agent "${agent}" [${modeLabel}]...`
      )
    );
    if (!useSandbox) {
      console.log(
        chalk13.yellow(
          "  \u26A0  Running in unsafe mode \u2014 agent has full host access."
        )
      );
    }
    let shouldStop = false;
    let consecutiveErrors = 0;
    process.on("SIGINT", () => {
      shouldStop = true;
    });
    process.on("SIGTERM", () => {
      shouldStop = true;
    });
    const claimBackend = useSandbox ? "local_sandbox" : "local_runner";
    while (!shouldStop) {
      try {
        const capabilities = getRunnerCapabilities(
          agent,
          useSandbox,
          agentPinned
        );
        await sendRunnerHeartbeat(
          configService,
          apiKey,
          projectId,
          "idle",
          null,
          capabilities
        );
        const claimResponse = await apiRequest(
          configService,
          apiKey,
          `/projects/${projectId}/task-runs/claim`,
          {
            method: "POST",
            body: JSON.stringify({
              agent_name: agent,
              backend: claimBackend,
              capabilities
            })
          }
        );
        if (!claimResponse.ok) {
          const data = await claimResponse.json().catch(() => ({}));
          throw new Error(
            data.error || "Failed to claim task run"
          );
        }
        const payload = await claimResponse.json();
        if (payload.run) {
          consecutiveErrors = 0;
          const runAgent = typeof payload.run.agent_name === "string" && payload.run.agent_name.trim().length > 0 ? payload.run.agent_name.trim() : agent;
          if (useSandbox) {
            const credentials = collectSandboxCredentials(runAgent);
            await executeClaimedRunInSandbox({
              configService,
              apiKey,
              projectId,
              agent: runAgent,
              run: payload.run,
              credentials
            });
          } else {
            await executeClaimedRun({
              configService,
              apiKey,
              projectId,
              agent: runAgent,
              useSandbox,
              agentPinned,
              run: payload.run
            });
          }
          if (options.once) break;
          continue;
        }
        const terminalClaimResponse = await apiRequest(
          configService,
          apiKey,
          `/projects/${projectId}/terminal-sessions/claim`,
          { method: "POST", body: JSON.stringify({ capabilities }) }
        );
        if (!terminalClaimResponse.ok) {
          const data = await terminalClaimResponse.json().catch(() => ({}));
          throw new Error(
            data.error || "Failed to claim terminal session"
          );
        }
        const terminalPayload = await terminalClaimResponse.json();
        if (terminalPayload.session) {
          consecutiveErrors = 0;
          await executeClaimedTerminalSession({
            configService,
            apiKey,
            projectId,
            agent,
            useSandbox,
            agentPinned,
            session: terminalPayload.session
          });
          if (options.once) break;
          continue;
        }
        consecutiveErrors = 0;
        if (options.once) break;
        await sleep(pollIntervalMs);
      } catch (pollError) {
        consecutiveErrors++;
        const backoffMs = Math.min(5e3 * consecutiveErrors, 6e4);
        const msg = pollError instanceof Error ? pollError.message : String(pollError);
        process.stderr.write(
          `[runner] poll error (attempt ${consecutiveErrors}): ${msg}. Retrying in ${backoffMs / 1e3}s...
`
        );
        await sleep(backoffMs);
      }
    }
    await sendRunnerHeartbeat(
      configService,
      apiKey,
      projectId,
      "offline",
      null,
      getRunnerCapabilities(agent, useSandbox, agentPinned)
    );
  });
}

// src/commands/search.ts
import chalk14 from "chalk";
function registerSearchCommands(program2) {
  program2.command("search <query>").description("Search project memory (tasks, context, decisions)").action(async (query) => {
    await trackCommandUsage("search");
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      console.log(chalk14.blue(`\u{1F50D} Searching for "${query}"...`));
      const res = await fetch(
        `${API_URL}/search?q=${encodeURIComponent(query)}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            ...await buildDeviceHeaders(configService)
          }
        }
      );
      if (!res.ok) {
        if (res.status === 401) {
          console.error(
            chalk14.red("Error: Unauthorized. Your API Key is invalid.")
          );
          return;
        }
        if (res.status === 403) {
          const errorData = await res.json().catch(() => ({}));
          console.error(
            chalk14.red(
              errorData.error || "Device limit reached. Disconnect a device or upgrade your plan."
            )
          );
          return;
        }
        const err = await res.text();
        throw new Error(`API Error ${res.status}: ${err}`);
      }
      const data = await res.json();
      if (!data.results || data.results.length === 0) {
        console.log(chalk14.yellow("No results found."));
        return;
      }
      console.log(chalk14.green(`
Found ${data.results.length} results:
`));
      data.results.forEach((item, i) => {
        const typeLabel = chalk14.gray(
          `[${item.type?.toUpperCase() || "UNKNOWN"}]`
        );
        console.log(
          `${i + 1}. ${typeLabel} ${chalk14.bold(item.title || "Untitled")}`
        );
        if (item.content) {
          console.log(
            chalk14.gray(
              `   ${item.content.substring(0, 100).replace(/\n/g, " ")}...`
            )
          );
        }
        if (item.score) {
          console.log(chalk14.gray(`   Score: ${item.score.toFixed(2)}`));
        }
        console.log("");
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk14.red("\n\u2716 Search Failed:"), error.message);
      } else {
        console.error(chalk14.red("\n\u2716 Search Failed:"), String(error));
      }
    }
  });
  program2.command("ask <question>").description("Ask a question about project memory (commits, diffs, tasks)").option("-p, --path <path>", "Limit results to a file path or directory").action(async (question, options) => {
    await trackCommandUsage("ask");
    try {
      const cleanedQuestion = typeof question === "string" ? question.trim() : "";
      if (!cleanedQuestion) {
        console.error(chalk14.red("\n\u2716 Question is required.\n"));
        return;
      }
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk14.red("\n\u2716 Project not linked. Run `vem link` first.\n")
        );
        return;
      }
      console.log(chalk14.blue(`Asking: "${cleanedQuestion}"...`));
      const payload = {
        question: cleanedQuestion
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
          ...await buildDeviceHeaders(configService)
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`API Error ${res.status}: ${err || res.statusText}`);
      }
      const data = await res.json();
      if (data.answer) {
        console.log(chalk14.green("\nAnswer:\n"));
        console.log(data.answer.trim());
      } else {
        console.log(chalk14.yellow("\nNo answer generated."));
      }
      const repoUrl = await getGitRemote();
      if (data.citations && data.citations.length > 0) {
        console.log(chalk14.green("\nCitations:"));
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
            } else if ((source.type === "code" || source.type === "diff") && source.path) {
              label = `File ${source.path}`;
              if (repoUrl) {
                link = `${repoUrl}/blob/${source.commit_hash || "HEAD"}/${source.path}`;
              }
            }
          }
          const note = cite.reason ? ` - ${cite.reason}` : "";
          if (link) {
            console.log(chalk14.gray(`${idx + 1}. ${label} (${link})${note}`));
          } else {
            console.log(chalk14.gray(`${idx + 1}. ${label}${note}`));
          }
        });
      }
      if (data.sources && data.sources.length > 0) {
        console.log(chalk14.green("\nSources:"));
        data.sources.forEach((source, idx) => {
          const details = [];
          if (source.type) details.push(source.type.toUpperCase());
          if (source.path) details.push(source.path);
          if (source.commit_hash)
            details.push(source.commit_hash.slice(0, 7));
          if (source.task_id) details.push(source.task_id);
          const header = [source.id, ...details].filter(Boolean).join(" \u2022 ");
          console.log(chalk14.gray(`${idx + 1}. ${header || "SOURCE"}`));
          if (source.title) {
            console.log(chalk14.gray(`   ${source.title}`));
          } else if (source.description) {
            console.log(chalk14.gray(`   ${source.description}`));
          }
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk14.red("\n\u2716 Ask Failed:"), error.message);
      } else {
        console.error(chalk14.red("\n\u2716 Ask Failed:"), String(error));
      }
    }
  });
}

// src/commands/sessions.ts
import chalk15 from "chalk";
import Table2 from "cli-table3";
import prompts7 from "prompts";
function formatDate(iso) {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return d.toLocaleDateString(void 0, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
async function getCurrentGitRoot() {
  try {
    const { execSync: execSync4 } = await import("child_process");
    return execSync4("git rev-parse --show-toplevel", {
      encoding: "utf-8"
    }).trim();
  } catch {
    return void 0;
  }
}
function registerSessionsCommands(program2) {
  const sessionsCmd = program2.command("sessions").description("Browse and import Copilot CLI agent sessions");
  sessionsCmd.command("list", { isDefault: true }).description(
    "List recent agent sessions for this repository (Copilot, Claude, Gemini)"
  ).option("-n, --limit <number>", "Number of sessions to show", "20").option("-b, --branch <branch>", "Filter by branch").option("--all", "Show sessions from all repositories").option(
    "--source <sources>",
    "Comma-separated sources to include: copilot,claude,gemini"
  ).action(async (opts) => {
    await trackCommandUsage("sessions.list");
    const gitRoot = opts.all ? void 0 : await getCurrentGitRoot();
    const sources = opts.source ? opts.source.split(",").map((s) => s.trim()) : void 0;
    let sessions = await listAllAgentSessions(gitRoot, sources);
    if (opts.branch) {
      sessions = sessions.filter((s) => s.branch === opts.branch);
    }
    const limit = Number.parseInt(opts.limit, 10) || 20;
    sessions = sessions.slice(0, limit);
    if (sessions.length === 0) {
      console.log(chalk15.gray("No agent sessions found for this repository."));
      return;
    }
    const sourceColor = (src) => {
      if (src === "copilot") return chalk15.blue(src);
      if (src === "claude") return chalk15.yellow(src);
      if (src === "gemini") return chalk15.cyan(src);
      return chalk15.gray(src);
    };
    const table = new Table2({
      head: [
        chalk15.bold("Source"),
        chalk15.bold("ID"),
        chalk15.bold("Summary"),
        chalk15.bold("Branch"),
        chalk15.bold("Updated")
      ],
      colWidths: [10, 12, 42, 18, 18],
      style: { head: [], border: ["gray"] }
    });
    for (const s of sessions) {
      table.push([
        sourceColor(s.source),
        chalk15.gray(`${s.id.slice(0, 8)}\u2026`),
        s.summary || chalk15.gray("(no summary)"),
        chalk15.cyan(s.branch || "\u2014"),
        chalk15.gray(formatDate(s.updated_at))
      ]);
    }
    console.log(table.toString());
    console.log(
      chalk15.gray(
        `
Showing ${sessions.length} session(s). Use ${chalk15.white("vem sessions import <id>")} to import a session into project memory.`
      )
    );
  });
  sessionsCmd.command("import <id>").description("Import an agent session into vem project memory").action(async (id) => {
    await trackCommandUsage("sessions.import");
    const gitRoot = await getCurrentGitRoot();
    let session = null;
    if (id.length < 36) {
      const all = await listAllAgentSessions(gitRoot);
      const match = all.find((s) => s.id.startsWith(id));
      if (!match) {
        console.error(chalk15.red(`No session found matching prefix: ${id}`));
        process.exit(1);
      }
      session = match;
      console.log(
        chalk15.gray(`Resolved to ${match.source} session: ${match.id}`)
      );
    } else {
      const all = await listAllAgentSessions(gitRoot);
      session = all.find((s) => s.id === id) ?? null;
      if (!session) {
        const detail = await readCopilotSessionDetail(id);
        if (detail) {
          session = {
            id: detail.id,
            source: "copilot",
            summary: detail.summary,
            branch: detail.branch,
            repository: detail.repository,
            git_root: detail.git_root,
            cwd: detail.cwd,
            created_at: detail.created_at,
            updated_at: detail.updated_at,
            intents: detail.intents,
            user_messages: detail.user_messages
          };
        }
      }
    }
    if (!session) {
      console.error(chalk15.red(`Session not found: ${id}`));
      process.exit(1);
    }
    console.log(chalk15.bold("\n\u{1F4CB} Session Summary"));
    console.log(chalk15.white(`  ID:       ${session.id}`));
    console.log(chalk15.white(`  Source:   ${session.source}`));
    console.log(chalk15.white(`  Branch:   ${session.branch || "\u2014"}`));
    console.log(chalk15.white(`  Updated:  ${formatDate(session.updated_at)}`));
    console.log(
      chalk15.white(`  Summary:  ${session.summary || "(no summary)"}`)
    );
    if (session.intents.length > 0) {
      console.log(chalk15.bold("\n\u{1F3AF} Intents recorded in this session:"));
      for (const intent of session.intents) {
        console.log(chalk15.gray(`  \u2022 ${intent}`));
      }
    }
    if (session.user_messages.length > 0) {
      console.log(chalk15.bold("\n\u{1F4AC} First user message:"));
      const preview = session.user_messages[0].slice(0, 200);
      console.log(
        chalk15.gray(
          `  ${preview}${session.user_messages[0].length > 200 ? "\u2026" : ""}`
        )
      );
    }
    console.log();
    const { addChangelog } = await prompts7({
      type: "confirm",
      name: "addChangelog",
      message: "Add session summary as a changelog entry?",
      initial: !!session.summary
    });
    if (addChangelog) {
      const changelogEntry = session.summary ? `${session.source} agent session (${session.branch || "unknown branch"}): ${session.summary}` : `${session.source} agent session (${session.branch || "unknown branch"}) on ${formatDate(session.updated_at)}`;
      const changelogLog = new ScalableLogService(CHANGELOG_DIR);
      const gitHash = getGitHash();
      await changelogLog.addEntry(
        "Session Import",
        `- ${changelogEntry}`,
        gitHash ? { commitHash: gitHash } : void 0
      );
      console.log(chalk15.green("\u2713 Changelog entry added."));
    }
    const taskService2 = new TaskService();
    const tasks = await taskService2.getTasks();
    const activeTasks = tasks.filter(
      (t) => !t.deleted_at && t.status !== "done"
    );
    if (activeTasks.length > 0) {
      const { linkTask } = await prompts7({
        type: "confirm",
        name: "linkTask",
        message: "Link this session to an active task (add evidence)?",
        initial: false
      });
      if (linkTask) {
        const { taskId } = await prompts7({
          type: "select",
          name: "taskId",
          message: "Which task?",
          choices: activeTasks.slice(0, 20).map((t) => ({
            title: `${t.id} \u2014 ${t.title}`,
            value: t.id
          }))
        });
        if (taskId) {
          const evidenceLine = `Agent session ${session.id.slice(0, 8)}: ${session.summary || session.intents.slice(0, 2).join(", ") || "session imported"}`;
          const existingTask = await taskService2.getTask(taskId);
          const existingSessions = existingTask?.sessions || [];
          const alreadyAttached = existingSessions.some(
            (s) => s.id === session.id
          );
          const sessionRef = !alreadyAttached ? {
            id: session.id,
            source: session.source,
            started_at: session.created_at,
            ...session.summary ? { summary: session.summary } : {}
          } : null;
          await taskService2.updateTask(taskId, {
            evidence: [evidenceLine],
            ...sessionRef ? { sessions: [...existingSessions, sessionRef] } : {}
          });
          console.log(
            chalk15.green(`\u2713 Linked to task ${taskId} with evidence.`)
          );
        }
      }
    }
    console.log(chalk15.bold("\n\u2705 Done."));
  });
}

// src/commands/setup.ts
import path3 from "path";
import chalk16 from "chalk";
import fs4 from "fs-extra";
import prompts8 from "prompts";
var COMMAND_BASELINE = [
  "quickstart",
  "agent",
  "task add",
  "task start",
  "task done",
  "push",
  "search",
  "ask",
  "finalize",
  "archive",
  "status",
  "doctor"
];
var REQUIRED_GITIGNORE_ENTRIES = [".vem/"];
var VEM_AGENT_ENFORCEMENT_MARKER = "## vem Working Rules (Enforced)";
var VEM_AGENT_ENFORCEMENT_BLOCK = `${VEM_AGENT_ENFORCEMENT_MARKER}

All AI agents in this repository must use \`vem\` and follow the working rules.

1. Start each session by reading active tasks and context through \`vem\` (\`vem task list\`, \`vem context show\`).
2. After code changes, persist memory updates through \`vem\` CLI commands (\`vem context set\`, \`vem task ...\`, \`vem decision add\`, or \`vem finalize\` for \`vem_update\` blocks).
3. Keep task updates atomic and mark completed work as done with evidence.
4. Record significant architectural decisions with \`vem decision add\`.
5. **ALWAYS run \`vem finalize\` immediately after producing a \`vem_update\` block.** Never leave a \`vem_update\` block unfinalized. Use:
   \`\`\`sh
   cat <<'EOF' | vem finalize --file /dev/stdin
   { ...vem_update JSON... }
   EOF
   \`\`\`
`;
async function ensureVemGitignoreEntry() {
  const repoRoot = await getRepoRoot();
  const gitignorePath = path3.join(repoRoot, ".gitignore");
  if (!await fs4.pathExists(gitignorePath)) {
    await fs4.writeFile(
      gitignorePath,
      `${REQUIRED_GITIGNORE_ENTRIES.join("\n")}
`,
      "utf-8"
    );
    return;
  }
  const content = await fs4.readFile(gitignorePath, "utf-8");
  const entries = content.split(/\r?\n/).map((line) => line.trim());
  const missingEntries = REQUIRED_GITIGNORE_ENTRIES.filter(
    (entry) => !entries.includes(entry)
  );
  if (missingEntries.length === 0) {
    return;
  }
  const separator = content.endsWith("\n") ? "" : "\n";
  await fs4.appendFile(
    gitignorePath,
    `${separator}${missingEntries.join("\n")}
`,
    "utf-8"
  );
}
async function ensureAgentInstructionPolicy() {
  const repoRoot = await getRepoRoot();
  const existingFiles = [];
  for (const file of KNOWN_AGENT_INSTRUCTION_FILES) {
    if (await fs4.pathExists(path3.join(repoRoot, file))) {
      existingFiles.push(file);
    }
  }
  let createdAgentsFile = false;
  let targets = [];
  if (existingFiles.length === 0) {
    await fs4.writeFile(
      path3.join(repoRoot, "AGENTS.md"),
      "# AGENTS\n\nThis repository uses `vem` for agent workflows.\n",
      "utf-8"
    );
    createdAgentsFile = true;
    targets = ["AGENTS.md"];
  } else if (existingFiles.includes("AGENTS.md")) {
    targets = ["AGENTS.md"];
  } else {
    targets = existingFiles;
  }
  const updatedFiles = [];
  for (const relativePath of targets) {
    const absolutePath = path3.join(repoRoot, relativePath);
    const content = await fs4.readFile(absolutePath, "utf-8");
    if (content.includes(VEM_AGENT_ENFORCEMENT_MARKER)) {
      continue;
    }
    const separator = content.endsWith("\n") ? "" : "\n";
    await fs4.appendFile(
      absolutePath,
      `${separator}
${VEM_AGENT_ENFORCEMENT_BLOCK}`,
      "utf-8"
    );
    updatedFiles.push(relativePath);
  }
  return {
    createdAgentsFile,
    updatedFiles
  };
}
async function collectAgentInstructionPayload() {
  const repoRoot = await getRepoRoot();
  const payload = [];
  for (const relativePath of KNOWN_AGENT_INSTRUCTION_FILES) {
    const absolutePath = path3.join(repoRoot, relativePath);
    if (!await fs4.pathExists(absolutePath)) continue;
    const stat2 = await fs4.stat(absolutePath);
    if (!stat2.isFile()) continue;
    payload.push({
      path: relativePath,
      content: await fs4.readFile(absolutePath, "utf-8")
    });
  }
  return payload;
}
async function syncAgentInstructionsToCloud(configService, projectId, apiKey) {
  const instructions = await collectAgentInstructionPayload();
  const response = await fetch(
    `${API_URL}/projects/${projectId}/instructions`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...await buildDeviceHeaders(configService)
      },
      body: JSON.stringify({ instructions })
    }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText }));
    const message = typeof data?.error === "string" ? data.error : response.statusText;
    throw new Error(message);
  }
  return instructions.length;
}
var getSortedCommandEntries = (stats) => Object.entries(stats.commandCounts).sort((a, b) => b[1] - a[1]);
var formatRelativeTime = (timestamp) => {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 6e4) return "just now";
  if (elapsed < 36e5) return `${Math.floor(elapsed / 6e4)} min ago`;
  if (elapsed < 864e5) return `${Math.floor(elapsed / 36e5)} hr ago`;
  return `${Math.floor(elapsed / 864e5)} day(s) ago`;
};
var renderUsageInsights = (stats, detailed = false) => {
  const entries = getSortedCommandEntries(stats);
  console.log(chalk16.bold("\n\u{1F4C8} Command Insights\n"));
  if (entries.length === 0) {
    console.log(chalk16.gray("  No command usage recorded yet."));
    console.log(chalk16.gray("  Start with: vem quickstart"));
    return;
  }
  const rows = detailed ? entries : entries.slice(0, 6);
  console.log(chalk16.gray(`  Commands tracked: ${entries.length}`));
  rows.forEach(([command, count], index) => {
    console.log(
      `  ${chalk16.gray(`${index + 1}.`)} ${chalk16.white(command)} ${chalk16.gray(`(${count})`)}`
    );
  });
  if (!detailed && entries.length > rows.length) {
    console.log(chalk16.gray(`  ...and ${entries.length - rows.length} more`));
  }
  const neverUsed = COMMAND_BASELINE.filter(
    (command) => (stats.commandCounts[command] || 0) === 0
  );
  if (neverUsed.length > 0) {
    console.log(chalk16.gray("\n  Suggested next commands:"));
    neverUsed.slice(0, 3).forEach((command) => {
      console.log(`    ${chalk16.cyan(command)}`);
    });
  }
  if (stats.lastPush) {
    console.log(
      chalk16.gray(`
  Last push: ${formatRelativeTime(stats.lastPush)}`)
    );
  }
  if (stats.lastAgentRun) {
    console.log(
      chalk16.gray(
        `  Last agent session: ${formatRelativeTime(stats.lastAgentRun)}`
      )
    );
  }
};
function registerSetupCommands(program2) {
  program2.command("init").description("Initialize vem in the current repository").action(async () => {
    try {
      if (await hasUncommittedChanges()) {
        console.log(
          chalk16.yellow(
            "\n\u26A0 Uncommitted changes detected in this workspace.\n"
          )
        );
        const proceed = await prompts8({
          type: "confirm",
          name: "confirmInit",
          message: "Continue with `vem init` anyway?",
          initial: false
        });
        if (!proceed.confirmInit) {
          console.log(chalk16.yellow("Initialization cancelled.\n"));
          return;
        }
      }
      const dir = await ensureVemDir();
      await ensureVemFiles();
      await ensureVemGitignoreEntry();
      const configService = new ConfigService();
      const initHash = await computeVemHash();
      await configService.setLastSyncedVemHash(initHash);
      const agentInstructions = await ensureAgentInstructionPolicy();
      console.log(chalk16.green(`
\u2714 vem initialized at ${dir}
`));
      if (agentInstructions.createdAgentsFile) {
        console.log(
          chalk16.gray(
            "Created AGENTS.md because no agent instruction files were found."
          )
        );
      }
      if (agentInstructions.updatedFiles.length > 0) {
        console.log(
          chalk16.gray(
            `Updated agent instructions: ${agentInstructions.updatedFiles.join(", ")}`
          )
        );
      }
      await installGitHook();
      const projectId = await configService.getProjectId();
      const apiKey = await tryAuthenticatedKey(configService);
      let resolvedProjectId = projectId;
      if (apiKey && !projectId) {
        const { doLink } = await prompts8({
          type: "confirm",
          name: "doLink",
          message: "Link this repo to a vem cloud project now?",
          initial: true
        });
        if (doLink) {
          try {
            resolvedProjectId = await runInteractiveLinkFlow(
              apiKey,
              configService
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(chalk16.yellow(`\u26A0 Link skipped: ${msg}`));
          }
        } else {
          console.log(
            chalk16.gray(
              "Tip: Run `vem link` at any time to connect this repo to a project."
            )
          );
        }
      }
      if (apiKey && resolvedProjectId) {
        try {
          const syncedCount = await syncAgentInstructionsToCloud(
            configService,
            resolvedProjectId,
            apiKey
          );
          console.log(
            chalk16.gray(
              `Synced ${syncedCount} agent instruction file${syncedCount === 1 ? "" : "s"} to cloud memory.`
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(
            chalk16.yellow(`\u26A0 Agent instruction sync skipped: ${message}`)
          );
        }
      } else if (!apiKey) {
        console.log(
          chalk16.gray(
            "Tip: Use the web dashboard project settings to run reindexing after `vem login` + `vem link`."
          )
        );
      }
    } catch (error) {
      console.error(chalk16.red("\n\u2716 Failed to initialize vem:"), error);
      process.exit(1);
    }
  });
  program2.command("quickstart").description("Interactive guide to powerful VEM workflows").action(async () => {
    await trackCommandUsage("quickstart");
    console.log(chalk16.bold.cyan("\n\u{1F680} VEM Quickstart Guide\n"));
    console.log("Let's set up a powerful agent-driven workflow!\n");
    const configService = new ConfigService();
    if (!await isVemInitialized()) {
      console.log(chalk16.yellow("Step 1: Initialize VEM\n"));
      const initResponse = await prompts8({
        type: "confirm",
        name: "init",
        message: "Initialize .vem/ in this repository?",
        initial: true
      });
      if (!initResponse.init) {
        console.log(chalk16.yellow("Quickstart cancelled."));
        return;
      }
      try {
        await ensureVemDir();
        await ensureVemFiles();
        await ensureVemGitignoreEntry();
        const initHash = await computeVemHash();
        await configService.setLastSyncedVemHash(initHash);
        console.log(chalk16.green("\u2713 VEM initialized\n"));
      } catch (error) {
        console.error(chalk16.red("Failed to initialize:"), error.message);
        return;
      }
    } else {
      console.log(chalk16.green("\u2713 VEM already initialized\n"));
    }
    let isAuthenticated = false;
    try {
      const key = await configService.getApiKey();
      isAuthenticated = !!key;
    } catch {
      isAuthenticated = false;
    }
    if (!isAuthenticated) {
      console.log(chalk16.yellow("Step 2: Authenticate\n"));
      console.log("Get your API key from: https://vem.dev/keys\n");
      const authResponse = await prompts8({
        type: "text",
        name: "apiKey",
        message: "Paste your API key:"
      });
      if (!authResponse.apiKey) {
        console.log(chalk16.yellow("Quickstart cancelled."));
        return;
      }
      await configService.setApiKey(authResponse.apiKey);
      console.log(chalk16.green("\u2713 Authenticated\n"));
    } else {
      console.log(chalk16.green("\u2713 Already authenticated\n"));
    }
    const projectId = await configService.getProjectId().catch(() => null);
    if (!projectId) {
      console.log(chalk16.yellow("Step 3: Link to project\n"));
      console.log("This connects your local .vem/ to cloud sync.\n");
      const linkResponse = await prompts8({
        type: "confirm",
        name: "link",
        message: "Link to a project now?",
        initial: true
      });
      if (linkResponse.link) {
        console.log(chalk16.cyan("\nRun: vem link"));
        console.log(chalk16.gray("(You can select or create a project)\n"));
      }
    } else {
      console.log(chalk16.green(`\u2713 Linked to project: ${projectId}
`));
    }
    console.log(chalk16.bold.cyan("\n\u{1F4CB} Task-Driven Workflow\n"));
    console.log(
      "Tasks help you track work and provide context to AI agents.\n"
    );
    const taskResponse = await prompts8({
      type: "confirm",
      name: "createTask",
      message: "Create your first task?",
      initial: true
    });
    if (taskResponse.createTask) {
      const taskDetails = await prompts8([
        {
          type: "text",
          name: "title",
          message: "Task title:",
          initial: "Set up VEM workflow"
        },
        {
          type: "text",
          name: "description",
          message: "Description (optional):"
        }
      ]);
      if (taskDetails.title) {
        const task = await taskService.addTask(
          taskDetails.title,
          taskDetails.description || "",
          "medium"
        );
        console.log(chalk16.green(`
\u2713 Created task: ${task.id}`));
      }
    }
    console.log(chalk16.bold.cyan("\n\u{1F916} Agent-Driven Development\n"));
    console.log("The 'vem agent' command wraps AI tools with:\n");
    console.log("  \u2022 Automatic context injection");
    console.log("  \u2022 Task tracking");
    console.log("  \u2022 Strict memory enforcement");
    console.log("  \u2022 Validation workflows\n");
    const agentResponse = await prompts8({
      type: "confirm",
      name: "launchAgent",
      message: "Launch an agent session now?",
      initial: false
    });
    if (agentResponse.launchAgent) {
      console.log(chalk16.cyan("\n\u{1F680} Launching agent...\n"));
      console.log(chalk16.white("Run: vem agent\n"));
    }
    console.log(chalk16.bold.cyan("\n\u2728 Quick Reference\n"));
    console.log(
      chalk16.white("  vem agent") + chalk16.gray("         # Start AI-assisted work")
    );
    console.log(
      chalk16.white("  vem task list") + chalk16.gray("     # View tasks")
    );
    console.log(
      chalk16.white("  vem task add") + chalk16.gray("      # Create task")
    );
    console.log(
      chalk16.white("  vem push") + chalk16.gray("          # Sync to cloud")
    );
    console.log(
      chalk16.white("  vem search") + chalk16.gray("        # Query memory")
    );
    console.log(
      chalk16.white("  vem status") + chalk16.gray("        # Check power score\n")
    );
    console.log(chalk16.green("\u{1F389} You're ready to use VEM powerfully!\n"));
  });
  program2.command("status").description("Show current project status").action(async () => {
    await trackCommandUsage("status");
    try {
      await ensureVemFiles();
      const configService = new ConfigService();
      console.log(chalk16.bold("\n\u{1F4CA} vem Status\n"));
      const apiKey = await configService.getApiKey();
      if (apiKey) {
        try {
          const response = await fetch(`${API_URL}/verify`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...await buildDeviceHeaders(configService)
            }
          });
          if (response.ok) {
            const data = await response.json();
            console.log(
              `Login Status: ${chalk16.green("Logged In")} (User: ${data.userId})`
            );
            console.log(
              chalk16.gray("               (Run `vem logout` to sign out)")
            );
          } else {
            console.log(
              `Login Status: ${chalk16.red(
                "Invalid Session"
              )} (Run \`vem login\` to fix)`
            );
          }
        } catch (_err) {
          console.log(
            `Login Status: ${chalk16.yellow(
              "Logged In (Offline/Unverified)"
            )} (Cannot reach API)`
          );
        }
      } else {
        console.log(
          `Login Status: ${chalk16.red(
            "Not Logged In"
          )} (Run \`vem login\` options)`
        );
      }
      const projectId = await configService.getProjectId();
      if (projectId) {
        if (apiKey) {
          const check = await validateProject(
            projectId,
            apiKey,
            configService
          );
          if (check.valid) {
            const label = check.name ? `${check.name} (${projectId})` : projectId;
            console.log(`Linked Project: ${chalk16.green(label)}`);
          } else {
            console.log(
              `Linked Project: ${chalk16.red(projectId)} ${chalk16.red("(not found \u2014 project may have been deleted)")}`
            );
            console.log(
              chalk16.gray(
                "               Run `vem unlink` then `vem link` to fix."
              )
            );
          }
        } else {
          console.log(
            `Linked Project: ${chalk16.yellow(projectId)} (unverified \u2014 not logged in)`
          );
        }
      } else {
        console.log(
          `Linked Project: ${chalk16.yellow("Not Linked")} (Run \`vem link\`)`
        );
      }
      try {
        const tasks = await taskService.getTasks();
        const active = tasks.filter(
          (t) => t.status !== "done" && !t.deleted_at
        ).length;
        const completed = tasks.filter(
          (t) => t.status === "done" && !t.deleted_at
        ).length;
        console.log(`
Local Tasks:`);
        console.log(`  Open:      ${chalk16.yellow(active)}`);
        console.log(`  Completed: ${chalk16.green(completed)}`);
      } catch (_err) {
        console.log(
          `
Local Tasks:   ${chalk16.gray("Not initialized (Run `vem init`)")}`
        );
      }
      const stats = await metricsService.getStats();
      console.log(chalk16.bold("\n\u26A1 Power Feature Usage\n"));
      const scoreColor = stats.powerScore >= 70 ? chalk16.green : stats.powerScore >= 40 ? chalk16.yellow : chalk16.gray;
      console.log(`  Power Score: ${scoreColor(`${stats.powerScore}/100`)}`);
      const features = [
        {
          name: "Agent-driven workflow",
          used: (stats.commandCounts.agent || 0) > 0,
          points: 30
        },
        {
          name: "Strict memory enforcement",
          used: stats.featureFlags.strict_memory,
          points: 20
        },
        {
          name: "Task-driven work",
          used: stats.featureFlags.task_driven,
          points: 20
        },
        {
          name: "Finalize automation",
          used: (stats.commandCounts.finalize || 0) > 0,
          points: 15
        },
        {
          name: "Context search",
          used: (stats.commandCounts.search || 0) > 0 || (stats.commandCounts.ask || 0) > 0,
          points: 10
        },
        {
          name: "Archive management",
          used: (stats.commandCounts.archive || 0) > 0,
          points: 5
        }
      ];
      console.log(chalk16.gray("\n  Features:"));
      for (const feature of features) {
        const icon = feature.used ? chalk16.green("\u2713") : chalk16.gray("\u25CB");
        const name = feature.used ? chalk16.white(feature.name) : chalk16.gray(feature.name);
        const pts = feature.used ? chalk16.green(`+${feature.points}`) : chalk16.gray(`+${feature.points}`);
        console.log(`    ${icon} ${name} ${pts}`);
      }
      if (stats.powerScore < 40) {
        console.log(
          chalk16.yellow(
            "\n  \u{1F4A1} Tip: Try 'vem agent' to unlock powerful workflows"
          )
        );
      } else if (stats.powerScore < 70) {
        console.log(
          chalk16.cyan(
            "\n  \u{1F4A1} You're on your way! Keep using task-driven workflows"
          )
        );
      } else {
        console.log(
          chalk16.green("\n  \u{1F389} Excellent! You're using VEM like a pro")
        );
      }
      if (stats.lastAgentRun) {
        const timeSince = Date.now() - stats.lastAgentRun;
        const days = Math.floor(timeSince / (1e3 * 60 * 60 * 24));
        console.log(chalk16.bold("\n\u{1F4C5} Recent Activity\n"));
        console.log(
          `  Last agent session: ${days === 0 ? "today" : `${days} days ago`}`
        );
      }
      renderUsageInsights(stats, false);
      console.log("");
    } catch (error) {
      console.error(chalk16.red("\n\u2716 Failed to check status:"), error.message);
    }
  });
  program2.command("insights").description("Show detailed usage metrics and workflow insights").option("--json", "Output raw usage metrics as JSON").action(async (options) => {
    await trackCommandUsage("insights");
    try {
      await ensureVemFiles();
      const stats = await metricsService.getStats();
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(chalk16.bold("\n\u{1F4CA} vem Insights\n"));
      console.log(`Power Score: ${chalk16.cyan(`${stats.powerScore}/100`)}`);
      renderUsageInsights(stats, true);
      console.log("");
    } catch (error) {
      console.error(chalk16.red("\n\u2716 Failed to load insights:"), error.message);
    }
  });
}

// src/commands/sync.ts
import { readFile as readFile6 } from "fs/promises";
import chalk17 from "chalk";
import Table3 from "cli-table3";
function registerSyncCommands(program2) {
  program2.command("push").description("Push local snapshot to cloud").option(
    "--dry-run",
    "Preview what would be pushed without actually pushing"
  ).option("--force", "Push even if no changes detected").action(async (options) => {
    await trackCommandUsage("push");
    try {
      const configService = new ConfigService();
      const projectId = await configService.getProjectId();
      if (!projectId) {
        console.error(
          chalk17.red(
            "Error: Project not linked. Run `vem link <projectId>` before pushing snapshots."
          )
        );
        return;
      }
      const key = await ensureAuthenticated(configService);
      const baseVersion = await configService.getLastVersion();
      await processQueue(syncService, configService, key);
      const repoUrl = projectId ? null : await getGitRemote();
      const gitHash = getGitHash();
      if (!gitHash) {
        console.error(
          chalk17.red(
            "Error: git HEAD not found. Create at least one commit before running `vem push`."
          )
        );
        return;
      }
      const vemHash = await computeVemHash();
      const lastPush = await configService.getLastPushState();
      const hasChanges = !(vemHash && lastPush.gitHash === gitHash && lastPush.vemHash === vemHash);
      if (!hasChanges && !options.force) {
        const lastPushTime = lastPush.gitHash ? "previously" : "never";
        console.log(
          chalk17.gray(
            `\u2714 No changes since last push (git HEAD and .vem unchanged). Last push: ${lastPushTime}`
          )
        );
        console.log(chalk17.gray("   Use --force to push anyway."));
        return;
      }
      console.log(chalk17.blue("\u{1F4E6} Packing snapshot..."));
      const snapshot = await syncService.pack();
      const snapshotHash = computeSnapshotHash(snapshot);
      const targetLabel = `linked project ${projectId}`;
      if (options.dryRun) {
        console.log(chalk17.cyan("\n\u{1F4CB} Dry Run Preview\n"));
        console.log(chalk17.white(`Target: ${targetLabel}`));
        console.log(chalk17.white(`Git Hash: ${gitHash}`));
        console.log(chalk17.white(`Snapshot Hash: ${snapshotHash}`));
        console.log(chalk17.white(`Base Version: ${baseVersion || "none"}`));
        console.log(
          chalk17.white(
            "Verification: pending until Git webhook matches git hash + snapshot hash"
          )
        );
        const taskCount = snapshot.tasks?.tasks?.length || 0;
        const decisionCount = snapshot.decisions?.length || 0;
        const changelogCount = snapshot.changelog?.length || 0;
        const agentInstructionCount = snapshot.agent_instructions?.length || 0;
        console.log(chalk17.white(`
Snapshot Contents:`));
        console.log(chalk17.gray(`  Tasks: ${taskCount}`));
        console.log(chalk17.gray(`  Decisions (chars): ${decisionCount}`));
        console.log(chalk17.gray(`  Changelog (chars): ${changelogCount}`));
        console.log(
          chalk17.gray(`  Context: ${snapshot.context ? "yes" : "no"}`)
        );
        console.log(
          chalk17.gray(
            `  Current state: ${snapshot.current_state ? "yes" : "no"}`
          )
        );
        console.log(
          chalk17.gray(
            `  Agent instructions: ${agentInstructionCount} file${agentInstructionCount === 1 ? "" : "s"}`
          )
        );
        console.log(chalk17.cyan("\n\u2714 Dry run complete. No changes pushed.\n"));
        console.log(chalk17.gray("   Run without --dry-run to push for real."));
        return;
      }
      console.log(chalk17.blue(`\u{1F680} Pushing to cloud (${targetLabel})...`));
      const commits = await getCommits(50);
      const payload = {
        ...snapshot,
        ...repoUrl ? { repo_url: repoUrl } : {},
        base_version: baseVersion,
        commits,
        project_id: projectId,
        git_hash: gitHash,
        snapshot_hash: snapshotHash
      };
      let result = await performPush(payload, key, configService);
      if (!result.success && result.status === 409 && result.data?.expected_repo_url && projectId) {
        const expectedRepoUrl = result.data.expected_repo_url;
        const actualRepo = repoUrl || "(no git remote)";
        console.log(
          chalk17.yellow(
            `Project is linked to ${expectedRepoUrl}. Local repo is ${actualRepo}. Retrying using the linked project only...`
          )
        );
        console.log(
          chalk17.blue(
            `\u{1F680} Pushing to cloud (linked repo ${expectedRepoUrl})...`
          )
        );
        const retryPayload = { ...payload };
        delete retryPayload.repo_url;
        result = await performPush(retryPayload, key, configService);
      }
      if (result.success) {
        if (gitHash && vemHash) {
          await configService.setLastPushState({ gitHash, vemHash });
          await configService.setLastSyncedVemHash(vemHash);
        }
        console.log(
          chalk17.green(
            `
\u2714 Snapshot pushed! Version: ${result.data.version || "v1"}
`
          )
        );
        try {
          const archivedCount = await taskService.archiveTasks({
            status: "done"
          });
          if (archivedCount > 0) {
            console.log(
              chalk17.green(`\u2714 Archived ${archivedCount} completed tasks.`)
            );
          }
        } catch (err) {
          console.error(
            chalk17.yellow(
              `\u26A0 Failed to archive completed tasks: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }
        await showWorkflowHint("push");
      } else {
        if (result.status === 409) {
          const data = result.data;
          if (data.latest_version) {
            const latest = data.latest_version || "unknown";
            console.error(
              chalk17.yellow(
                `Conflict: local base version ${baseVersion || "none"} does not match latest ${latest}. Pull the latest snapshot (\`vem pull\`) or re-run push from the latest memory state.`
              )
            );
            return;
          }
          if (data.expected_repo_url) {
            const expectedRepoUrl = data.expected_repo_url;
            const actualRepo = repoUrl || "(no git remote)";
            console.error(
              chalk17.yellow(
                `Project is linked to ${expectedRepoUrl}, local repo is ${actualRepo}. Update your git remote or re-link the project, then retry.`
              )
            );
            return;
          }
          console.error(chalk17.yellow(data.error || "Conflict detected."));
          return;
        }
        if (result.status === 403) {
          console.error(
            chalk17.red(
              result.error || "Device limit reached. Disconnect a device or upgrade your plan."
            )
          );
          return;
        }
        if (result.status === 404) {
          console.error(
            chalk17.red(
              result.error || "Project not found. It may have been deleted. Run `vem unlink` then `vem link` to reconnect."
            )
          );
          return;
        }
        console.log(
          chalk17.yellow(
            `
\u26A0 Push failed (${result.error}). Queuing snapshot for later...`
          )
        );
        const id = await syncService.enqueue(payload);
        console.log(chalk17.gray(`Queued as ${id}`));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk17.red("\n\u2716 Push Failed:"), error.message);
      } else {
        console.error(chalk17.red("\n\u2716 Push Failed:"), String(error));
      }
    }
  });
  program2.command("pull").description("Pull latest snapshot from cloud").option("-f, --force", "Overwrite local changes without warning").action(async (options) => {
    try {
      const configService = new ConfigService();
      const key = await ensureAuthenticated(configService);
      const projectId = await configService.getProjectId();
      if (await isVemDirty(configService) && !options.force) {
        console.error(
          chalk17.yellow(
            "\u26A0 Local .vem memory has unsynced changes. Pulling will overwrite it."
          )
        );
        console.log(
          chalk17.gray(
            "Push your snapshot first, or use `vem pull --force` to proceed."
          )
        );
        return;
      }
      const repoUrl = projectId ? null : await getGitRemote();
      if (!repoUrl && !projectId) {
        console.error(
          chalk17.red(
            "Error: Could not detect git remote URL or linked project. Run `vem link <projectId>` or set a git remote."
          )
        );
        return;
      }
      const targetLabel = repoUrl || projectId || "project";
      console.log(
        chalk17.blue(`\u2B07 Finding latest snapshot for ${targetLabel}...`)
      );
      const query = new URLSearchParams();
      if (repoUrl) query.set("repo_url", repoUrl);
      if (projectId) query.set("project_id", projectId);
      const res = await fetch(`${API_URL}/snapshots/latest?${query}`, {
        headers: {
          Authorization: `Bearer ${key}`,
          ...await buildDeviceHeaders(configService)
        }
      });
      if (!res.ok) {
        const data2 = await res.json().catch(() => ({}));
        if (res.status === 404) {
          const message = typeof data2.error === "string" ? data2.error : "Project not found. It may have been deleted. Run `vem unlink` then `vem link` to reconnect.";
          console.log(chalk17.yellow(message));
          if (message.toLowerCase().includes("no snapshots")) {
            console.log(
              chalk17.gray(
                "Tip: push a snapshot first (`vem push`) and wait for verification if needed."
              )
            );
          }
          return;
        }
        if (res.status === 409) {
          if (data2.expected_repo_url) {
            console.error(
              chalk17.yellow(
                `Repo URL mismatch. Expected ${data2.expected_repo_url}. Update your git remote or project settings, then retry.`
              )
            );
            return;
          }
          console.error(chalk17.yellow(data2.error || "Conflict detected."));
          return;
        }
        if (res.status === 403) {
          console.error(
            chalk17.red(
              data2.error || "Device limit reached. Disconnect a device or upgrade your plan."
            )
          );
          return;
        }
        throw new Error(
          `API Error ${res.status}: ${data2.error || res.statusText}`
        );
      }
      const data = await res.json();
      if (!data.snapshot) {
        console.log(chalk17.yellow("No snapshot data in response."));
        return;
      }
      console.log(chalk17.blue("\u{1F4E6} Unpacking snapshot..."));
      await syncService.unpack(data.snapshot);
      const localHash = await computeVemHash();
      await configService.setLastSyncedVemHash(localHash);
      if (data.version) {
        await configService.setLastVersion(data.version);
      }
      console.log(
        chalk17.green(`
\u2714 Synced to version ${data.version || "unknown"}
`)
      );
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk17.red("\n\u2716 Pull Failed:"), error.message);
      } else {
        console.error(chalk17.red("\n\u2716 Pull Failed:"), String(error));
      }
    }
  });
  program2.command("pack").description("Generate a vem_pack block for agent prompts").option("--json", "Output raw JSON instead of a fenced block").option("--full", "Include full snapshot content (default is compact)").action(async (options) => {
    await trackCommandUsage("pack");
    try {
      await ensureVemFiles();
      const snapshot = options.full ? await syncService.pack() : await syncService.packForAgent();
      const output = options.json ? JSON.stringify(snapshot, null, 2) : formatVemPack(snapshot);
      console.log(output);
      await showWorkflowHint("pack");
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk17.red("\n\u2716 Pack Failed:"), error.message);
      } else {
        console.error(chalk17.red("\n\u2716 Pack Failed:"), String(error));
      }
    }
  });
  program2.command("finalize").description("Apply a vem_update v1 block to local memory artifacts").option("-f, --file <path>", "Path to an agent response or update block").action(async (options) => {
    await trackCommandUsage("finalize");
    try {
      let input = "";
      if (options.file) {
        input = await readFile6(options.file, "utf-8");
      } else if (!process.stdin.isTTY) {
        input = await readStdin();
      } else {
        console.error(
          chalk17.red(
            "Provide a vem_update block via --file or pipe it into stdin."
          )
        );
        process.exitCode = 1;
        return;
      }
      const update = parseVemUpdateBlock(input);
      const sandboxRunId = process.env.VEM_TASK_RUN_ID;
      const sandboxApiKey = process.env.VEM_API_KEY;
      const sandboxApiUrl = "https://api.vem.dev";
      if (sandboxRunId && sandboxApiKey) {
        const res = await fetch(
          `${sandboxApiUrl}/task-runs/${sandboxRunId}/vem-update-structured`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${sandboxApiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ update })
          }
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error(
            chalk17.red("[vem finalize] API submission failed:"),
            res.status,
            errText
          );
          process.exitCode = 1;
        } else {
          console.log(chalk17.green("\n\u2714 vem update submitted to API\n"));
        }
        return;
      }
      const result = await applyVemUpdate(update);
      console.log(chalk17.green("\n\u2714 vem update applied\n"));
      if (result.updatedTasks.length > 0) {
        console.log(
          chalk17.gray(
            `Updated tasks: ${result.updatedTasks.map((task) => task.id).join(", ")}`
          )
        );
      }
      if (result.newTasks.length > 0) {
        console.log(
          chalk17.gray(
            `New tasks: ${result.newTasks.map((task) => task.id).join(", ")}`
          )
        );
      }
      if (result.changelogLines.length > 0) {
        console.log(
          chalk17.gray(`Changelog entries: ${result.changelogLines.length}`)
        );
      }
      if (result.newCycles.length > 0) {
        console.log(
          chalk17.gray(
            `New cycles: ${result.newCycles.map((c) => c.name).join(", ")}`
          )
        );
      }
      if (result.decisionsAppended) {
        console.log(chalk17.gray("Decisions updated."));
      }
      if (result.currentStateUpdated) {
        console.log(chalk17.gray("Current state updated."));
      } else {
        console.log(
          chalk17.yellow(
            "No current_state provided; CURRENT_STATE.md was left unchanged."
          )
        );
      }
      if (result.contextUpdated) {
        console.log(chalk17.gray("Context updated."));
      }
      const configService = new ConfigService();
      await syncParsedTaskUpdatesToRemote(
        configService,
        update,
        result
      ).catch((err) => {
        console.error(
          chalk17.yellow("[vem finalize] syncParsed failed:"),
          err instanceof Error ? err.message : String(err)
        );
      });
      const synced = await syncProjectMemoryToRemote().catch(() => false);
      if (synced) {
        console.log(chalk17.gray("\u2714 Synced to cloud."));
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk17.red("\n\u2716 Finalize Failed:"), error.message);
      } else {
        console.error(chalk17.red("\n\u2716 Finalize Failed:"), String(error));
      }
      process.exitCode = 1;
    }
  });
  program2.command("queue").description("Manage offline snapshot queue").option("--list", "List queued snapshots", true).option("--retry", "Retry pushing all queued snapshots").option("--clear", "Clear the queue").action(async (options) => {
    try {
      const configService = new ConfigService();
      if (options.clear) {
        const queue2 = await syncService.getQueue();
        for (const item of queue2) {
          await syncService.removeFromQueue(item.id);
        }
        console.log(chalk17.green("\n\u2714 Queue cleared\n"));
        return;
      }
      if (options.retry) {
        const key = await ensureAuthenticated(configService);
        await processQueue(syncService, configService, key);
        return;
      }
      const queue = await syncService.getQueue();
      if (queue.length === 0) {
        console.log(chalk17.gray("\nOffline queue is empty.\n"));
        return;
      }
      console.log(chalk17.bold(`
\u{1F4E6} Offline Queue (${queue.length} items)
`));
      const table = new Table3({
        head: ["ID", "Time", "Repo", "Version"],
        style: { head: ["cyan"] }
      });
      queue.forEach((item) => {
        const date = new Date(parseInt(item.id.split("-")[0], 10));
        table.push([
          chalk17.gray(item.id),
          date.toLocaleString(),
          item.payload.repo_url || "unknown",
          item.payload.base_version || "none"
        ]);
      });
      console.log(table.toString());
      console.log(
        chalk17.gray("\nUse `vem queue --retry` to push these snapshots.\n")
      );
    } catch (error) {
      console.error(chalk17.red("Queue Error:"), error.message);
    }
  });
  program2.command("archive").description("Archive old memory files to keep context small").option("--all", "Archive decisions, changelogs, and tasks").option("--decisions", "Archive decisions only").option("--changelog", "Archive changelog only").option("--tasks", "Archive completed tasks only").option(
    "--older-than <days>",
    "Archive items older than this many days (default: 30)",
    (val) => parseInt(val, 10)
  ).option(
    "--keep <count>",
    "Keep at least this many recent items (default: 20)",
    (val) => parseInt(val, 10)
  ).action(async (options) => {
    await trackCommandUsage("archive");
    try {
      await ensureVemFiles();
      const keepCount = options.keep ?? 20;
      const olderThanDays = options.olderThan ?? 30;
      const all = options.all || !options.decisions && !options.changelog && !options.tasks;
      console.log(chalk17.bold("\n\u{1F5C4}\uFE0F  Archiving Memory...\n"));
      console.log(
        chalk17.gray(
          `Criteria: Keep ${keepCount} items OR younger than ${olderThanDays} days.`
        )
      );
      if (all || options.decisions) {
        const decisionsLog = new ScalableLogService(DECISIONS_DIR);
        const count = await decisionsLog.archiveEntries({
          keepCount,
          olderThanDays
        });
        if (count > 0) {
          console.log(chalk17.green(`\u2714 Archived ${count} decision(s)`));
        } else {
          console.log(chalk17.gray("Decisions: Nothing to archive"));
        }
      }
      if (all || options.changelog) {
        const changelogLog = new ScalableLogService(CHANGELOG_DIR);
        const count = await changelogLog.archiveEntries({
          keepCount,
          olderThanDays
        });
        if (count > 0) {
          console.log(chalk17.green(`\u2714 Archived ${count} changelog entry(s)`));
        } else {
          console.log(chalk17.gray("Changelog: Nothing to archive"));
        }
      }
      if (all || options.tasks) {
        const count = await taskService.archiveTasks({
          status: "done",
          olderThanDays
        });
        if (count > 0) {
          console.log(chalk17.green(`\u2714 Archived ${count} completed task(s)`));
        } else {
          console.log(chalk17.gray("Tasks: Nothing to archive"));
        }
      }
      console.log("");
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk17.red("\n\u2716 Archive Failed:"), error.message);
      } else {
        console.error(chalk17.red("\n\u2716 Archive Failed:"), String(error));
      }
      process.exit(1);
    }
  });
}

// src/commands/task.ts
import chalk18 from "chalk";
import Table4 from "cli-table3";
import prompts9 from "prompts";
function registerTaskCommands(program2) {
  const taskCmd = program2.command("task").description("Manage tasks");
  const formatTaskStatusLabel = (status, deletedAt) => {
    if (deletedAt) return chalk18.red("DELETED");
    switch (status) {
      case "ready":
        return chalk18.cyan("READY");
      case "in-review":
        return chalk18.magenta("IN REVW");
      case "in-progress":
        return chalk18.blue("IN PROG");
      case "blocked":
        return chalk18.yellow("BLOCKED");
      case "done":
        return chalk18.green("DONE");
      default:
        return chalk18.gray("TODO");
    }
  };
  const formatTaskPriority = (priority) => priority === "high" || priority === "critical" ? chalk18.red(priority) : chalk18.white(priority || "");
  const ADD_TASK_BACK_VALUE = "__vem_back__";
  const ADD_TASK_PRIORITIES = ["low", "medium", "high", "critical"];
  const TASK_STATUS_VALUES = /* @__PURE__ */ new Set([
    "todo",
    "ready",
    "in-review",
    "in-progress",
    "blocked",
    "done"
  ]);
  const asTrimmedString2 = (value) => {
    if (typeof value !== "string") return void 0;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : void 0;
  };
  const asStringArray = (value) => {
    if (!Array.isArray(value)) return void 0;
    const items = value.map((entry) => asTrimmedString2(entry)).filter((entry) => Boolean(entry));
    return items.length > 0 ? items : [];
  };
  const asFiniteNumber = (value) => {
    if (typeof value !== "number") return void 0;
    return Number.isFinite(value) ? value : void 0;
  };
  const asIsoLikeString = (value) => {
    const raw = asTrimmedString2(value);
    if (!raw) return void 0;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? void 0 : parsed.toISOString();
  };
  const asTaskStatus = (value) => {
    if (typeof value !== "string") return void 0;
    return TASK_STATUS_VALUES.has(value) ? value : void 0;
  };
  const asTaskActions = (value) => {
    if (!Array.isArray(value)) return void 0;
    const actions = value.map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry;
      const type = asTrimmedString2(record.type);
      const createdAt = asIsoLikeString(record.created_at);
      if (!type || !createdAt) return null;
      const reasoning = record.reasoning === null ? null : asTrimmedString2(record.reasoning);
      const actor = record.actor === null ? null : asTrimmedString2(record.actor);
      return {
        type,
        reasoning,
        actor,
        created_at: createdAt
      };
    }).filter(Boolean);
    return actions.length > 0 ? actions : [];
  };
  const normalizeRemoteTask = (input) => {
    if (!input || typeof input !== "object") return null;
    const record = input;
    const id = asTrimmedString2(record.id);
    const title = asTrimmedString2(record.title);
    const status = asTaskStatus(record.status);
    if (!id || !title || !status) return null;
    return {
      id,
      db_id: asTrimmedString2(record.db_id),
      title,
      status,
      assignee: asTrimmedString2(record.assignee),
      priority: asTrimmedString2(record.priority),
      tags: asStringArray(record.tags),
      type: asTrimmedString2(record.type),
      estimate_hours: asFiniteNumber(record.estimate_hours),
      depends_on: asStringArray(record.depends_on),
      blocked_by: asStringArray(record.blocked_by),
      recurrence_rule: asTrimmedString2(record.recurrence_rule),
      owner_id: asTrimmedString2(record.owner_id),
      reviewer_id: asTrimmedString2(record.reviewer_id),
      parent_id: asTrimmedString2(record.parent_id),
      subtask_order: asFiniteNumber(record.subtask_order),
      description: asTrimmedString2(record.description),
      task_context: asTrimmedString2(record.task_context),
      task_context_summary: asTrimmedString2(record.task_context_summary),
      related_decisions: asStringArray(record.related_decisions),
      evidence: asStringArray(record.evidence),
      actions: asTaskActions(record.actions),
      created_at: asIsoLikeString(record.created_at),
      updated_at: asIsoLikeString(record.updated_at),
      due_at: asIsoLikeString(record.due_at),
      github_issue_number: asFiniteNumber(record.github_issue_number),
      deleted_at: asIsoLikeString(record.deleted_at),
      validation_steps: asStringArray(record.validation_steps)
    };
  };
  const getRemoteTasks = async (options) => {
    try {
      const configService = new ConfigService();
      const [apiKey, projectId] = await Promise.all([
        tryAuthenticatedKey(configService),
        configService.getProjectId()
      ]);
      if (!apiKey || !projectId) return null;
      const query = new URLSearchParams();
      if (options?.id) query.set("id", options.id);
      if (options?.includeActions) query.set("include_actions", "true");
      if (options?.includeDeleted) query.set("include_deleted", "true");
      const suffix = query.toString();
      const response = await fetch(
        `${API_URL}/projects/${projectId}/tasks${suffix ? `?${suffix}` : ""}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...await buildDeviceHeaders(configService)
          }
        }
      );
      if (!response.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body.tasks)) return null;
      return body.tasks.map((task) => normalizeRemoteTask(task)).filter((task) => Boolean(task));
    } catch {
      return null;
    }
  };
  const getDisplayTasks = async (options) => {
    const remoteTasks = await getRemoteTasks(options);
    if (remoteTasks) return remoteTasks;
    const localTasks = options?.id ? [await taskService.getTask(options.id)].filter(
      (task) => Boolean(task)
    ) : await taskService.getTasks();
    return localTasks;
  };
  const resolveRemoteProjectAuth = async () => {
    const configService = new ConfigService();
    const [apiKey, projectId] = await Promise.all([
      tryAuthenticatedKey(configService),
      configService.getProjectId()
    ]);
    if (!apiKey || !projectId) return null;
    return { configService, apiKey, projectId };
  };
  const getRemoteTaskContext = async (taskId) => {
    try {
      const auth = await resolveRemoteProjectAuth();
      if (!auth) return null;
      const response = await fetch(
        `${API_URL}/projects/${auth.projectId}/tasks/${encodeURIComponent(taskId)}/context`,
        {
          headers: {
            Authorization: `Bearer ${auth.apiKey}`,
            ...await buildDeviceHeaders(auth.configService)
          }
        }
      );
      if (!response.ok) return null;
      const body = await response.json();
      return {
        task_context: typeof body.task_context === "string" ? body.task_context : void 0,
        task_context_summary: typeof body.task_context_summary === "string" ? body.task_context_summary : void 0
      };
    } catch {
      return null;
    }
  };
  const updateRemoteTaskContext = async (taskId, payload) => {
    try {
      const auth = await resolveRemoteProjectAuth();
      if (!auth) return false;
      const response = await fetch(
        `${API_URL}/projects/${auth.projectId}/tasks/${encodeURIComponent(taskId)}/context`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${auth.apiKey}`,
            "Content-Type": "application/json",
            ...await buildDeviceHeaders(auth.configService)
          },
          body: JSON.stringify(payload)
        }
      );
      if (!response.ok) return false;
      return true;
    } catch {
      return false;
    }
  };
  const getRemoteTaskById = async (taskId) => {
    const remoteTasks = await getRemoteTasks({
      id: taskId,
      includeDeleted: true
    });
    if (!remoteTasks || remoteTasks.length === 0) {
      return null;
    }
    return remoteTasks.find((task) => task.id === taskId) ?? remoteTasks[0] ?? null;
  };
  const updateRemoteTaskMeta = async (taskId, patch) => {
    try {
      const auth = await resolveRemoteProjectAuth();
      if (!auth) return false;
      const remoteTask = await getRemoteTaskById(taskId);
      if (!remoteTask?.db_id) return false;
      const payload = {
        title: remoteTask.title,
        description: remoteTask.description ?? null,
        status: remoteTask.status,
        priority: remoteTask.priority ?? "medium",
        tags: remoteTask.tags ?? [],
        type: remoteTask.type ?? null,
        estimate_hours: remoteTask.estimate_hours ?? null,
        depends_on: remoteTask.depends_on ?? [],
        blocked_by: remoteTask.blocked_by ?? [],
        recurrence_rule: remoteTask.recurrence_rule ?? null,
        owner_id: remoteTask.owner_id ?? null,
        reviewer_id: remoteTask.reviewer_id ?? null,
        parent_id: remoteTask.parent_id ?? null,
        subtask_order: remoteTask.subtask_order ?? null,
        due_at: remoteTask.due_at ?? null,
        validation_steps: remoteTask.validation_steps ?? [],
        evidence: remoteTask.evidence ?? [],
        deleted_at: remoteTask.deleted_at ?? null
      };
      if (patch.status !== void 0) payload.status = patch.status;
      if (patch.evidence !== void 0) payload.evidence = patch.evidence;
      if (patch.tags !== void 0) payload.tags = patch.tags;
      if (patch.type !== void 0) payload.type = patch.type;
      if (patch.estimate_hours !== void 0) {
        payload.estimate_hours = patch.estimate_hours;
      }
      if (patch.depends_on !== void 0) payload.depends_on = patch.depends_on;
      if (patch.blocked_by !== void 0) payload.blocked_by = patch.blocked_by;
      if (patch.recurrence_rule !== void 0) {
        payload.recurrence_rule = patch.recurrence_rule;
      }
      if (patch.owner_id !== void 0) payload.owner_id = patch.owner_id;
      if (patch.reviewer_id !== void 0)
        payload.reviewer_id = patch.reviewer_id;
      if (patch.parent_id !== void 0) payload.parent_id = patch.parent_id;
      if (patch.subtask_order !== void 0) {
        payload.subtask_order = patch.subtask_order;
      }
      if (patch.due_at !== void 0) payload.due_at = patch.due_at;
      if (patch.validation_steps !== void 0) {
        payload.validation_steps = patch.validation_steps;
      }
      if (patch.deleted_at !== void 0) payload.deleted_at = patch.deleted_at;
      if (patch.sessions !== void 0) payload.sessions = patch.sessions;
      if (patch.reasoning !== void 0) payload.reasoning = patch.reasoning;
      if (patch.actor !== void 0) payload.actor = patch.actor;
      const response = await fetch(
        `${API_URL}/tasks/${encodeURIComponent(remoteTask.db_id)}/meta`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.apiKey}`,
            "Content-Type": "application/json",
            ...await buildDeviceHeaders(auth.configService)
          },
          body: JSON.stringify(payload)
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  };
  const createRemoteTask = async (payload) => {
    try {
      const auth = await resolveRemoteProjectAuth();
      if (!auth) return null;
      const createBody = {
        title: payload.title,
        priority: payload.priority
      };
      if (payload.description !== void 0) {
        createBody.description = payload.description;
      }
      if (payload.type !== void 0) createBody.type = payload.type;
      if (payload.estimate_hours !== void 0) {
        createBody.estimate_hours = payload.estimate_hours;
      }
      if (payload.parent_id !== void 0)
        createBody.parent_id = payload.parent_id;
      if (payload.subtask_order !== void 0) {
        createBody.subtask_order = payload.subtask_order;
      }
      const response = await fetch(
        `${API_URL}/projects/${auth.projectId}/tasks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.apiKey}`,
            "Content-Type": "application/json",
            ...await buildDeviceHeaders(auth.configService)
          },
          body: JSON.stringify(createBody)
        }
      );
      if (!response.ok) return null;
      const body = await response.json();
      const externalId = asTrimmedString2(body.task?.external_id);
      if (!externalId) return null;
      const hasExtendedMetadata = payload.tags !== void 0 || payload.depends_on !== void 0 || payload.blocked_by !== void 0 || payload.recurrence_rule !== void 0 || payload.owner_id !== void 0 || payload.reviewer_id !== void 0 || payload.due_at !== void 0 || payload.validation_steps !== void 0;
      if (hasExtendedMetadata) {
        await updateRemoteTaskMeta(externalId, {
          tags: payload.tags,
          type: payload.type,
          estimate_hours: payload.estimate_hours,
          depends_on: payload.depends_on,
          blocked_by: payload.blocked_by,
          recurrence_rule: payload.recurrence_rule,
          owner_id: payload.owner_id,
          reviewer_id: payload.reviewer_id,
          parent_id: payload.parent_id,
          subtask_order: payload.subtask_order,
          due_at: payload.due_at,
          validation_steps: payload.validation_steps
        });
      }
      return await getRemoteTaskById(externalId) ?? {
        id: externalId,
        title: payload.title,
        status: "todo",
        priority: payload.priority
      };
    } catch {
      return null;
    }
  };
  const isBackInput = (value) => {
    const normalized = value.trim().toLowerCase();
    return normalized === ":back" || normalized === "<" || normalized === "back";
  };
  const normalizePriority = (value) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return "medium";
    if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") {
      return normalized;
    }
    throw new Error(
      `Invalid priority "${value}". Use: ${ADD_TASK_PRIORITIES.join(", ")}.`
    );
  };
  const parseDueAtIso = (value) => {
    if (!value || value.trim().length === 0) return void 0;
    const rawValue = value.trim();
    const parsed = new Date(
      rawValue.length === 10 ? `${rawValue}T00:00:00.000Z` : rawValue
    );
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        "due-at must be a valid ISO date or YYYY-MM-DD (e.g. 2026-02-12)."
      );
    }
    return parsed.toISOString();
  };
  const parseOptionalFloat = (value, fieldName) => {
    if (!value || value.trim().length === 0) return void 0;
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`${fieldName} must be a number`);
    }
    return parsed;
  };
  const parseOptionalInt = (value, fieldName) => {
    if (!value || value.trim().length === 0) return void 0;
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`${fieldName} must be an integer`);
    }
    return Number.parseInt(value, 10);
  };
  const TASK_CONTEXT_SUMMARY_MAX_CHARS = 1200;
  const summarizeTaskContext = (value) => {
    const normalized = value.trim();
    if (normalized.length <= TASK_CONTEXT_SUMMARY_MAX_CHARS) return normalized;
    return `${normalized.slice(0, TASK_CONTEXT_SUMMARY_MAX_CHARS - 15).trimEnd()}
...[truncated]`;
  };
  const promptTextWithBack = async ({
    message,
    initial,
    optional = false,
    allowBack = false,
    validate
  }) => {
    let cancelled = false;
    const response = await prompts9(
      {
        type: "text",
        name: "value",
        message,
        initial,
        validate: (input) => {
          if (allowBack && isBackInput(input)) return true;
          const trimmed = input.trim();
          if (!optional && trimmed.length === 0) {
            return "This field is required.";
          }
          return validate ? validate(trimmed) : true;
        }
      },
      {
        onCancel: () => {
          cancelled = true;
          return false;
        }
      }
    );
    if (cancelled) {
      return { kind: "cancel" };
    }
    const rawValue = typeof response.value === "string" ? response.value : String(response.value || "");
    if (allowBack && isBackInput(rawValue)) {
      return { kind: "back" };
    }
    const value = rawValue.trim();
    if (optional && value.length === 0) {
      return { kind: "next", value: void 0 };
    }
    return { kind: "next", value };
  };
  const promptSelectWithBack = async ({
    message,
    choices,
    initial,
    allowBack = false
  }) => {
    let cancelled = false;
    const response = await prompts9(
      {
        type: "select",
        name: "value",
        message,
        initial: initial !== void 0 ? Math.max(
          choices.findIndex((choice) => choice.value === initial),
          0
        ) : 0,
        choices: allowBack ? [...choices, { title: "\u2190 Back", value: ADD_TASK_BACK_VALUE }] : choices
      },
      {
        onCancel: () => {
          cancelled = true;
          return false;
        }
      }
    );
    if (cancelled || response.value === void 0) {
      return { kind: "cancel" };
    }
    if (allowBack && response.value === ADD_TASK_BACK_VALUE) {
      return { kind: "back" };
    }
    return { kind: "next", value: response.value };
  };
  taskCmd.command("list").description("List tasks").option("--all", "Include completed tasks").option("--deleted", "Show only deleted tasks").option(
    "--status <status>",
    "Filter by status (todo, ready, in-review, in-progress, blocked, done)"
  ).option("--done", "Show only completed tasks").option("--cycle <id>", "Filter by cycle ID").option("--flow", "Show flow metrics column (cycle time)").action(async (options) => {
    await trackCommandUsage("task list");
    const tasks = await getDisplayTasks({ includeDeleted: true });
    const status = typeof options.status === "string" ? options.status : void 0;
    const cycleFilter = typeof options.cycle === "string" ? options.cycle.trim() : void 0;
    const validStatuses = /* @__PURE__ */ new Set([
      "todo",
      "ready",
      "in-review",
      "in-progress",
      "blocked",
      "done"
    ]);
    if (status && !validStatuses.has(status)) {
      console.error(
        chalk18.red(
          `Invalid status "${status}". Use: todo, ready, in-review, in-progress, blocked, done.`
        )
      );
      process.exitCode = 1;
      return;
    }
    let filtered = status ? tasks.filter((t) => t.status === status && !t.deleted_at) : options.deleted ? tasks.filter((t) => t.deleted_at) : options.done ? tasks.filter((t) => t.status === "done" && !t.deleted_at) : options.all ? tasks : tasks.filter((t) => t.status !== "done" && !t.deleted_at);
    if (cycleFilter) {
      filtered = filtered.filter((t) => t.cycle_id === cycleFilter);
    }
    const showFlow = !!options.flow;
    const headCols = showFlow ? ["ID", "Status", "Title", "Cycle", "Score", "Assignee", "Priority"] : ["ID", "Status", "Title", "Assignee", "Priority"];
    const table = new Table4({
      head: headCols,
      style: { head: ["cyan"] }
    });
    const fmtMs = (ms) => {
      if (!ms) return chalk18.gray("-");
      const days = Math.floor(ms / 864e5);
      const hrs = Math.floor(ms % 864e5 / 36e5);
      return days > 0 ? chalk18.white(`${days}d ${hrs}h`) : chalk18.white(`${hrs}h`);
    };
    filtered.forEach((t) => {
      if (showFlow) {
        const cycleTime = t.started_at && t.status === "done" ? Date.now() - new Date(t.started_at).getTime() : void 0;
        table.push([
          chalk18.white(t.id),
          formatTaskStatusLabel(t.status, t.deleted_at),
          t.title,
          t.cycle_id ? chalk18.cyan(t.cycle_id) : chalk18.gray("-"),
          t.impact_score !== void 0 ? chalk18.yellow(String(Math.round(t.impact_score))) : chalk18.gray("-"),
          chalk18.gray(t.assignee || "-"),
          formatTaskPriority(t.priority)
        ]);
      } else {
        table.push([
          chalk18.white(t.id),
          formatTaskStatusLabel(t.status, t.deleted_at),
          t.title,
          chalk18.gray(t.assignee || "-"),
          formatTaskPriority(t.priority)
        ]);
      }
    });
    console.log(table.toString());
  });
  taskCmd.command("subtasks").description("Show parent task and its subtasks").requiredOption("--parent <id>", "Parent task ID").action(async (options) => {
    const parentId = options.parent;
    const parent = await taskService.getTask(parentId);
    if (!parent) {
      console.error(chalk18.red(`
\u2716 Task ${parentId} not found.
`));
      process.exitCode = 1;
      return;
    }
    const tasks = await taskService.getTasks();
    const subtasks = tasks.filter((t) => t.parent_id === parentId).sort((a, b) => {
      const orderA = typeof a.subtask_order === "number" ? a.subtask_order : 9999;
      const orderB = typeof b.subtask_order === "number" ? b.subtask_order : 9999;
      if (orderA !== orderB) return orderA - orderB;
      return a.id.localeCompare(b.id);
    });
    const parentTable = new Table4({
      head: ["ID", "Status", "Title", "Assignee", "Priority"],
      style: { head: ["cyan"] }
    });
    parentTable.push([
      chalk18.white(parent.id),
      formatTaskStatusLabel(parent.status),
      parent.title,
      chalk18.gray(parent.assignee || "-"),
      formatTaskPriority(parent.priority)
    ]);
    console.log(chalk18.bold("\nParent Task"));
    console.log(parentTable.toString());
    if (subtasks.length === 0) {
      console.log(chalk18.gray("\nNo subtasks found."));
      return;
    }
    const subtaskTable = new Table4({
      head: ["ID", "Status", "Title", "Assignee", "Priority", "Order"],
      style: { head: ["cyan"] }
    });
    subtasks.forEach((t) => {
      subtaskTable.push([
        chalk18.white(t.id),
        formatTaskStatusLabel(t.status),
        t.title,
        chalk18.gray(t.assignee || "-"),
        formatTaskPriority(t.priority),
        typeof t.subtask_order === "number" ? `#${t.subtask_order}` : "-"
      ]);
    });
    console.log(chalk18.bold("\nSubtasks"));
    console.log(subtaskTable.toString());
  });
  taskCmd.command("details").description("Show task details").requiredOption("--id <id>", "Task ID").action(async (options) => {
    try {
      const [remoteTask] = await getDisplayTasks({
        id: options.id,
        includeActions: true,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(options.id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`
\u2716 Task ${options.id} not found.
`));
        process.exitCode = 1;
        return;
      }
      console.log(chalk18.bold(`
\u{1F4CB} Task Details: ${task.id}
`));
      console.log(`${chalk18.cyan("Title:")}       ${task.title}`);
      console.log(
        `${chalk18.cyan("Status:")}      ${task.status.toUpperCase()}`
      );
      console.log(
        `${chalk18.cyan("Priority:")}    ${(task.priority || "medium").toUpperCase()}`
      );
      if (task.assignee) {
        console.log(`${chalk18.cyan("Assignee:")}    ${task.assignee}`);
      }
      if (task.github_issue_number) {
        console.log(
          `${chalk18.cyan("GitHub Issue:")} #${task.github_issue_number}`
        );
      }
      if (task.tags && task.tags.length > 0) {
        console.log(`${chalk18.cyan("Tags:")}        ${task.tags.join(", ")}`);
      }
      if (task.type) {
        console.log(`${chalk18.cyan("Type:")}        ${task.type}`);
      }
      if (typeof task.estimate_hours === "number") {
        console.log(`${chalk18.cyan("Estimate:")}    ${task.estimate_hours}h`);
      }
      if (task.depends_on && task.depends_on.length > 0) {
        console.log(
          `${chalk18.cyan("Depends On:")} ${task.depends_on.join(", ")}`
        );
      }
      if (task.blocked_by && task.blocked_by.length > 0) {
        console.log(
          `${chalk18.cyan("Blocked By:")} ${task.blocked_by.join(", ")}`
        );
      }
      if (task.recurrence_rule) {
        console.log(`${chalk18.cyan("Recurrence:")}  ${task.recurrence_rule}`);
      }
      if (task.owner_id) {
        console.log(`${chalk18.cyan("Owner:")}       ${task.owner_id}`);
      }
      if (task.reviewer_id) {
        console.log(`${chalk18.cyan("Reviewer:")}    ${task.reviewer_id}`);
      }
      if (task.deleted_at) {
        console.log(`${chalk18.cyan("Deleted At:")}  ${task.deleted_at}`);
      }
      if (task.parent_id) {
        console.log(`${chalk18.cyan("Parent Task:")} ${task.parent_id}`);
      }
      if (typeof task.subtask_order === "number") {
        console.log(`${chalk18.cyan("Subtask Order:")} #${task.subtask_order}`);
      }
      if (task.due_at) {
        console.log(`${chalk18.cyan("Due At:")}      ${task.due_at}`);
      }
      const createdAt = task.created_at ?? localTask?.created_at ?? "N/A";
      const updatedAt = task.updated_at ?? localTask?.updated_at ?? "N/A";
      console.log(`${chalk18.cyan("Created At:")}  ${createdAt}`);
      console.log(`${chalk18.cyan("Updated At:")}  ${updatedAt}`);
      if (task.description) {
        console.log(`
${chalk18.cyan("Description:")}
${task.description}`);
      }
      const remoteContext = await getRemoteTaskContext(task.id);
      const effectiveTaskContext = remoteContext?.task_context ?? task.task_context ?? "";
      const effectiveTaskContextSummary = remoteContext?.task_context_summary ?? task.task_context_summary ?? "";
      const relatedDecisionSource = task.related_decisions && task.related_decisions.length > 0 ? task.related_decisions : localTask?.related_decisions ?? [];
      const relatedDecisions = relatedDecisionSource.map((entry) => entry.trim()).filter(Boolean);
      console.log(`
${chalk18.cyan("Context:")}`);
      if (effectiveTaskContextSummary) {
        console.log(chalk18.gray("  Summary:"));
        console.log(`  ${effectiveTaskContextSummary}`);
      }
      if (effectiveTaskContext) {
        console.log(chalk18.gray("  Full context:"));
        console.log(`  ${effectiveTaskContext}`);
      }
      if (!effectiveTaskContextSummary && !effectiveTaskContext) {
        console.log(chalk18.gray("  No context recorded."));
      }
      console.log(`
${chalk18.cyan("Decisions:")}`);
      if (relatedDecisions.length === 0) {
        console.log(chalk18.gray("  No related decisions."));
      } else {
        for (const decision of relatedDecisions) {
          console.log(`  - ${decision}`);
        }
      }
      if (task.evidence && task.evidence.length > 0) {
        console.log(`
${chalk18.cyan("Evidence:")}`);
        task.evidence.forEach((e) => {
          console.log(`  - ${e}`);
        });
      }
      if (task.actions && task.actions.length > 0) {
        console.log(`
${chalk18.cyan("Actions:")}`);
        task.actions.forEach((a) => {
          const type = a.type.replace(/_/g, " ").toUpperCase();
          console.log(
            `  ${chalk18.gray(`[${a.created_at}]`)} ${chalk18.bold(type)}${a.reasoning ? `: ${a.reasoning}` : ""}`
          );
        });
      }
      console.log("");
    } catch (error) {
      console.error(
        chalk18.red(`
\u2716 Failed to get task details: ${error.message}
`)
      );
      process.exitCode = 1;
    }
  });
  taskCmd.command("context <id>").description("View or update task context").option("--set <text>", "Replace task context").option("--append <text>", "Append to task context").option("--clear", "Clear task context").action(async (id, options) => {
    try {
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      const remoteContext = await getRemoteTaskContext(id);
      const hasUpdate = options.set !== void 0 || options.append !== void 0 || options.clear;
      if (!hasUpdate) {
        const currentContext = remoteContext?.task_context ?? task.task_context ?? "";
        if (currentContext.trim().length > 0) {
          console.log(`
${chalk18.cyan("Task Context:")}
${currentContext}`);
        } else {
          console.log(chalk18.yellow("\nNo task context found.\n"));
        }
        const currentSummary = remoteContext?.task_context_summary ?? task.task_context_summary ?? "";
        if (currentSummary.trim().length > 0) {
          console.log(
            `
${chalk18.cyan("Task Context Summary:")}
${currentSummary}
`
          );
        }
        return;
      }
      let nextContext = remoteContext?.task_context ?? (task.task_context || "");
      if (options.clear) {
        nextContext = "";
      } else if (options.set !== void 0) {
        nextContext = options.set;
      } else if (options.append !== void 0) {
        nextContext = [nextContext, options.append].filter(Boolean).join("\n");
      }
      const remoteUpdated = await updateRemoteTaskContext(id, {
        task_context: nextContext || null
      });
      if (localTask) {
        await taskService.updateTask(id, { task_context: nextContext });
      }
      console.log(
        chalk18.green(
          `
\u2714 Updated context for ${id}${remoteUpdated ? " (cloud + local cache)" : " (local cache)"}
`
        )
      );
    } catch (error) {
      console.error(
        chalk18.red(`Failed to update task context: ${error.message}`)
      );
    }
  });
  taskCmd.command("assign <id> [assignee]").description("Assign a task to a user").action(async (id, assignee) => {
    try {
      const configService = new ConfigService();
      const key = await tryAuthenticatedKey(configService);
      const projectId = await configService.getProjectId();
      if (!assignee && key && projectId) {
        console.log(chalk18.blue("Fetching assignable users..."));
        const res = await fetch(
          `${API_URL}/projects/${projectId}/collaborators`,
          {
            headers: {
              Authorization: `Bearer ${key}`,
              ...await buildDeviceHeaders(configService)
            }
          }
        );
        if (res.ok) {
          const { github, members } = await res.json();
          const choices = [
            ...members.map((m) => ({ title: m.user_id, value: m.user_id })),
            ...github.map((g) => ({
              title: `${g.login} (GitHub)`,
              value: g.login
            }))
          ];
          if (choices.length > 0) {
            const response = await prompts9({
              type: "select",
              name: "assignee",
              message: "Select assignee:",
              choices
            });
            assignee = response.assignee;
          }
        }
      }
      if (!assignee) {
        const response = await prompts9({
          type: "text",
          name: "assignee",
          message: "Enter assignee (User ID or GitHub username):"
        });
        assignee = response.assignee;
      }
      if (!assignee) {
        console.log(chalk18.yellow("No assignee provided."));
        return;
      }
      await taskService.updateTask(id, { assignee });
      console.log(chalk18.green(`
\u2714 Task ${id} assigned to ${assignee}
`));
      if (key && projectId) {
        console.log(
          chalk18.gray("Tip: Run `vem push` to sync assignment to cloud.")
        );
      }
    } catch (error) {
      console.error(chalk18.red(`Failed to assign task: ${error.message}`));
    }
  });
  taskCmd.command("add [title]").description("Create a new task (interactive when title is omitted)").option(
    "-p, --priority <priority>",
    "Priority (low, medium, high, critical)"
  ).option("-d, --description <description>", "Task description").option("--tags <tags>", "Comma-separated tags").option("--type <type>", "Task type (feature, bug, chore, spike, enabler)").option("--estimate-hours <hours>", "Estimated hours (e.g. 2.5)").option("--depends-on <ids>", "Comma-separated task IDs").option("--blocked-by <ids>", "Comma-separated task IDs").option("--recurrence <rule>", "Recurrence rule (weekly, monthly, cron)").option("--owner <id>", "Owner ID").option("--reviewer <id>", "Reviewer ID").option("--parent <id>", "Parent task ID").option("--order <number>", "Subtask order").option("--due-at <iso>", "Due date ISO string (YYYY-MM-DD)").option(
    "--validation <steps>",
    'Comma-separated validation steps (e.g. "pnpm build, pnpm test")'
  ).option("--cycle <id>", "Assign to a cycle (e.g. CYCLE-001)").option(
    "--impact-score <score>",
    "Impact score 0-100 (RICE-based priority)"
  ).option("--actor <name>", "Actor name for task creation").option("-r, --reasoning <reasoning>", "Reasoning for creation").action(async (title, options) => {
    await trackCommandUsage("task add");
    try {
      let taskTitle = typeof title === "string" && title.trim().length > 0 ? title.trim() : void 0;
      let priorityInput = typeof options.priority === "string" ? options.priority : void 0;
      let descriptionInput = typeof options.description === "string" ? options.description : void 0;
      let tagsInput = typeof options.tags === "string" ? options.tags : void 0;
      let typeInput = typeof options.type === "string" ? options.type : void 0;
      let estimateHoursInput = typeof options.estimateHours === "string" ? options.estimateHours : void 0;
      let dependsOnInput = typeof options.dependsOn === "string" ? options.dependsOn : void 0;
      let blockedByInput = typeof options.blockedBy === "string" ? options.blockedBy : void 0;
      let recurrenceInput = typeof options.recurrence === "string" ? options.recurrence : void 0;
      let ownerInput = typeof options.owner === "string" ? options.owner : void 0;
      let reviewerInput = typeof options.reviewer === "string" ? options.reviewer : void 0;
      let parentInput = typeof options.parent === "string" ? options.parent : void 0;
      let orderInput = typeof options.order === "string" ? options.order : void 0;
      let dueAtInput = typeof options.dueAt === "string" ? options.dueAt : void 0;
      let validationInput = typeof options.validation === "string" ? options.validation : void 0;
      let actorInput = typeof options.actor === "string" ? options.actor : void 0;
      let reasoningInput = typeof options.reasoning === "string" ? options.reasoning : void 0;
      const cycleIdInput = typeof options.cycle === "string" ? options.cycle.trim() : void 0;
      const impactScoreInput = typeof options.impactScore === "string" ? Number.parseFloat(options.impactScore) : void 0;
      const runWizard = !taskTitle;
      if (runWizard) {
        if (!process.stdin.isTTY) {
          throw new Error("Title is required in non-interactive mode.");
        }
        console.log(chalk18.cyan("\nTask creation wizard"));
        console.log(
          chalk18.gray(
            "Fill required fields first, then optional fields. Type :back to go back."
          )
        );
        let requiredStep = 0;
        let selectedPriority = normalizePriority(priorityInput);
        while (requiredStep < 2) {
          if (requiredStep === 0) {
            const prompt = await promptTextWithBack({
              message: "Task title:",
              initial: taskTitle,
              optional: false
            });
            if (prompt.kind === "cancel") {
              console.log(chalk18.yellow("Task creation cancelled."));
              return;
            }
            if (prompt.kind === "next") {
              taskTitle = prompt.value;
              requiredStep = 1;
            }
            continue;
          }
          const priorityPrompt = await promptSelectWithBack({
            message: "Priority:",
            choices: ADD_TASK_PRIORITIES.map((priority2) => ({
              title: priority2,
              value: priority2
            })),
            initial: selectedPriority,
            allowBack: true
          });
          if (priorityPrompt.kind === "cancel") {
            console.log(chalk18.yellow("Task creation cancelled."));
            return;
          }
          if (priorityPrompt.kind === "back") {
            requiredStep = 0;
            continue;
          }
          selectedPriority = priorityPrompt.value;
          priorityInput = selectedPriority;
          requiredStep = 2;
        }
        const optionalMode = await promptSelectWithBack(
          {
            message: "Configure optional fields now?",
            choices: [
              {
                title: "Yes, step through optional fields",
                value: "configure"
              },
              { title: "No, create task now", value: "skip" }
            ],
            initial: "configure",
            allowBack: true
          }
        );
        if (optionalMode.kind === "cancel") {
          console.log(chalk18.yellow("Task creation cancelled."));
          return;
        }
        if (optionalMode.kind === "back") {
          const priorityPrompt = await promptSelectWithBack({
            message: "Priority:",
            choices: ADD_TASK_PRIORITIES.map((priority2) => ({
              title: priority2,
              value: priority2
            })),
            initial: normalizePriority(priorityInput),
            allowBack: true
          });
          if (priorityPrompt.kind === "cancel") {
            console.log(chalk18.yellow("Task creation cancelled."));
            return;
          }
          if (priorityPrompt.kind === "back") {
            const titlePrompt = await promptTextWithBack({
              message: "Task title:",
              initial: taskTitle,
              optional: false
            });
            if (titlePrompt.kind !== "next") {
              console.log(chalk18.yellow("Task creation cancelled."));
              return;
            }
            taskTitle = titlePrompt.value;
            const retryPriorityPrompt = await promptSelectWithBack({
              message: "Priority:",
              choices: ADD_TASK_PRIORITIES.map((priority2) => ({
                title: priority2,
                value: priority2
              })),
              initial: normalizePriority(priorityInput),
              allowBack: false
            });
            if (retryPriorityPrompt.kind !== "next") {
              console.log(chalk18.yellow("Task creation cancelled."));
              return;
            }
            priorityInput = retryPriorityPrompt.value;
          } else {
            priorityInput = priorityPrompt.value;
          }
        }
        if (optionalMode.kind === "next" && optionalMode.value === "configure") {
          const optionalPrompts = [
            {
              message: "Description (optional):",
              getInitial: () => descriptionInput,
              setValue: (value) => {
                descriptionInput = value;
              }
            },
            {
              message: "Tags (comma-separated, optional):",
              getInitial: () => tagsInput,
              setValue: (value) => {
                tagsInput = value;
              }
            },
            {
              message: "Type (feature, bug, chore, spike, enabler; optional):",
              getInitial: () => typeInput,
              setValue: (value) => {
                typeInput = value;
              },
              validate: (value) => {
                if (!value) return true;
                const normalized = value.toLowerCase();
                if (normalized === "feature" || normalized === "bug" || normalized === "chore" || normalized === "spike" || normalized === "enabler") {
                  return true;
                }
                return "Type must be feature, bug, chore, spike, or enabler.";
              }
            },
            {
              message: "Estimate hours (optional):",
              getInitial: () => estimateHoursInput,
              setValue: (value) => {
                estimateHoursInput = value;
              },
              validate: (value) => !value || !Number.isNaN(Number.parseFloat(value)) ? true : "Estimate must be a number."
            },
            {
              message: "Depends on (comma-separated task IDs, optional):",
              getInitial: () => dependsOnInput,
              setValue: (value) => {
                dependsOnInput = value;
              }
            },
            {
              message: "Blocked by (comma-separated task IDs, optional):",
              getInitial: () => blockedByInput,
              setValue: (value) => {
                blockedByInput = value;
              }
            },
            {
              message: "Recurrence rule (weekly, monthly, cron; optional):",
              getInitial: () => recurrenceInput,
              setValue: (value) => {
                recurrenceInput = value;
              }
            },
            {
              message: "Owner ID (optional):",
              getInitial: () => ownerInput,
              setValue: (value) => {
                ownerInput = value;
              }
            },
            {
              message: "Reviewer ID (optional):",
              getInitial: () => reviewerInput,
              setValue: (value) => {
                reviewerInput = value;
              }
            },
            {
              message: "Parent task ID (optional):",
              getInitial: () => parentInput,
              setValue: (value) => {
                parentInput = value;
              }
            },
            {
              message: "Subtask order (integer, optional):",
              getInitial: () => orderInput,
              setValue: (value) => {
                orderInput = value;
              },
              validate: (value) => !value || /^-?\d+$/.test(value) ? true : "Order must be an integer."
            },
            {
              message: "Due date (YYYY-MM-DD or ISO, optional):",
              getInitial: () => dueAtInput,
              setValue: (value) => {
                dueAtInput = value;
              },
              validate: (value) => {
                if (!value) return true;
                try {
                  parseDueAtIso(value);
                  return true;
                } catch (error) {
                  return error.message;
                }
              }
            },
            {
              message: "Validation steps (comma-separated, optional; e.g. pnpm build, pnpm test):",
              getInitial: () => validationInput,
              setValue: (value) => {
                validationInput = value;
              }
            },
            {
              message: "Actor name (optional):",
              getInitial: () => actorInput,
              setValue: (value) => {
                actorInput = value;
              }
            },
            {
              message: "Reasoning for creation (optional):",
              getInitial: () => reasoningInput,
              setValue: (value) => {
                reasoningInput = value;
              }
            }
          ];
          let optionalIndex = 0;
          while (optionalIndex < optionalPrompts.length) {
            const field = optionalPrompts[optionalIndex];
            const prompt = await promptTextWithBack({
              message: field.message,
              initial: field.getInitial(),
              optional: true,
              allowBack: true,
              validate: field.validate
            });
            if (prompt.kind === "cancel") {
              console.log(chalk18.yellow("Task creation cancelled."));
              return;
            }
            if (prompt.kind === "back") {
              if (optionalIndex === 0) {
                const gatePrompt = await promptSelectWithBack({
                  message: "Configure optional fields now?",
                  choices: [
                    {
                      title: "Yes, step through optional fields",
                      value: "configure"
                    },
                    { title: "No, create task now", value: "skip" }
                  ],
                  initial: "configure",
                  allowBack: true
                });
                if (gatePrompt.kind === "cancel") {
                  console.log(chalk18.yellow("Task creation cancelled."));
                  return;
                }
                if (gatePrompt.kind === "next" && gatePrompt.value === "skip") {
                  break;
                }
                if (gatePrompt.kind === "back") {
                  const priorityPrompt = await promptSelectWithBack({
                    message: "Priority:",
                    choices: ADD_TASK_PRIORITIES.map((priority2) => ({
                      title: priority2,
                      value: priority2
                    })),
                    initial: normalizePriority(priorityInput),
                    allowBack: true
                  });
                  if (priorityPrompt.kind === "cancel") {
                    console.log(chalk18.yellow("Task creation cancelled."));
                    return;
                  }
                  if (priorityPrompt.kind === "back") {
                    const titlePrompt = await promptTextWithBack({
                      message: "Task title:",
                      initial: taskTitle,
                      optional: false
                    });
                    if (titlePrompt.kind !== "next") {
                      console.log(chalk18.yellow("Task creation cancelled."));
                      return;
                    }
                    taskTitle = titlePrompt.value;
                  } else {
                    priorityInput = priorityPrompt.value;
                  }
                }
                continue;
              }
              optionalIndex -= 1;
              continue;
            }
            field.setValue(prompt.value);
            optionalIndex += 1;
          }
        }
      }
      if (!taskTitle || taskTitle.trim().length === 0) {
        throw new Error("Task title is required.");
      }
      const priority = normalizePriority(priorityInput);
      const estimate = parseOptionalFloat(
        estimateHoursInput,
        "estimate-hours"
      );
      const subtaskOrder = parseOptionalInt(orderInput, "order");
      const dueAt = parseDueAtIso(dueAtInput);
      const normalizedType = typeInput?.trim().toLowerCase();
      if (normalizedType && normalizedType !== "feature" && normalizedType !== "bug" && normalizedType !== "chore" && normalizedType !== "spike" && normalizedType !== "enabler") {
        throw new Error(
          "type must be feature, bug, chore, spike, or enabler."
        );
      }
      const taskType = normalizedType === "feature" || normalizedType === "bug" || normalizedType === "chore" || normalizedType === "spike" || normalizedType === "enabler" ? normalizedType : void 0;
      let validationSteps = parseCommaList(validationInput);
      if (validationSteps === void 0 && process.stdin.isTTY && !validationInput && !runWizard) {
        const wantsValidation = await prompts9({
          type: "confirm",
          name: "add",
          message: "Add validation steps for this task?",
          initial: false
        });
        if (wantsValidation.add) {
          const response = await prompts9({
            type: "text",
            name: "steps",
            message: 'Enter validation steps (comma-separated, e.g. "pnpm build, pnpm test"):'
          });
          validationSteps = parseCommaList(response.steps);
        }
      }
      const parsedTags = parseCommaList(tagsInput);
      const parsedDependsOn = parseCommaList(dependsOnInput);
      const parsedBlockedBy = parseCommaList(blockedByInput);
      const actorName = resolveActorName(actorInput);
      const remoteTask = await createRemoteTask({
        title: taskTitle,
        description: descriptionInput,
        priority,
        tags: parsedTags,
        type: taskType,
        estimate_hours: estimate,
        depends_on: parsedDependsOn,
        blocked_by: parsedBlockedBy,
        recurrence_rule: recurrenceInput,
        owner_id: ownerInput,
        reviewer_id: reviewerInput,
        parent_id: parentInput,
        subtask_order: subtaskOrder,
        due_at: dueAt,
        validation_steps: validationSteps
      });
      if (remoteTask) {
        const localTask = await taskService.getTask(remoteTask.id);
        if (!localTask) {
          const cachedType = remoteTask.type === "feature" || remoteTask.type === "bug" || remoteTask.type === "chore" ? remoteTask.type : void 0;
          await taskService.addTask(
            remoteTask.title,
            remoteTask.description,
            normalizePriority(remoteTask.priority),
            reasoningInput,
            {
              id: remoteTask.id,
              status: remoteTask.status,
              assignee: remoteTask.assignee,
              tags: remoteTask.tags,
              type: cachedType,
              estimate_hours: remoteTask.estimate_hours,
              depends_on: remoteTask.depends_on,
              blocked_by: remoteTask.blocked_by,
              recurrence_rule: remoteTask.recurrence_rule,
              owner_id: remoteTask.owner_id,
              reviewer_id: remoteTask.reviewer_id,
              parent_id: remoteTask.parent_id,
              subtask_order: remoteTask.subtask_order,
              due_at: remoteTask.due_at,
              task_context: remoteTask.task_context,
              task_context_summary: remoteTask.task_context_summary,
              evidence: remoteTask.evidence,
              validation_steps: remoteTask.validation_steps,
              actor: actorName
            }
          );
        }
        console.log(
          chalk18.green(
            `
\u2714 Task created: ${remoteTask.id} (cloud + local cache)
`
          )
        );
        console.log(
          chalk18.gray(
            `Tip: Start working with AI context via \`vem agent --task ${remoteTask.id}\``
          )
        );
        return;
      }
      const task = await taskService.addTask(
        taskTitle,
        descriptionInput,
        priority,
        reasoningInput,
        {
          tags: parsedTags,
          type: taskType,
          estimate_hours: estimate,
          depends_on: parsedDependsOn,
          blocked_by: parsedBlockedBy,
          recurrence_rule: recurrenceInput,
          owner_id: ownerInput,
          reviewer_id: reviewerInput,
          parent_id: parentInput,
          subtask_order: subtaskOrder,
          due_at: dueAt,
          validation_steps: validationSteps,
          actor: actorName,
          cycle_id: cycleIdInput,
          impact_score: impactScoreInput !== void 0 && !Number.isNaN(impactScoreInput) ? impactScoreInput : void 0
        }
      );
      console.log(
        chalk18.green(`
\u2714 Task created: ${task.id} (local cache)
`)
      );
      console.log(
        chalk18.gray(
          `Tip: Start working with AI context via \`vem agent --task ${task.id}\``
        )
      );
    } catch (error) {
      console.error(chalk18.red(`Failed to create task: ${error.message}`));
    }
  });
  taskCmd.command("update <id>").description("Update task metadata").option("--tags <tags>", "Comma-separated tags").option("--type <type>", "Task type (feature, bug, chore, spike, enabler)").option("--estimate-hours <hours>", "Estimated hours (e.g. 2.5)").option("--depends-on <ids>", "Comma-separated task IDs").option("--blocked-by <ids>", "Comma-separated task IDs").option("--recurrence <rule>", "Recurrence rule (weekly, monthly, cron)").option("--owner <id>", "Owner ID").option("--reviewer <id>", "Reviewer ID").option("--parent <id>", "Parent task ID").option("--order <number>", "Subtask order").option("--due-at <iso>", "Due date ISO string (YYYY-MM-DD)").option(
    "--validation <steps>",
    "Set validation steps (comma-separated). Use empty string to clear."
  ).option("--cycle <id>", "Assign to a cycle (e.g. CYCLE-001)").option(
    "--impact-score <score>",
    "Impact score 0-100 (RICE-based priority)"
  ).option("--actor <name>", "Actor name for task update").option("-r, --reasoning <reasoning>", "Reasoning for update").action(async (id, options) => {
    try {
      const estimate = options.estimateHours !== void 0 ? Number.parseFloat(options.estimateHours) : void 0;
      if (estimate !== void 0 && Number.isNaN(estimate)) {
        throw new Error("estimate-hours must be a number");
      }
      const dueAt = options.dueAt && options.dueAt.trim().length > 0 ? new Date(
        options.dueAt.length === 10 ? `${options.dueAt}T00:00:00.000Z` : options.dueAt
      ).toISOString() : void 0;
      const parsedTags = parseCommaList(options.tags);
      const parsedDependsOn = parseCommaList(options.dependsOn);
      const parsedBlockedBy = parseCommaList(options.blockedBy);
      const parsedValidation = parseCommaList(options.validation);
      const parsedOrder = options.order !== void 0 ? Number.parseInt(options.order, 10) : void 0;
      const actorName = resolveActorName(options.actor);
      const cycleIdUpdate = typeof options.cycle === "string" ? options.cycle.trim() : void 0;
      const impactScoreUpdate = typeof options.impactScore === "string" ? Number.parseFloat(options.impactScore) : void 0;
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        tags: parsedTags,
        type: options.type,
        estimate_hours: estimate,
        depends_on: parsedDependsOn,
        blocked_by: parsedBlockedBy,
        recurrence_rule: options.recurrence,
        owner_id: options.owner,
        reviewer_id: options.reviewer,
        parent_id: options.parent,
        subtask_order: parsedOrder,
        due_at: dueAt,
        validation_steps: parsedValidation
      });
      const localTask = await taskService.getTask(id);
      if (localTask) {
        await taskService.updateTask(id, {
          tags: parsedTags,
          type: options.type,
          estimate_hours: estimate,
          depends_on: parsedDependsOn,
          blocked_by: parsedBlockedBy,
          recurrence_rule: options.recurrence,
          owner_id: options.owner,
          reviewer_id: options.reviewer,
          parent_id: options.parent,
          subtask_order: parsedOrder,
          due_at: dueAt,
          validation_steps: parsedValidation,
          reasoning: options.reasoning,
          actor: actorName,
          cycle_id: cycleIdUpdate,
          impact_score: impactScoreUpdate !== void 0 && !Number.isNaN(impactScoreUpdate) ? impactScoreUpdate : void 0
        });
      }
      if (remoteUpdated) {
        console.log(
          chalk18.green(
            `
\u2714 Task ${id} updated${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(chalk18.green(`
\u2714 Task ${id} updated (local cache)
`));
    } catch (error) {
      console.error(chalk18.red(`Failed to update task: ${error.message}`));
    }
  });
  taskCmd.command("done [id]").description("Mark a task as complete").option(
    "-e, --evidence <evidence>",
    "Evidence for completion (file path or command). Use comma-separated values for multiple entries."
  ).option("-r, --reasoning <reasoning>", "Reasoning for completion").option(
    "--validation <steps>",
    "Comma-separated validation steps completed (required when task has validation steps)"
  ).option("--actor <name>", "Actor name for task completion").option(
    "--context-summary <summary>",
    "Summary of the task context to preserve after completion"
  ).action(async (id, options) => {
    await trackCommandUsage("task done");
    try {
      if (!id) {
        const tasks = await taskService.getTasks();
        const inProgress = tasks.filter(
          (t) => t.status === "in-progress" && !t.deleted_at
        );
        if (inProgress.length === 0) {
          console.error(
            chalk18.yellow(
              "No tasks in progress. Provide an ID explicitly or start a task first."
            )
          );
          return;
        }
        const response = await prompts9({
          type: "select",
          name: "id",
          message: "Select a task to complete:",
          choices: inProgress.map((t) => ({
            title: `${t.id}: ${t.title}`,
            value: t.id
          }))
        });
        if (!response.id) {
          console.log(chalk18.yellow("Operation cancelled."));
          return;
        }
        id = response.id;
      }
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      const evidence = parseCommaList(options.evidence) ?? [];
      const actorName = resolveActorName(options.actor);
      let contextSummary = options.contextSummary;
      if (!contextSummary && task.task_context && process.stdin.isTTY) {
        const summary = await prompts9({
          type: "text",
          name: "text",
          message: "Task has context. Provide a brief summary to keep after completion (optional):"
        });
        contextSummary = summary.text || void 0;
      }
      if (!contextSummary && task.task_context) {
        contextSummary = summarizeTaskContext(task.task_context);
      }
      const requiredValidation = task.validation_steps ?? [];
      let validatedSteps = parseCommaList(options.validation);
      if (requiredValidation.length > 0 && validatedSteps === void 0) {
        if (!process.stdin.isTTY) {
          throw new Error(
            "Validation steps are required. Re-run with --validation in non-interactive mode."
          );
        }
        const confirmed = [];
        for (const step of requiredValidation) {
          const response = await prompts9({
            type: "confirm",
            name: "done",
            message: `Validation step completed? ${step}`,
            initial: true
          });
          if (!response.done) {
            console.log(
              chalk18.yellow(
                "Task completion cancelled. Complete all validation steps first."
              )
            );
            return;
          }
          confirmed.push(step);
        }
        validatedSteps = confirmed;
      }
      if (requiredValidation.length > 0) {
        const _requiredSet = new Set(requiredValidation);
        const providedSet = new Set(validatedSteps ?? []);
        const missing = requiredValidation.filter(
          (step) => !providedSet.has(step)
        );
        if (missing.length > 0) {
          throw new Error(`Missing validation steps: ${missing.join(", ")}.`);
        }
        for (const step of requiredValidation) {
          const entry = `Validated: ${step}`;
          if (!evidence.includes(entry)) {
            evidence.push(entry);
          }
        }
      }
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        status: "done",
        evidence,
        reasoning: options.reasoning,
        actor: actorName
      });
      const remoteContextUpdated = await updateRemoteTaskContext(id, {
        task_context: null,
        task_context_summary: contextSummary ?? null
      });
      if (localTask) {
        await taskService.updateTask(id, {
          status: "done",
          evidence,
          reasoning: options.reasoning,
          task_context_summary: contextSummary,
          actor: actorName
        });
      }
      if (remoteUpdated || remoteContextUpdated) {
        console.log(
          chalk18.green(
            `
\u2714 Task ${id} marked as DONE${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(
        chalk18.green(`
\u2714 Task ${id} marked as DONE (local cache)
`)
      );
    } catch (error) {
      console.error(chalk18.red(`Failed to complete task: ${error.message}`));
    }
  });
  taskCmd.command("start [id]").description("Start working on a task (set status to in-progress)").option("-r, --reasoning <reasoning>", "Reasoning for starting the task").option("--actor <name>", "Actor name").action(async (id, options) => {
    await trackCommandUsage("task start");
    try {
      if (!id) {
        const tasks = await taskService.getTasks();
        const todoTasks = tasks.filter(
          (t) => t.status === "todo" && !t.deleted_at
        );
        if (todoTasks.length === 0) {
          console.error(chalk18.yellow("No tasks in TODO status to start."));
          return;
        }
        const response = await prompts9({
          type: "select",
          name: "id",
          message: "Select a task to start:",
          choices: todoTasks.map((t) => ({
            title: `${t.id}: ${t.title}`,
            value: t.id
          }))
        });
        if (!response.id) {
          console.log(chalk18.yellow("Operation cancelled."));
          return;
        }
        id = response.id;
      }
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      if (task.status === "in-progress") {
        console.log(chalk18.yellow(`Task ${id} is already in progress.`));
        return;
      }
      if (task.status === "done") {
        console.error(chalk18.red(`Task ${id} is already completed.`));
        return;
      }
      const reasoning = options.reasoning || "Started working on task";
      const actorName = resolveActorName(options.actor);
      const gitRoot = await (async () => {
        try {
          const { execSync: execSync4 } = await import("child_process");
          return execSync4("git rev-parse --show-toplevel", {
            encoding: "utf-8"
          }).trim();
        } catch {
          return void 0;
        }
      })();
      if (gitRoot) {
        try {
          const sessions = await listAllAgentSessions(gitRoot);
          if (sessions.length > 0) {
            const latestSession = sessions[0];
            const existingSessions = localTask?.sessions || [];
            const alreadyAttached = existingSessions.some(
              (s) => s.id === latestSession.id
            );
            if (!alreadyAttached) {
              const sessionSummary = localTask?.title ?? latestSession.summary;
              const sessionRef = {
                id: latestSession.id,
                source: latestSession.source,
                started_at: (/* @__PURE__ */ new Date()).toISOString(),
                ...sessionSummary ? { summary: sessionSummary } : {}
              };
              if (localTask) {
                const updatedSessions = [...existingSessions, sessionRef];
                await taskService.updateTask(id, {
                  sessions: updatedSessions
                });
                await updateRemoteTaskMeta(id, { sessions: updatedSessions });
              }
            }
          }
        } catch {
        }
      }
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        status: "in-progress",
        reasoning,
        actor: actorName
      });
      if (localTask) {
        await taskService.updateTask(id, {
          status: "in-progress",
          reasoning,
          actor: actorName
        });
      }
      if (remoteUpdated) {
        console.log(
          chalk18.green(
            `
\u2714 Task ${id} is now IN PROGRESS${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(
        chalk18.green(`
\u2714 Task ${id} is now IN PROGRESS (local cache)
`)
      );
    } catch (error) {
      console.error(chalk18.red(`Failed to start task: ${error.message}`));
    }
  });
  taskCmd.command("block <id>").description("Mark a task as blocked").option("-r, --reasoning <reasoning>", "Reason for blocking (required)").option("--blocked-by <ids>", "Comma-separated task IDs blocking this task").option("--actor <name>", "Actor name").action(async (id, options) => {
    try {
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      if (task.status === "done") {
        console.error(chalk18.red(`Cannot block a completed task.`));
        return;
      }
      if (!options.reasoning) {
        console.error(
          chalk18.red(
            "Reasoning is required when blocking a task. Use -r or --reasoning."
          )
        );
        return;
      }
      const actorName = resolveActorName(options.actor);
      const blockedBy = parseCommaList(options.blockedBy) || task.blocked_by;
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        status: "blocked",
        blocked_by: blockedBy,
        reasoning: options.reasoning,
        actor: actorName
      });
      if (localTask) {
        await taskService.updateTask(id, {
          status: "blocked",
          blocked_by: blockedBy,
          reasoning: options.reasoning,
          actor: actorName
        });
      }
      if (remoteUpdated) {
        console.log(
          chalk18.yellow(
            `
\u26A0 Task ${id} is now BLOCKED${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(
        chalk18.yellow(`
\u26A0 Task ${id} is now BLOCKED (local cache)
`)
      );
    } catch (error) {
      console.error(chalk18.red(`Failed to block task: ${error.message}`));
    }
  });
  taskCmd.command("unblock <id>").description("Unblock a task (set status back to todo)").option("-r, --reasoning <reasoning>", "Reason for unblocking").option("--actor <name>", "Actor name").action(async (id, options) => {
    try {
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      if (task.status !== "blocked") {
        console.log(
          chalk18.yellow(`Task ${id} is not blocked (status: ${task.status}).`)
        );
        return;
      }
      const reasoning = options.reasoning || "Unblocked task";
      const actorName = resolveActorName(options.actor);
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        status: "todo",
        blocked_by: [],
        reasoning,
        actor: actorName
      });
      if (localTask) {
        await taskService.updateTask(id, {
          status: "todo",
          blocked_by: [],
          reasoning,
          actor: actorName
        });
      }
      if (remoteUpdated) {
        console.log(
          chalk18.green(
            `
\u2714 Task ${id} is now unblocked (TODO)${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(
        chalk18.green(`
\u2714 Task ${id} is now unblocked (TODO) (local cache)
`)
      );
    } catch (error) {
      console.error(chalk18.red(`Failed to unblock task: ${error.message}`));
    }
  });
  taskCmd.command("delete <id>").description("Soft delete a task").option("-r, --reasoning <reasoning>", "Reasoning for deletion").action(async (id, options) => {
    try {
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      const deletedAt = (/* @__PURE__ */ new Date()).toISOString();
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        deleted_at: deletedAt,
        reasoning: options.reasoning
      });
      if (localTask) {
        await taskService.updateTask(id, {
          deleted_at: deletedAt,
          reasoning: options.reasoning
        });
      }
      if (remoteUpdated) {
        console.log(
          chalk18.green(
            `
\u2714 Task ${id} soft deleted${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(chalk18.green(`
\u2714 Task ${id} soft deleted (local cache)
`));
    } catch (error) {
      console.error(chalk18.red(`Failed to delete task: ${error.message}`));
    }
  });
  program2.command("delete <id>").description("Soft delete a task").option("-r, --reasoning <reasoning>", "Reasoning for deletion").action(async (id, options) => {
    try {
      const [remoteTask] = await getDisplayTasks({
        id,
        includeDeleted: true
      });
      const localTask = await taskService.getTask(id);
      const task = remoteTask ?? localTask;
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      const deletedAt = (/* @__PURE__ */ new Date()).toISOString();
      const remoteUpdated = await updateRemoteTaskMeta(id, {
        deleted_at: deletedAt,
        reasoning: options.reasoning
      });
      if (localTask) {
        await taskService.updateTask(id, {
          deleted_at: deletedAt,
          reasoning: options.reasoning
        });
      }
      if (remoteUpdated) {
        console.log(
          chalk18.green(
            `
\u2714 Task ${id} soft deleted${localTask ? " (cloud + local cache)" : " (cloud)"}
`
          )
        );
        return;
      }
      if (!localTask) {
        throw new Error(
          `Task ${id} not found in cloud or local cache. Verify the ID and project link.`
        );
      }
      console.log(chalk18.green(`
\u2714 Task ${id} soft deleted (local cache)
`));
    } catch (error) {
      console.error(chalk18.red(`Failed to delete task: ${error.message}`));
    }
  });
  taskCmd.command("sessions <id>").description("Show all agent sessions attached to a task").action(async (id) => {
    await trackCommandUsage("task sessions");
    try {
      const task = await taskService.getTask(id);
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      const sessions = task.sessions || [];
      if (sessions.length === 0) {
        console.log(
          chalk18.yellow(`
No agent sessions attached to ${id} yet.`)
        );
        console.log(
          chalk18.gray(
            `  Run "vem task start ${id}" to attach the current session.
`
          )
        );
        return;
      }
      console.log(
        chalk18.bold(`
\u{1F517} Sessions attached to ${id}: ${task.title}
`)
      );
      const table = new Table4({
        head: ["Source", "Session ID", "Started", "Summary"].map(
          (h) => chalk18.white.bold(h)
        ),
        colWidths: [10, 20, 18, 50],
        style: { border: ["gray"] }
      });
      for (const s of sessions) {
        const sourceColor = s.source === "copilot" ? chalk18.blue : s.source === "claude" ? chalk18.magenta : chalk18.green;
        table.push([
          sourceColor(s.source),
          chalk18.gray(`${s.id.slice(0, 16)}\u2026`),
          chalk18.white(
            new Date(s.started_at).toLocaleDateString(void 0, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })
          ),
          chalk18.gray(s.summary?.slice(0, 48) || "\u2014")
        ]);
      }
      console.log(table.toString());
      console.log();
    } catch (error) {
      console.error(
        chalk18.red(`Failed to show task sessions: ${error.message}`)
      );
    }
  });
  taskCmd.command("flow [id]").description(
    "Show flow metrics for a task or project-level summary (throughput, cycle time, WIP)"
  ).action(async (id) => {
    await trackCommandUsage("task flow");
    try {
      if (id) {
        const task = await taskService.getTask(id);
        if (!task) {
          console.error(chalk18.red(`Task ${id} not found.`));
          return;
        }
        const metrics = await taskService.getFlowMetrics(id);
        const fmtMs = (ms) => {
          if (!ms) return chalk18.gray("\u2014");
          const days = Math.floor(ms / 864e5);
          const hrs = Math.floor(ms % 864e5 / 36e5);
          const mins = Math.floor(ms % 36e5 / 6e4);
          if (days > 0) return chalk18.white(`${days}d ${hrs}h`);
          if (hrs > 0) return chalk18.white(`${hrs}h ${mins}m`);
          return chalk18.white(`${mins}m`);
        };
        console.log(chalk18.bold(`
\u23F1  Flow Metrics: ${id} \u2014 ${task.title}
`));
        console.log(
          `  ${chalk18.gray("Lead time (created \u2192 done):")}  ${fmtMs(metrics.lead_time_ms)}`
        );
        console.log(
          `  ${chalk18.gray("Cycle time (started \u2192 done):")} ${fmtMs(metrics.cycle_time_ms)}`
        );
        if (Object.keys(metrics.time_in_status).length > 0) {
          console.log(chalk18.gray("\n  Time in each status:"));
          for (const [status, ms] of Object.entries(metrics.time_in_status)) {
            console.log(`    ${chalk18.cyan(status.padEnd(12))} ${fmtMs(ms)}`);
          }
        }
        console.log();
      } else {
        const summary = await taskService.getProjectFlowSummary();
        const fmtMs = (ms) => {
          if (!ms) return chalk18.gray("\u2014");
          const days = Math.floor(ms / 864e5);
          const hrs = Math.floor(ms % 864e5 / 36e5);
          if (days > 0) return chalk18.white(`${days}d ${hrs}h`);
          return chalk18.white(`${hrs}h`);
        };
        console.log(chalk18.bold("\n\u{1F4CA}  Project Flow Summary\n"));
        console.log(
          `  ${chalk18.gray("WIP (active tasks):")}         ${chalk18.yellow(String(summary.wip_count))}`
        );
        console.log(
          `  ${chalk18.gray("Throughput (last 7d):")}        ${chalk18.white(String(summary.throughput_last_7d))} tasks`
        );
        console.log(
          `  ${chalk18.gray("Throughput (last 30d):")}       ${chalk18.white(String(summary.throughput_last_30d))} tasks`
        );
        console.log(
          `  ${chalk18.gray("Avg cycle time:")}              ${fmtMs(summary.avg_cycle_time_ms)}`
        );
        console.log(
          `  ${chalk18.gray("Avg lead time:")}               ${fmtMs(summary.avg_lead_time_ms)}`
        );
        console.log();
      }
    } catch (error) {
      console.error(
        chalk18.red(`Failed to get flow metrics: ${error.message}`)
      );
    }
  });
  taskCmd.command("score [id]").description("Show or set the impact score (0-100) for a task").option("--set <score>", "Set impact score manually (0-100)").option("-r, --reasoning <reasoning>", "Reasoning for score change").action(async (id, options) => {
    await trackCommandUsage("task score");
    try {
      if (!id) {
        const tasks = await taskService.getTasks();
        const unscored = tasks.filter(
          (t) => t.impact_score === void 0 && t.status !== "done" && !t.deleted_at
        );
        if (unscored.length === 0) {
          console.log(
            chalk18.green("\n\u2714 All active tasks have impact scores.\n")
          );
          return;
        }
        const table = new Table4({
          head: ["ID", "Title", "Priority", "Score"],
          style: { head: ["cyan"] }
        });
        const all = tasks.filter((t) => t.status !== "done" && !t.deleted_at);
        for (const t of all) {
          table.push([
            chalk18.white(t.id),
            t.title,
            formatTaskPriority(t.priority),
            t.impact_score !== void 0 ? chalk18.yellow(String(Math.round(t.impact_score))) : chalk18.gray("\u2014")
          ]);
        }
        console.log(chalk18.bold("\n\u{1F3AF}  Impact Scores\n"));
        console.log(table.toString());
        console.log(
          chalk18.gray(
            `
  Unscored: ${unscored.length} task(s). Use: vem task score <id> --set <0-100>
`
          )
        );
        return;
      }
      const task = await taskService.getTask(id);
      if (!task) {
        console.error(chalk18.red(`Task ${id} not found.`));
        return;
      }
      if (options.set !== void 0) {
        const score = Number.parseFloat(options.set);
        if (Number.isNaN(score) || score < 0 || score > 100) {
          console.error(
            chalk18.red("Score must be a number between 0 and 100.")
          );
          process.exitCode = 1;
          return;
        }
        await taskService.updateTask(id, {
          impact_score: score,
          reasoning: options.reasoning
        });
        console.log(
          chalk18.green(`
\u2714 Impact score for ${id} set to ${score}
`)
        );
      } else {
        console.log(chalk18.bold(`
\u{1F3AF}  ${id}: ${task.title}`));
        console.log(
          `  Impact score: ${task.impact_score !== void 0 ? chalk18.yellow(String(Math.round(task.impact_score))) : chalk18.gray("not set")}`
        );
        console.log(
          chalk18.gray(`  Set with: vem task score ${id} --set <0-100>
`)
        );
      }
    } catch (error) {
      console.error(chalk18.red(`Failed to manage score: ${error.message}`));
    }
  });
  taskCmd.command("ready [id]").description("Mark a task as ready (refined and ready to start)").option("-r, --reasoning <reasoning>", "Reasoning for marking ready").option("--actor <name>", "Actor name").action(async (id, options) => {
    await trackCommandUsage("task ready");
    try {
      if (!id) {
        const tasks = await taskService.getTasks();
        const todos = tasks.filter(
          (t) => t.status === "todo" && !t.deleted_at
        );
        if (todos.length === 0) {
          console.error(chalk18.yellow("No todo tasks found."));
          return;
        }
        const response = await prompts9({
          type: "select",
          name: "value",
          message: "Which task is ready to start?",
          choices: todos.map((t) => ({
            title: `${t.id}: ${t.title}`,
            value: t.id
          }))
        });
        if (!response.value) return;
        id = response.value;
      }
      const actorName = resolveActorName(options.actor);
      await taskService.updateTask(id, {
        status: "ready",
        reasoning: options.reasoning || "Marked as refined and ready to start.",
        actor: actorName
      });
      console.log(chalk18.cyan(`
\u2714 Task ${id} marked as ready
`));
    } catch (error) {
      console.error(chalk18.red(`Failed to mark task ready: ${error.message}`));
    }
  });
}

// src/runtime/monitoring.ts
var sentry = null;
var NodeSentry = {
  captureException(error) {
    sentry?.captureException?.(error);
  }
};
async function initServerMonitoring(config) {
  if (!config.dsn) {
    if (config.environment !== "development") {
      console.warn(
        `[monitoring] Sentry DSN missing for ${config.serviceName} in ${config.environment}`
      );
    }
    return;
  }
  try {
    const loaded = await import("@sentry/node");
    sentry = loaded;
    loaded.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      integrations: loaded.httpIntegration ? [
        loaded.httpIntegration({
          trackIncomingRequestsAsSessions: true
        })
      ] : [],
      tracesSampleRate: config.sampleRate ?? (config.environment === "production" ? 0.1 : 1),
      initialScope: {
        tags: {
          service: config.serviceName
        }
      }
    });
  } catch (error) {
    console.warn(
      `[monitoring] Failed to initialize Sentry for ${config.serviceName}: ${String(
        error?.message ?? error
      )}`
    );
  }
}

// src/index.ts
await initServerMonitoring({
  dsn: "https://ed007f2c213d0aa07c1be256ca51750c@o4510863861612544.ingest.de.sentry.io/4510863921774672",
  environment: process.env.NODE_ENV || "production",
  release: "0.1.56",
  serviceName: "cli"
});
var program = new Command();
program.name("vem").description("vem Project Memory CLI").version("0.1.56").addHelpText(
  "after",
  `
${chalk19.bold("\n\u26A1 Power Workflows:")}
  ${chalk19.cyan("vem agent")}          Start AI-assisted work (${chalk19.bold("recommended")})
  ${chalk19.cyan("vem quickstart")}     Interactive setup wizard
  ${chalk19.cyan("vem status")}         Check your power feature usage

${chalk19.bold("\u{1F4A1} Getting Started:")}
  1. ${chalk19.white("vem init")}          Initialize memory
  2. ${chalk19.white("vem login")}         Authenticate
  3. ${chalk19.white("vem link")}          Connect to project
  4. ${chalk19.white("vem agent")}         Start working with AI

${chalk19.gray("For full command list: vem --help")}
`
);
program.hook("preAction", async (_thisCommand, actionCommand) => {
  await trackCommandUsageFromAction(actionCommand);
  if (process.env.VEM_AGENT_NAME) {
    await trackAgentSession("agent_heartbeat", {
      agentName: process.env.VEM_AGENT_NAME,
      taskId: process.env.VEM_ACTIVE_TASK,
      command: actionCommand.name()
    });
  }
  const skipInitCheck = ["init", "login", "help", "doctor", "diff"];
  if (skipInitCheck.includes(actionCommand.name())) {
    return;
  }
  if (!await isVemInitialized()) {
    console.error(
      chalk19.red("\n\u2716 vem is not initialized. Run `vem init` first.\n")
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
registerAuthCommands(program);
registerSearchCommands(program);
registerAgentCommands(program);
registerMaintenanceCommands(program);
registerSessionsCommands(program);
registerInstructionCommands(program);
await trackHelpUsageFromArgv(process.argv.slice(2));
try {
  program.parse();
} catch (error) {
  NodeSentry.captureException(error);
  console.error(chalk19.red("\n\u2716 An unexpected error occurred."));
  if (process.env.NODE_ENV === "development") {
    console.error(error);
  }
  process.exit(1);
}
//# sourceMappingURL=index.js.map