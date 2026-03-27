/**
 * registry.test.ts
 *
 * Tests the core workflow: register → query → advance
 * Uses an in-memory YAML override and temp DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowRegistry } from "../src/registry.js";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

let registry: WorkflowRegistry;
let tempDir: string;

beforeEach(() => {
  // Create temp dir for DB and workflow configs
  tempDir = mkdtempSync(join(tmpdir(), "wfdir-test-"));
  const dbPath = join(tempDir, "test.db");
  const workflowDir = join(tempDir, "workflows");
  mkdirSync(workflowDir, { recursive: true });

  // Write a test workflow config
  writeFileSync(
    join(workflowDir, "test-pipeline.yaml"),
    `
workflow: test-pipeline
base_path: ${tempDir}/artifacts

stages:
  - name: inbox
    path: "{base_path}/inbox"
    naming: "{date}-{slug}.md"

  - name: processed
    path: "{base_path}/processed"
    naming: "{date}-{slug}-done.md"

  - name: archived
    path: "{base_path}/archived"
    naming: "{slug}-final.md"

transitions:
  - from: inbox
    to: processed
  - from: processed
    to: archived
`
  );

  // Point config loader to our temp workflows
  process.env.WORKFLOW_DIR = workflowDir;

  registry = new WorkflowRegistry(dbPath);
});

afterEach(() => {
  registry.close();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.WORKFLOW_DIR;
});

describe("WorkflowRegistry", () => {
  it("registers a new item and returns artifact path", () => {
    const item = registry.register("test-pipeline", "inbox", "my-cool-idea");

    expect(item.workflow).toBe("test-pipeline");
    expect(item.name).toBe("my-cool-idea");
    expect(item.current_stage).toBe("inbox");
    expect(item.status).toBe("pending");
    expect(item.artifact_path).toContain("inbox");
    expect(item.artifact_path).toContain("my-cool-idea");
    expect(item.artifact_path).toMatch(/\.md$/);
  });

  it("queries items by workflow and stage", () => {
    registry.register("test-pipeline", "inbox", "idea-one");
    registry.register("test-pipeline", "inbox", "idea-two");
    registry.register("test-pipeline", "processed", "idea-three");

    const inbox = registry.query({
      workflow: "test-pipeline",
      stage: "inbox",
    });
    expect(inbox).toHaveLength(2);

    const processed = registry.query({
      workflow: "test-pipeline",
      stage: "processed",
    });
    expect(processed).toHaveLength(1);
    expect(processed[0].name).toBe("idea-three");
  });

  it("queries items by status", () => {
    registry.register("test-pipeline", "inbox", "pending-item");
    registry.register("test-pipeline", "inbox", "done-item");
    registry.setStatus("test-pipeline", "done-item", "complete");

    const pending = registry.query({
      workflow: "test-pipeline",
      stage: "inbox",
      status: "pending",
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe("pending-item");
  });

  it("advances item to next stage and returns save path", () => {
    registry.register("test-pipeline", "inbox", "advance-me");

    const result = registry.advance("test-pipeline", "advance-me");

    expect(result.from_stage).toBe("inbox");
    expect(result.to_stage).toBe("processed");
    expect(result.save_to).toContain("processed");
    expect(result.save_to).toContain("advance-me");
    expect(result.item.current_stage).toBe("processed");
  });

  it("advances to a specific stage when specified", () => {
    registry.register("test-pipeline", "inbox", "skip-ahead");

    const result = registry.advance(
      "test-pipeline",
      "skip-ahead",
      "archived"
    );

    expect(result.to_stage).toBe("archived");
    expect(result.save_to).toContain("archived");
  });

  it("records stage history", () => {
    registry.register("test-pipeline", "inbox", "tracked-item");
    registry.advance("test-pipeline", "tracked-item");

    const history = registry.getHistory("test-pipeline", "tracked-item");
    expect(history).toHaveLength(2);
    expect(history[0].stage).toBe("inbox");
    expect(history[1].stage).toBe("processed");
  });

  it("stores and retrieves metadata", () => {
    registry.register("test-pipeline", "inbox", "with-meta", {
      source: "discord",
      channel: "#ideas",
      priority: "high",
    });

    const items = registry.query({
      workflow: "test-pipeline",
      name: "with-meta",
    });
    expect(items[0].metadata).toEqual({
      source: "discord",
      channel: "#ideas",
      priority: "high",
    });
  });

  it("throws on unknown workflow", () => {
    expect(() =>
      registry.register("nonexistent", "inbox", "fail")
    ).toThrow(/not found/);
  });

  it("throws on unknown stage", () => {
    expect(() =>
      registry.register("test-pipeline", "nonexistent", "fail")
    ).toThrow(/not found/);
  });
});
