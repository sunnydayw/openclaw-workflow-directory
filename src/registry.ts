/**
 * registry.ts
 *
 * SQLite-backed work item registry.
 * Tracks every artifact through its workflow stages.
 *
 * Schema:
 *   work_items(id, workflow, name, current_stage, status,
 *              artifact_path, metadata, created_at, updated_at)
 *
 *   stage_history(id, item_id, stage, artifact_path, completed_at, agent_id)
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { loadWorkflowConfig } from "./config-loader.js";
import { resolveForStage } from "./path-resolver.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ItemStatus = "pending" | "in_progress" | "complete" | "failed";

export interface WorkItem {
  id: number;
  workflow: string;
  name: string;
  current_stage: string;
  status: ItemStatus;
  artifact_path: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StageHistoryEntry {
  id: number;
  item_id: number;
  stage: string;
  artifact_path: string;
  completed_at: string;
  agent_id: string | null;
}

export interface QueryFilter {
  workflow: string;
  stage?: string;
  status?: ItemStatus;
  name?: string;
  limit?: number;
}

export interface AdvanceResult {
  item: WorkItem;
  save_to: string;
  from_stage: string;
  to_stage: string;
}

// ─── Registry ────────────────────────────────────────────────────────

export class WorkflowRegistry {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? WorkflowRegistry.defaultDbPath();
    const dir = join(resolvedPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  static defaultDbPath(): string {
    return join(homedir(), ".openclaw", "workflow-directory", "registry.db");
  }

  // ─── Core Operations ────────────────────────────────────────────

  /**
   * Register a new work item at its initial stage.
   * Returns the item with its resolved artifact path.
   */
  register(
    workflow: string,
    stage: string,
    name: string,
    metadata: Record<string, unknown> = {},
    agentId?: string
  ): WorkItem {
    const config = loadWorkflowConfig(workflow);
    const stageConfig = config.stages.find((s) => s.name === stage);
    if (!stageConfig) {
      throw new Error(`Stage "${stage}" not found in workflow "${workflow}"`);
    }

    const artifactPath = resolveForStage(stageConfig, name, workflow);

    const stmt = this.db.prepare(`
      INSERT INTO work_items (workflow, name, current_stage, status, artifact_path, metadata)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `);

    const result = stmt.run(
      workflow,
      name,
      stage,
      artifactPath,
      JSON.stringify(metadata)
    );

    // Record in stage history
    this.db
      .prepare(
        `INSERT INTO stage_history (item_id, stage, artifact_path, agent_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(result.lastInsertRowid, stage, artifactPath, agentId ?? null);

    return this.getById(Number(result.lastInsertRowid))!;
  }

  /**
   * Query work items by workflow, stage, status, or name.
   */
  query(filter: QueryFilter): WorkItem[] {
    const conditions: string[] = ["workflow = ?"];
    const params: unknown[] = [filter.workflow];

    if (filter.stage) {
      conditions.push("current_stage = ?");
      params.push(filter.stage);
    }
    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter.name) {
      conditions.push("name LIKE ?");
      params.push(`%${filter.name}%`);
    }

    const limit = filter.limit ?? 50;
    const sql = `
      SELECT * FROM work_items
      WHERE ${conditions.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `;
    params.push(limit);

    return this.db
      .prepare(sql)
      .all(...params)
      .map(this.deserializeItem);
  }

  /**
   * Advance an item to its next stage (or a specific stage).
   * Returns the new artifact path where the agent should save output.
   */
  advance(
    workflow: string,
    itemName: string,
    toStage?: string,
    agentId?: string
  ): AdvanceResult {
    const items = this.query({ workflow, name: itemName, limit: 1 });
    if (items.length === 0) {
      throw new Error(`Item "${itemName}" not found in workflow "${workflow}"`);
    }
    const item = items[0];
    const config = loadWorkflowConfig(workflow);

    // Determine target stage
    const fromStage = item.current_stage;
    let targetStage = toStage;

    if (!targetStage) {
      // Find the next stage via transitions
      const transition = config.transitions.find((t) => t.from === fromStage);
      if (!transition) {
        throw new Error(
          `No transition defined from stage "${fromStage}" in workflow "${workflow}"`
        );
      }
      targetStage = transition.to;
    }

    const stageConfig = config.stages.find((s) => s.name === targetStage);
    if (!stageConfig) {
      throw new Error(
        `Target stage "${targetStage}" not found in workflow "${workflow}"`
      );
    }

    const newPath = resolveForStage(stageConfig, item.name, workflow);

    // Update item
    this.db
      .prepare(
        `UPDATE work_items
         SET current_stage = ?, status = 'pending', artifact_path = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(targetStage, newPath, item.id);

    // Mark previous stage complete in history
    this.db
      .prepare(
        `UPDATE stage_history
         SET completed_at = CURRENT_TIMESTAMP
         WHERE item_id = ? AND stage = ? AND completed_at IS NULL`
      )
      .run(item.id, fromStage);

    // Add new stage history entry
    this.db
      .prepare(
        `INSERT INTO stage_history (item_id, stage, artifact_path, agent_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(item.id, targetStage, newPath, agentId ?? null);

    return {
      item: this.getById(item.id)!,
      save_to: newPath,
      from_stage: fromStage,
      to_stage: targetStage!,
    };
  }

  /**
   * Mark an item's current stage as a specific status.
   */
  setStatus(workflow: string, itemName: string, status: ItemStatus): WorkItem {
    const items = this.query({ workflow, name: itemName, limit: 1 });
    if (items.length === 0) {
      throw new Error(`Item "${itemName}" not found in workflow "${workflow}"`);
    }

    this.db
      .prepare(
        `UPDATE work_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(status, items[0].id);

    return this.getById(items[0].id)!;
  }

  /**
   * Get the full stage history for an item.
   */
  getHistory(workflow: string, itemName: string): StageHistoryEntry[] {
    const items = this.query({ workflow, name: itemName, limit: 1 });
    if (items.length === 0) return [];

    return this.db
      .prepare(
        `SELECT * FROM stage_history WHERE item_id = ? ORDER BY id ASC`
      )
      .all(items[0].id) as StageHistoryEntry[];
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private getById(id: number): WorkItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM work_items WHERE id = ?")
      .get(id);
    return row ? this.deserializeItem(row) : undefined;
  }

  private deserializeItem(row: any): WorkItem {
    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow      TEXT NOT NULL,
        name          TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        artifact_path TEXT NOT NULL,
        metadata      TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_items_workflow_stage
        ON work_items(workflow, current_stage, status);

      CREATE INDEX IF NOT EXISTS idx_items_name
        ON work_items(workflow, name);

      CREATE TABLE IF NOT EXISTS stage_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id       INTEGER NOT NULL REFERENCES work_items(id),
        stage         TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        completed_at  TEXT,
        agent_id      TEXT,
        created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_history_item
        ON stage_history(item_id);
    `);
  }

  /**
   * Close the database connection. Call when shutting down.
   */
  close(): void {
    this.db.close();
  }
}
