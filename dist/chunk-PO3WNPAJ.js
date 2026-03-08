// ../../packages/core/dist/copilot-sessions.js
import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
function getCopilotSessionsDir() {
  return join(homedir(), ".copilot", "session-state");
}
async function parseWorkspaceYaml(content) {
  const result = {};
  for (const line of content.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1)
      continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value)
      result[key] = value;
  }
  return result;
}
async function listCopilotSessions(gitRoot) {
  const sessionsDir = getCopilotSessionsDir();
  let entries;
  try {
    entries = await readdir(sessionsDir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const entry of entries) {
    if (entry.includes("."))
      continue;
    const workspacePath = join(sessionsDir, entry, "workspace.yaml");
    try {
      const content = await readFile(workspacePath, "utf-8");
      const parsed = await parseWorkspaceYaml(content);
      if (!parsed.id)
        continue;
      if (gitRoot && parsed.git_root && parsed.git_root !== gitRoot)
        continue;
      sessions.push({
        id: parsed.id,
        summary: parsed.summary || "",
        branch: parsed.branch || null,
        repository: parsed.repository || null,
        git_root: parsed.git_root || null,
        cwd: parsed.cwd || null,
        created_at: parsed.created_at || "",
        updated_at: parsed.updated_at || ""
      });
    } catch {
    }
  }
  sessions.sort((a, b) => {
    if (!a.updated_at)
      return 1;
    if (!b.updated_at)
      return -1;
    return b.updated_at.localeCompare(a.updated_at);
  });
  return sessions;
}
async function readCopilotSessionDetail(id) {
  const sessionsDir = getCopilotSessionsDir();
  const workspacePath = join(sessionsDir, id, "workspace.yaml");
  const eventsPath = join(sessionsDir, id, "events.jsonl");
  let session;
  try {
    const content = await readFile(workspacePath, "utf-8");
    const parsed = await parseWorkspaceYaml(content);
    if (!parsed.id)
      return null;
    session = {
      id: parsed.id,
      summary: parsed.summary || "",
      branch: parsed.branch || null,
      repository: parsed.repository || null,
      git_root: parsed.git_root || null,
      cwd: parsed.cwd || null,
      created_at: parsed.created_at || "",
      updated_at: parsed.updated_at || ""
    };
  } catch {
    return null;
  }
  const intents = [];
  const user_messages = [];
  try {
    const eventsContent = await readFile(eventsPath, "utf-8");
    for (const line of eventsContent.split("\n")) {
      if (!line.trim())
        continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const type = event.type;
      const data = event.data;
      if (type === "user.message" && typeof data?.content === "string") {
        const msg = data.content.trim();
        if (msg)
          user_messages.push(msg);
      }
      if (type === "assistant.message") {
        const toolRequests = data?.toolRequests;
        if (Array.isArray(toolRequests)) {
          for (const req of toolRequests) {
            if (req.name === "report_intent" && typeof req.arguments?.intent === "string") {
              const intent = req.arguments.intent.trim();
              if (intent)
                intents.push(intent);
            }
          }
        }
      }
    }
  } catch {
  }
  return { ...session, intents, user_messages };
}
async function computeCopilotSessionStats(id) {
  const sessionsDir = getCopilotSessionsDir();
  const eventsPath = join(sessionsDir, id, "events.jsonl");
  let content;
  try {
    content = await readFile(eventsPath, "utf-8");
  } catch {
    return null;
  }
  let tsFirst = null;
  let tsLast = null;
  let turnCount = 0;
  let toolCallCount = 0;
  const modelBreakdown = {};
  for (const line of content.split("\n")) {
    if (!line.trim())
      continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = event.timestamp;
    if (ts) {
      if (!tsFirst)
        tsFirst = ts;
      tsLast = ts;
    }
    const type = event.type;
    if (type === "assistant.turn_end") {
      turnCount++;
    }
    if (type === "tool.execution_complete") {
      toolCallCount++;
      const data = event.data;
      const model = data?.model;
      if (model) {
        modelBreakdown[model] = (modelBreakdown[model] ?? 0) + 1;
      }
    }
  }
  if (!tsFirst)
    return null;
  const sessionDurationMs = tsLast && tsFirst ? new Date(tsLast).getTime() - new Date(tsFirst).getTime() : void 0;
  return {
    ended_at: tsLast ?? void 0,
    session_duration_ms: sessionDurationMs,
    turn_count: turnCount || void 0,
    tool_call_count: toolCallCount || void 0,
    model_breakdown: Object.keys(modelBreakdown).length > 0 ? modelBreakdown : void 0
  };
}

export {
  getCopilotSessionsDir,
  listCopilotSessions,
  readCopilotSessionDetail,
  computeCopilotSessionStats
};
//# sourceMappingURL=chunk-PO3WNPAJ.js.map