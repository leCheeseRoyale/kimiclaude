/**
 * kimi-bridge.js — Claude Code <-> Kimi CLI sub-agent bridge
 *
 * Two integration modes:
 *   1. Print mode  — one-shot task execution (simple, stateless)
 *   2. Wire mode   — persistent JSON-RPC session (bidirectional, stateful)
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

// ─── Print-mode spawner (one-shot sub-agent) ────────────────────────────

/**
 * Spawn kimi in print mode and return the full result.
 *
 * @param {object} opts
 * @param {string}   opts.prompt       — The task / instruction for kimi
 * @param {string}  [opts.workDir]     — Working directory (defaults to cwd)
 * @param {string}  [opts.model]       — Model override (e.g. "k1" or a provider model)
 * @param {boolean} [opts.thinking]    — Enable thinking mode
 * @param {boolean} [opts.finalOnly]   — Return only the final assistant message
 * @param {string}  [opts.agentFile]   — Path to a custom agent YAML spec
 * @param {string}  [opts.agent]       — Built-in agent name ("default" | "okabe")
 * @param {string}  [opts.session]     — Resume a specific session ID
 * @param {string[]} [opts.addDirs]    — Additional directories in workspace scope
 * @param {number}  [opts.maxSteps]    — Max steps per turn
 * @param {number}  [opts.timeout]     — Timeout in ms (default: 120_000)
 * @param {AbortSignal} [opts.signal]  — AbortSignal for cancellation
 * @returns {Promise<KimiPrintResult>}
 */
export async function spawnKimiAgent(opts) {
  const {
    prompt,
    workDir = process.cwd(),
    model,
    thinking,
    finalOnly = false,
    agentFile,
    agent,
    session,
    addDirs,
    maxSteps,
    timeout = 120_000,
    signal,
  } = opts;

  const args = ["--print", "--output-format", "stream-json"];
  args.push("-p", prompt);
  args.push("-w", workDir);

  if (model) args.push("-m", model);
  if (thinking === true) args.push("--thinking");
  if (thinking === false) args.push("--no-thinking");
  if (finalOnly) args.push("--final-message-only");
  if (agentFile) args.push("--agent-file", agentFile);
  else if (agent) args.push("--agent", agent);
  if (session) args.push("-S", session);
  if (maxSteps) args.push("--max-steps-per-turn", String(maxSteps));
  if (addDirs) {
    for (const d of addDirs) args.push("--add-dir", d);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("kimi", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workDir,
      signal,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    const messages = [];
    let stderr = "";

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // non-JSON line — ignore
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new KimiBridgeError("Kimi agent timed out", 75));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && messages.length === 0) {
        return reject(
          new KimiBridgeError(
            `Kimi exited with code ${code}: ${stderr.trim()}`,
            code ?? 1,
          ),
        );
      }

      const assistantMessages = messages.filter((m) => m.role === "assistant");
      const finalMessage = assistantMessages[assistantMessages.length - 1];

      resolve({
        exitCode: code ?? 0,
        messages,
        assistantMessages,
        finalMessage,
        finalText: extractText(finalMessage),
        retryable: code === 75,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new KimiBridgeError(`Failed to spawn kimi: ${err.message}`, 1));
    });
  });
}

// ─── Wire-mode client (persistent bidirectional session) ────────────────

/**
 * Persistent kimi wire-mode session using JSON-RPC 2.0 over stdio.
 *
 * Usage:
 *   const session = new KimiWireSession({ workDir: "/my/project" });
 *   await session.initialize();
 *   const result = await session.prompt("Refactor the auth module");
 *   session.on("event", (evt) => console.log(evt));
 *   await session.close();
 */
export class KimiWireSession extends EventEmitter {
  #proc = null;
  #rl = null;
  #pending = new Map(); // id -> { resolve, reject }
  #requestHandlers = new Map(); // method -> handler
  #initialized = false;
  #turnActive = false;

  /**
   * @param {object} opts
   * @param {string}  [opts.workDir]     — Working directory
   * @param {string}  [opts.model]       — Model override
   * @param {boolean} [opts.thinking]    — Enable thinking
   * @param {string}  [opts.agentFile]   — Custom agent YAML
   * @param {string}  [opts.agent]       — Built-in agent name
   * @param {string}  [opts.session]     — Session ID to resume
   */
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }

  /** Start the kimi process in wire mode and negotiate the protocol. */
  async initialize(externalTools = [], capabilities = {}) {
    const {
      workDir = process.cwd(),
      model,
      thinking,
      agentFile,
      agent,
      session,
    } = this.opts;

    const args = ["--wire"];
    args.push("-w", workDir);
    if (model) args.push("-m", model);
    if (thinking === true) args.push("--thinking");
    if (thinking === false) args.push("--no-thinking");
    if (agentFile) args.push("--agent-file", agentFile);
    else if (agent) args.push("--agent", agent);
    if (session) args.push("-S", session);

    this.#proc = spawn("kimi", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: workDir,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    this.#proc.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString());
    });

    this.#proc.on("close", (code) => {
      this.emit("close", code);
      for (const [, { reject }] of this.#pending) {
        reject(new KimiBridgeError("Kimi process exited", code ?? 1));
      }
      this.#pending.clear();
    });

    this.#rl = createInterface({ input: this.#proc.stdout });
    this.#rl.on("line", (line) => this.#handleLine(line));

    // Send initialize request
    const initResult = await this.#sendRequest("initialize", {
      protocol_version: "1.7",
      external_tools: externalTools,
      capabilities: {
        supports_question: true,
        supports_plan_mode: true,
        ...capabilities,
      },
    });

    this.#initialized = true;
    return initResult;
  }

  /** Send a prompt and wait for the turn to complete. */
  async prompt(userInput) {
    this.#assertInitialized();
    if (this.#turnActive) {
      throw new KimiBridgeError("A turn is already in progress", -32000);
    }
    this.#turnActive = true;
    try {
      const content =
        typeof userInput === "string" ? userInput : userInput;
      return await this.#sendRequest("prompt", { user_input: content });
    } finally {
      this.#turnActive = false;
    }
  }

  /** Inject a steering message into an active turn. */
  async steer(userInput) {
    this.#assertInitialized();
    return this.#sendRequest("steer", { user_input: userInput });
  }

  /** Cancel the active turn. */
  async cancel() {
    return this.#sendRequest("cancel", {});
  }

  /** Enable or disable plan mode. */
  async setPlanMode(enabled) {
    return this.#sendRequest("set_plan_mode", { enabled });
  }

  /** Replay recorded session events. */
  async replay() {
    return this.#sendRequest("replay", {});
  }

  /**
   * Register a handler for agent-initiated requests (approvals, tool calls, questions).
   * If no handler is registered, approvals auto-approve and tool calls return errors.
   */
  onRequest(method, handler) {
    this.#requestHandlers.set(method, handler);
  }

  /** Gracefully close the wire session. */
  async close() {
    if (this.#proc && !this.#proc.killed) {
      this.#proc.stdin.end();
      await new Promise((resolve) => this.#proc.on("close", resolve));
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  #assertInitialized() {
    if (!this.#initialized) {
      throw new KimiBridgeError("Session not initialized — call initialize() first", 1);
    }
  }

  #sendRequest(method, params) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#write({ jsonrpc: "2.0", method, id, params });
    });
  }

  #sendResponse(id, result) {
    this.#write({ jsonrpc: "2.0", id, result });
  }

  #sendError(id, code, message) {
    this.#write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  #write(obj) {
    if (this.#proc?.stdin?.writable) {
      this.#proc.stdin.write(JSON.stringify(obj) + "\n");
    }
  }

  #handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Response to our request
    if (msg.id && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) {
        reject(new KimiBridgeError(msg.error.message, msg.error.code));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Notification (event) from agent
    if (msg.method === "event") {
      this.emit("event", msg.params);
      this.#routeEvent(msg.params);
      return;
    }

    // Request from agent (needs our response)
    if (msg.method === "request" && msg.id) {
      this.#handleAgentRequest(msg.id, msg.params);
      return;
    }
  }

  #routeEvent(params) {
    if (!params?.type) return;
    this.emit(`event:${params.type}`, params);

    // Emit text content as it streams
    if (params.type === "ContentPart" && params.content?.type === "text") {
      this.emit("text", params.content.text);
    }
    if (params.type === "ContentPart" && params.content?.type === "think") {
      this.emit("thinking", params.content.think);
    }
    if (params.type === "ToolCall") {
      this.emit("tool_call", params.tool_call);
    }
    if (params.type === "ToolResult") {
      this.emit("tool_result", params);
    }
  }

  async #handleAgentRequest(id, params) {
    const requestType = params?.type;

    // Check for registered handler
    const handler = this.#requestHandlers.get(requestType);
    if (handler) {
      try {
        const result = await handler(params);
        this.#sendResponse(id, result);
      } catch (err) {
        this.#sendError(id, -32603, err.message);
      }
      return;
    }

    // Default behaviors
    switch (requestType) {
      case "ApprovalRequest":
        // Auto-approve by default (like --yolo)
        this.#sendResponse(id, {
          request_id: params.id,
          response: "approve",
        });
        break;

      case "ToolCallRequest":
        // External tool call with no handler — return error
        this.#sendError(id, -32601, `No handler for tool: ${params.name}`);
        break;

      case "QuestionRequest":
        // No handler — reject with empty answers
        this.#sendResponse(id, {
          request_id: params.id,
          answers: {},
        });
        break;

      default:
        this.#sendError(id, -32601, `Unknown request type: ${requestType}`);
    }
  }
}

// ─── Sub-agent pool (concurrent kimi workers) ───────────────────────────

/**
 * Manage a pool of kimi sub-agents for parallel task execution.
 *
 * Usage:
 *   const pool = new KimiAgentPool({ maxConcurrency: 3 });
 *   const results = await pool.runAll([
 *     { prompt: "Fix tests in auth/", workDir: "/project" },
 *     { prompt: "Add type hints to utils/", workDir: "/project" },
 *   ]);
 */
export class KimiAgentPool {
  constructor({ maxConcurrency = 3 } = {}) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Run multiple kimi agents with bounded concurrency.
   * @param {Array<Parameters<typeof spawnKimiAgent>[0]>} tasks
   * @returns {Promise<Array<{ status: "fulfilled" | "rejected", value?: KimiPrintResult, reason?: Error }>>}
   */
  async runAll(tasks) {
    const results = new Array(tasks.length);
    let cursor = 0;

    async function runNext() {
      while (cursor < tasks.length) {
        const idx = cursor++;
        try {
          results[idx] = {
            status: "fulfilled",
            value: await spawnKimiAgent(tasks[idx]),
          };
        } catch (err) {
          results[idx] = { status: "rejected", reason: err };
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(this.maxConcurrency, tasks.length) },
      () => runNext(),
    );
    await Promise.all(workers);
    return results;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function extractText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

export class KimiBridgeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "KimiBridgeError";
    this.code = code;
    this.retryable = code === 75;
  }
}

/**
 * Convenience: run a one-shot kimi agent and return just the text.
 * @param {string} prompt
 * @param {Omit<Parameters<typeof spawnKimiAgent>[0], 'prompt'>} [opts]
 * @returns {Promise<string>}
 */
export async function askKimi(prompt, opts = {}) {
  const result = await spawnKimiAgent({ prompt, finalOnly: true, ...opts });
  return result.finalText;
}
