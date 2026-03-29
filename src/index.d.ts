import { EventEmitter } from "node:events";

// ─── Print mode ─────────────────────────────────────────────────────────

export interface SpawnKimiOptions {
  prompt: string;
  workDir?: string;
  model?: string;
  thinking?: boolean;
  finalOnly?: boolean;
  agentFile?: string;
  agent?: "default" | "okabe" | string;
  session?: string;
  addDirs?: string[];
  maxSteps?: number;
  timeout?: number;
  signal?: AbortSignal;
}

export interface KimiMessage {
  role: "assistant" | "tool" | "user";
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: "text" | "think" | "image_url" | "audio_url" | "video_url";
  text?: string;
  think?: string;
}

export interface ToolCall {
  type: "function";
  id: string;
  function: { name: string; arguments: string };
}

export interface KimiPrintResult {
  exitCode: number;
  messages: KimiMessage[];
  assistantMessages: KimiMessage[];
  finalMessage: KimiMessage | undefined;
  finalText: string;
  retryable: boolean;
}

export function spawnKimiAgent(opts: SpawnKimiOptions): Promise<KimiPrintResult>;
export function askKimi(prompt: string, opts?: Omit<SpawnKimiOptions, "prompt">): Promise<string>;

// ─── Wire mode ──────────────────────────────────────────────────────────

export interface WireSessionOptions {
  workDir?: string;
  model?: string;
  thinking?: boolean;
  agentFile?: string;
  agent?: "default" | "okabe" | string;
  session?: string;
}

export interface ExternalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface WireCapabilities {
  supports_question?: boolean;
  supports_plan_mode?: boolean;
}

export interface PromptResult {
  status: "finished" | "cancelled" | "max_steps_reached";
  steps?: number;
}

export class KimiWireSession extends EventEmitter {
  constructor(opts?: WireSessionOptions);
  initialize(externalTools?: ExternalTool[], capabilities?: WireCapabilities): Promise<unknown>;
  prompt(userInput: string | ContentPart[]): Promise<PromptResult>;
  steer(userInput: string | ContentPart[]): Promise<{ status: "steered" }>;
  cancel(): Promise<{}>;
  setPlanMode(enabled: boolean): Promise<{ status: "ok"; plan_mode: boolean }>;
  replay(): Promise<{ status: string; events: number; requests: number }>;
  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void;
  close(): Promise<void>;
}

// ─── Agent pool ─────────────────────────────────────────────────────────

export interface PoolResult {
  status: "fulfilled" | "rejected";
  value?: KimiPrintResult;
  reason?: Error;
}

export class KimiAgentPool {
  constructor(opts?: { maxConcurrency?: number });
  runAll(tasks: SpawnKimiOptions[]): Promise<PoolResult[]>;
}

// ─── Error ──────────────────────────────────────────────────────────────

export class KimiBridgeError extends Error {
  code: number;
  retryable: boolean;
  constructor(message: string, code: number);
}
