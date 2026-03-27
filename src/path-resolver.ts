/**
 * path-resolver.ts
 *
 * Resolves naming templates into concrete file paths.
 *
 * Supported template variables:
 *   {date}       → YYYY-MM-DD
 *   {datetime}   → YYYY-MM-DD-HHmmss
 *   {slug}       → slugified item name
 *   {name}       → raw item name
 *   {stage}      → stage name
 *   {workflow}   → workflow name
 *   {counter}    → auto-incrementing number (zero-padded)
 */

import { join } from "node:path";
import type { StageConfig } from "./config-loader.js";

export interface ResolveOptions {
  stagePath: string;
  namingTemplate: string;
  itemName: string;
  workflow?: string;
  stage?: string;
  counter?: number;
}

/**
 * Generate a concrete file path for an artifact.
 */
export function resolveArtifactPath(opts: ResolveOptions): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const datetime = date + "-" + now.toTimeString().slice(0, 8).replace(/:/g, "");

  const vars: Record<string, string> = {
    date,
    datetime,
    slug: slugify(opts.itemName),
    name: opts.itemName,
    stage: opts.stage ?? "",
    workflow: opts.workflow ?? "",
    counter: String(opts.counter ?? 0).padStart(4, "0"),
  };

  let filename = opts.namingTemplate;
  for (const [key, value] of Object.entries(vars)) {
    filename = filename.replaceAll(`{${key}}`, value);
  }

  return join(opts.stagePath, filename);
}

/**
 * Given a stage config, resolve the output path for an item.
 */
export function resolveForStage(
  stageConfig: StageConfig,
  itemName: string,
  workflow?: string,
  counter?: number
): string {
  return resolveArtifactPath({
    stagePath: stageConfig.path,
    namingTemplate: stageConfig.naming,
    itemName,
    workflow,
    stage: stageConfig.name,
    counter,
  });
}

/**
 * Convert a name to a URL/file-safe slug.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
