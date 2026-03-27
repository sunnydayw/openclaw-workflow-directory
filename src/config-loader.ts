/**
 * config-loader.ts
 *
 * Loads workflow definitions from YAML files.
 * Searches in order:
 *   1. <workspace>/workflows/
 *   2. ~/.openclaw/workflows/
 *   3. WORKFLOW_DIR env var override
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

// ─── Types ───────────────────────────────────────────────────────────

export interface StageConfig {
  name: string;
  path: string; // may contain {base_path} template
  naming: string; // e.g. "{date}-{slug}.md"
}

export interface TransitionConfig {
  from: string;
  to: string;
}

export interface WorkflowConfig {
  workflow: string;
  base_path: string;
  stages: StageConfig[];
  transitions: TransitionConfig[];
}

// ─── Loader ──────────────────────────────────────────────────────────

const SEARCH_DIRS = [
  process.env.WORKFLOW_DIR,
  join(process.cwd(), "workflows"),
  join(homedir(), ".openclaw", "workflows"),
].filter(Boolean) as string[];

/**
 * Find all directories that contain workflow YAML files.
 */
function getWorkflowDirs(): string[] {
  return SEARCH_DIRS.filter((dir) => existsSync(dir));
}

/**
 * Load a single workflow config by name.
 * Searches SEARCH_DIRS for `<name>.yaml` or `<name>.yml`.
 */
export function loadWorkflowConfig(name: string): WorkflowConfig {
  for (const dir of getWorkflowDirs()) {
    for (const ext of [".yaml", ".yml"]) {
      const filePath = join(dir, `${name}${ext}`);
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = parseYaml(raw) as WorkflowConfig;
        validate(parsed, filePath);
        return resolveTemplatePaths(parsed);
      }
    }
  }

  const searched = getWorkflowDirs().join(", ");
  throw new Error(
    `Workflow "${name}" not found. Searched: ${searched || "(no workflow dirs exist)"}`
  );
}

/**
 * List all available workflow names.
 */
export function listWorkflows(): string[] {
  const names = new Set<string>();
  for (const dir of getWorkflowDirs()) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        names.add(file.replace(/\.ya?ml$/, ""));
      }
    }
  }
  return [...names].sort();
}

// ─── Internal ────────────────────────────────────────────────────────

function validate(config: WorkflowConfig, filePath: string): void {
  if (!config.workflow) {
    throw new Error(`Missing "workflow" field in ${filePath}`);
  }
  if (!config.base_path) {
    throw new Error(`Missing "base_path" field in ${filePath}`);
  }
  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new Error(`Missing or empty "stages" in ${filePath}`);
  }
  for (const stage of config.stages) {
    if (!stage.name || !stage.path || !stage.naming) {
      throw new Error(
        `Stage missing name/path/naming in ${filePath}: ${JSON.stringify(stage)}`
      );
    }
  }
}

function resolveTemplatePaths(config: WorkflowConfig): WorkflowConfig {
  const basePath = resolve(config.base_path);
  return {
    ...config,
    base_path: basePath,
    stages: config.stages.map((stage) => ({
      ...stage,
      path: stage.path.replace("{base_path}", basePath),
    })),
  };
}
