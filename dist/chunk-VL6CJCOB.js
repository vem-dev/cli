// ../../packages/core/dist/gemini-sessions.js
import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
function getGeminiTmpDir() {
  return join(homedir(), ".gemini", "tmp");
}
async function getGeminiProjectName(_gitRoot) {
  const projectsFile = join(homedir(), ".gemini", "projects.json");
  const pathToName = /* @__PURE__ */ new Map();
  try {
    const raw = await readFile(projectsFile, "utf-8");
    const data = JSON.parse(raw);
    const projects = data.projects;
    if (projects && typeof projects === "object") {
      for (const [path, name] of Object.entries(projects)) {
        pathToName.set(path, name);
      }
    }
  } catch {
  }
  return pathToName;
}
async function listGeminiSessions(gitRoot) {
  const tmpDir = getGeminiTmpDir();
  const pathToName = await getGeminiProjectName(gitRoot);
  let projectNames;
  if (gitRoot) {
    const name = pathToName.get(gitRoot);
    if (name) {
      projectNames = [name];
    } else {
      try {
        projectNames = await readdir(tmpDir);
      } catch {
        return [];
      }
    }
  } else {
    try {
      projectNames = await readdir(tmpDir);
    } catch {
      return [];
    }
  }
  const nameToPath = /* @__PURE__ */ new Map();
  for (const [path, name] of pathToName.entries()) {
    nameToPath.set(name, path);
  }
  const sessions = [];
  for (const projectName of projectNames) {
    const chatsDir = join(tmpDir, projectName, "chats");
    let chatFiles;
    try {
      chatFiles = await readdir(chatsDir);
    } catch {
      continue;
    }
    const projectPath = nameToPath.get(projectName) ?? null;
    if (gitRoot && projectPath && projectPath !== gitRoot)
      continue;
    for (const chatFile of chatFiles.filter((f) => f.endsWith(".json"))) {
      const filePath = join(chatsDir, chatFile);
      let data;
      try {
        const raw = await readFile(filePath, "utf-8");
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const sessionId = data.sessionId || chatFile.replace(".json", "");
      const startTime = data.startTime || "";
      const lastUpdated = data.lastUpdated || startTime;
      if (!startTime)
        continue;
      const messages = data.messages || [];
      const userMessages = [];
      for (const msg of messages) {
        if (msg.type !== "user")
          continue;
        const raw = msg.content;
        let text = null;
        if (typeof raw === "string" && raw.trim()) {
          text = raw.trim().slice(0, 200);
        } else if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item.text && typeof item.text === "string") {
              text = item.text.trim().slice(0, 200);
              break;
            }
          }
        }
        if (text && userMessages.length < 5)
          userMessages.push(text);
      }
      const summary = typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 100) : userMessages[0]?.slice(0, 100) || "";
      sessions.push({
        id: sessionId,
        source: "gemini",
        summary,
        branch: null,
        // Gemini CLI doesn't capture branch in session files
        repository: null,
        git_root: projectPath,
        cwd: projectPath,
        created_at: startTime,
        updated_at: lastUpdated,
        intents: [],
        user_messages: userMessages
      });
    }
  }
  sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return sessions;
}
async function computeGeminiSessionStats(sessionId) {
  const tmpDir = getGeminiTmpDir();
  let projectNames;
  try {
    projectNames = await readdir(tmpDir);
  } catch {
    return null;
  }
  for (const projectName of projectNames) {
    const filePath = join(tmpDir, projectName, "chats", `${sessionId}.json`);
    let data;
    try {
      const raw = await readFile(filePath, "utf-8");
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const startTime = data.startTime;
    const lastUpdated = data.lastUpdated || startTime;
    if (!startTime)
      continue;
    const sessionDurationMs = lastUpdated && startTime ? new Date(lastUpdated).getTime() - new Date(startTime).getTime() : void 0;
    const messages = data.messages || [];
    let turnCount = 0;
    let toolCallCount = 0;
    const modelBreakdown = {};
    for (const msg of messages) {
      if (msg.type === "model" || msg.role === "model") {
        turnCount++;
        const model = msg.model;
        if (model) {
          modelBreakdown[model] = (modelBreakdown[model] ?? 0) + 1;
        }
      }
      if (msg.type === "tool" || msg.role === "tool") {
        toolCallCount++;
      }
    }
    return {
      ended_at: lastUpdated ?? void 0,
      session_duration_ms: sessionDurationMs,
      turn_count: turnCount || void 0,
      tool_call_count: toolCallCount || void 0,
      model_breakdown: Object.keys(modelBreakdown).length > 0 ? modelBreakdown : void 0
    };
  }
  return null;
}

export {
  getGeminiTmpDir,
  listGeminiSessions,
  computeGeminiSessionStats
};
//# sourceMappingURL=chunk-VL6CJCOB.js.map