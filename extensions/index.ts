import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import crypto from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPlaintextBearerAuthGuard } from "./security.js";

const execFileP = promisify(execFileCb);

type TextBlock = { type?: string; text?: string };
type AssistantMessage = { role?: string; content?: unknown };
type SmartSearchResult = {
  title?: string;
  narrative?: string;
  type?: string;
  combinedScore?: number;
  score?: number;
  observation?: {
    title?: string;
    narrative?: string;
    type?: string;
  };
};

type HealthResponse = {
  status?: string;
  service?: string;
  version?: string;
  health?: {
    status?: string;
    notes?: string[];
  };
};

const DEFAULT_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";
const guardPlaintextBearerAuth = createPlaintextBearerAuthGuard();
const TOOL_GUIDANCE = [
  "agentmemory is available for cross-session memory.",
  "Use memory_search to recall prior decisions, preferences, bugs, and workflows.",
  "Use memory_save when you discover durable facts worth remembering beyond this session.",
].join(" ");

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [] as string[];
      const block = part as TextBlock;
      if (block.type === "text" && typeof block.text === "string") return [block.text];
      return [] as string[];
    })
    .join("\n")
    .trim();
}

function getLastAssistantText(messages: unknown[]): string {
  for (const msg of [...messages].reverse()) {
    if (!msg || typeof msg !== "object") continue;
    const assistant = msg as AssistantMessage;
    if (assistant.role !== "assistant") continue;
    const text = getText(assistant.content);
    if (text) return text;
  }
  return "";
}

function formatSearchResults(results: SmartSearchResult[]): string {
  if (!results.length) return "No relevant memories found.";
  return results
    .slice(0, 5)
    .map((result, index) => {
      const obs = result.observation ?? result;
      const title = obs.title?.trim() || `Memory ${index + 1}`;
      const narrative = obs.narrative?.trim() || "";
      const type = obs.type?.trim() || "memory";
      const score = result.combinedScore ?? result.score;
      const scoreText = typeof score === "number" ? ` [score=${score.toFixed(3)}]` : "";
      return `- ${title} (${type})${scoreText}${narrative ? `: ${narrative}` : ""}`;
    })
    .join("\n");
}

async function callAgentMemory<T>(
  pathname: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    baseUrl?: string;
  },
): Promise<T | null> {
  const baseUrl = normalizeBaseUrl(options?.baseUrl || process.env.AGENTMEMORY_URL || DEFAULT_URL);
  const method = options?.method || "POST";
  const url = `${baseUrl}/agentmemory/${pathname.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = {};
  const secret = process.env.AGENTMEMORY_SECRET;
  guardPlaintextBearerAuth(baseUrl, secret);
  if (options?.body !== undefined) headers["Content-Type"] = "application/json";
  if (secret) headers.Authorization = `Bearer ${secret}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// --- Backup ------------------------------------------------------------------
// Spawns the bundled scripts/agentmemory-backup.sh (file-level tar+rotate+rsync).
// Resolution order: AGENTMEMORY_BACKUP_SCRIPT env → bundled script next to this
// extension → bare "agentmemory-backup.sh" on PATH. Returns a clear result;
// never throws so the tool/command always yield a usable message.
function resolveBackupScript(): { script: string; viaPath: boolean } | null {
  const envScript = process.env.AGENTMEMORY_BACKUP_SCRIPT;
  if (envScript && existsSync(envScript)) return { script: envScript, viaPath: false };
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bundled = path.join(here, "..", "scripts", "agentmemory-backup.sh");
    if (existsSync(bundled)) return { script: bundled, viaPath: false };
  } catch {
    // import.meta.url unavailable in this loader — fall through to PATH lookup.
  }
  return null;
}

type BackupResult = {
  ok: boolean;
  script: string;
  stdout: string;
  stderr: string;
  archive?: string;
};

async function runBackup(opts: { dryRun?: boolean } = {}): Promise<BackupResult> {
  const resolved = resolveBackupScript();
  const script = resolved?.script ?? "agentmemory-backup.sh";
  const viaPath = !resolved;
  const label = viaPath ? `${script} (PATH)` : script;
  const args = opts.dryRun ? ["--dry-run"] : [];
  try {
    const { stdout, stderr } = await execFileP(script, args, {
      env: { ...process.env },
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    const archive = opts.dryRun ? undefined : lines[lines.length - 1];
    return { ok: true, script: label, stdout, stderr, archive };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      script: label,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

export default function agentmemoryExtension(pi: ExtensionAPI) {
  if (process.env.AGENTMEMORY_REQUIRE_HTTPS === "1") {
    guardPlaintextBearerAuth(
      normalizeBaseUrl(process.env.AGENTMEMORY_URL || DEFAULT_URL),
      process.env.AGENTMEMORY_SECRET,
    );
  }

  let sessionId = `ephemeral-${crypto.randomUUID().slice(0, 8)}`;
  let currentProject = process.cwd();
  let lastPrompt = "";
  let lastHealthOk = false;

  async function getHealth() {
    return await callAgentMemory<HealthResponse>("health", { method: "GET" });
  }

  async function refreshStatus(ctx: { ui: { setStatus: (key: string, text: string) => void } }) {
    const health = await getHealth();
    lastHealthOk = !!health && (health.status === "healthy" || health.health?.status === "healthy");
    ctx.ui.setStatus("agentmemory", lastHealthOk ? "🧠 agentmemory" : "🧠 agentmemory off");
  }

  pi.registerCommand("agentmemory-status", {
    description: "Check local agentmemory server health",
    handler: async (_args, ctx) => {
      const health = await getHealth();
      if (!health) {
        ctx.ui.notify("agentmemory is unreachable at http://localhost:3111", "warning");
        return;
      }
      ctx.ui.notify(
        `agentmemory ${health.status || health.health?.status || "unknown"}${health.version ? ` v${health.version}` : ""}`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "memory_health",
    label: "Memory Health",
    description: "Check whether the local agentmemory server is reachable and healthy",
    parameters: Type.Object({}),
    async execute() {
      const health = await getHealth();
      if (!health) {
        return {
          content: [{ type: "text", text: "agentmemory is unreachable at http://localhost:3111" }],
          details: { ok: false },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `agentmemory status: ${health.status || health.health?.status || "unknown"}${health.version ? ` (v${health.version})` : ""}`,
          },
        ],
        details: health,
      };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search agentmemory for cross-session project memory, prior decisions, bugs, and user preferences",
    parameters: Type.Object({
      query: Type.String({ description: "What to search for in memory" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5, description: "Maximum results" })),
    }),
    async execute(_toolCallId, params) {
      const result = await callAgentMemory<{ results?: SmartSearchResult[] }>("smart-search", {
        body: { query: params.query, limit: params.limit ?? 5 },
      });
      const results = result?.results || [];
      return {
        content: [{ type: "text", text: formatSearchResults(results) }],
        details: { query: params.query, results },
      };
    },
  });

  pi.registerTool({
    name: "memory_save",
    label: "Memory Save",
    description: "Save a durable fact, convention, workflow, preference, or bug fix into agentmemory",
    parameters: Type.Object({
      content: Type.String({ description: "What should be remembered" }),
      type: Type.Optional(
        Type.String({
          description: "Memory type",
          default: "fact",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await callAgentMemory<Record<string, unknown>>("remember", {
        body: { content: params.content, type: params.type || "fact" },
      });
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to save memory to agentmemory." }],
          details: { ok: false },
        };
      }
      return {
        content: [{ type: "text", text: `Saved memory (${params.type || "fact"}): ${params.content}` }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "memory_backup",
    label: "Memory Backup",
    description:
      "Run a file-level backup of the agentmemory store to a local tar.gz (and an optional remote via AGENTMEMORY_BACKUP_REMOTE). Use before risky changes or to capture a snapshot.",
    parameters: Type.Object({
      dryRun: Type.Optional(
        Type.Boolean({ description: "If true, show what would happen without writing", default: false }),
      ),
    }),
    async execute(_toolCallId, params) {
      const r = await runBackup({ dryRun: params.dryRun === true });
      const head = r.ok
        ? `agentmemory backup ${params.dryRun ? "dry-run OK" : "succeeded"}${r.archive ? `: ${r.archive}` : ""} (via ${r.script})`
        : `agentmemory backup failed (via ${r.script})`;
      return {
        content: [{ type: "text", text: [head, (r.stderr || r.stdout).trim()].filter(Boolean).join("\n") }],
        details: r,
      };
    },
  });

  pi.registerCommand("agentmemory-backup", {
    description: "Run an agentmemory backup now (append --dry-run to preview)",
    handler: async (args, ctx) => {
      const dryRun = String(args || "").includes("dry-run");
      const r = await runBackup({ dryRun });
      ctx.ui.notify(
        r.ok
          ? `agentmemory backup ${dryRun ? "dry-run OK" : "done"}${r.archive ? `: ${path.basename(r.archive)}` : ""}`
          : "agentmemory backup failed",
        r.ok ? "info" : "warning",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    sessionId = sessionFile ? path.basename(sessionFile).replace(/\.[^.]+$/, "") : `ephemeral-${crypto.randomUUID().slice(0, 8)}`;
    currentProject = process.cwd();
    await refreshStatus(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentProject = event.systemPromptOptions.cwd || process.cwd();
    lastPrompt = event.prompt?.trim() || "";
    if (!lastPrompt) return;

    const result = await callAgentMemory<{ results?: SmartSearchResult[] }>("smart-search", {
      body: { query: lastPrompt, limit: 5 },
    });
    const results = result?.results || [];
    const recallBlock = results.length
      ? [
          "Relevant long-term memory from agentmemory:",
          formatSearchResults(results),
        ].join("\n")
      : "";

    await refreshStatus(ctx);
    return {
      systemPrompt: [event.systemPrompt, TOOL_GUIDANCE, recallBlock].filter(Boolean).join("\n\n"),
    };
  });

  pi.on("agent_end", async (event) => {
    if (!lastHealthOk || !lastPrompt) return;
    const assistantText = getLastAssistantText(event.messages as unknown[]);
    if (!assistantText) return;
    void callAgentMemory("observe", {
      body: {
        hookType: "post_tool_use",
        sessionId,
        project: currentProject,
        cwd: currentProject,
        timestamp: new Date().toISOString(),
        data: {
          tool_name: "conversation",
          tool_input: lastPrompt.slice(0, 500),
          tool_output: assistantText.slice(0, 4000),
        },
      },
    });
  });
}
