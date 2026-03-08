// ../../packages/core/dist/claude-sessions.js
import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
function getClaudeProjectsDir() {
  return join(homedir(), ".claude", "projects");
}
function encodePath(absPath) {
  return absPath.replace(/[/.]/g, "-");
}
async function listClaudeSessions(gitRoot) {
  const projectsDir = getClaudeProjectsDir();
  let projectDirs;
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const projectEntry of projectDirs) {
    if (gitRoot) {
      const encoded = encodePath(gitRoot);
      if (projectEntry !== encoded)
        continue;
    }
    const projectPath = join(projectsDir, projectEntry);
    let files;
    try {
      files = await readdir(projectPath);
    } catch {
      continue;
    }
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    for (const jsonlFile of jsonlFiles) {
      const sessionId = jsonlFile.replace(".jsonl", "");
      const filePath = join(projectPath, jsonlFile);
      let content;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }
      let cwd = null;
      let branch = null;
      let tsFirst = null;
      let tsLast = null;
      const userMessages = [];
      for (const line of content.split("\n")) {
        if (!line.trim())
          continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (!cwd && typeof event.cwd === "string")
          cwd = event.cwd;
        if (!branch && typeof event.gitBranch === "string")
          branch = event.gitBranch;
        const ts = event.timestamp;
        if (ts) {
          if (!tsFirst)
            tsFirst = ts;
          tsLast = ts;
        }
        if (event.type === "user" && !event.isMeta) {
          const msg = event.message;
          const raw = msg?.content;
          let text = null;
          if (typeof raw === "string" && raw && !raw.startsWith("<")) {
            text = raw.slice(0, 200).trim();
          } else if (Array.isArray(raw)) {
            for (const item of raw) {
              if (item.type === "text" && typeof item.text === "string") {
                const t = item.text.trim();
                if (t && !t.startsWith("<")) {
                  text = t.slice(0, 200);
                  break;
                }
              }
            }
          }
          if (text && userMessages.length < 5)
            userMessages.push(text);
        }
      }
      if (!tsFirst)
        continue;
      const summary = userMessages[0]?.slice(0, 100) || "";
      sessions.push({
        id: sessionId,
        source: "claude",
        summary,
        branch,
        repository: null,
        git_root: cwd,
        // treat cwd as git_root for filtering
        cwd,
        created_at: tsFirst,
        updated_at: tsLast || tsFirst,
        intents: [],
        user_messages: userMessages
      });
    }
  }
  sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return sessions;
}
async function computeClaudeSessionStats(sessionId) {
  const projectsDir = getClaudeProjectsDir();
  let projectDirs;
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return null;
  }
  for (const projectEntry of projectDirs) {
    const filePath = join(projectsDir, projectEntry, `${sessionId}.jsonl`);
    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
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
      if (event.type === "assistant") {
        turnCount++;
        const model = event.model;
        if (model) {
          modelBreakdown[model] = (modelBreakdown[model] ?? 0) + 1;
        }
        const msg = event.message;
        const content_blocks = msg?.content;
        if (Array.isArray(content_blocks)) {
          for (const block of content_blocks) {
            if (block.type === "tool_use")
              toolCallCount++;
          }
        }
      }
    }
    if (!tsFirst)
      continue;
    const sessionDurationMs = tsLast && tsFirst ? new Date(tsLast).getTime() - new Date(tsFirst).getTime() : void 0;
    return {
      ended_at: tsLast ?? void 0,
      session_duration_ms: sessionDurationMs,
      turn_count: turnCount || void 0,
      tool_call_count: toolCallCount || void 0,
      model_breakdown: Object.keys(modelBreakdown).length > 0 ? modelBreakdown : void 0
    };
  }
  return null;
}

export {
  getClaudeProjectsDir,
  listClaudeSessions,
  computeClaudeSessionStats
};
//# sourceMappingURL=chunk-PMUCN3Y6.js.map