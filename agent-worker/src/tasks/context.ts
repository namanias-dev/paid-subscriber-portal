import type { WorkerConfig } from "../config.js";
import type { PortalClient } from "../portalClient.js";
import type { OllamaClient } from "../ollamaClient.js";

/** Shared dependencies handed to every task. */
export interface TaskContext {
  cfg: WorkerConfig;
  portal: PortalClient;
  ollama: OllamaClient;
}

export type Task = (ctx: TaskContext) => Promise<void>;
