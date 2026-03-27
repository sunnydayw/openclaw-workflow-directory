# How It Works

A deep dive into the architecture, data model, and design decisions behind the workflow directory plugin.

## The Core Problem

OpenClaw agents need to pass artifacts between each other — a Discord ingestion agent writes a file, a research agent reads it, a summarizer reads that. The naive approach puts file paths in every prompt:

```
"Save ideas to /workspace/ideas/backlog/{date}-{name}.md"
"Read from /workspace/ideas/researched/ for items to summarize"
```

This breaks whenever you rename a folder, add a stage, or change the naming convention. Every prompt that touches that workflow has to be updated by hand.

The workflow directory inverts the dependency. Agents ask *it* where files are — the paths are never in prompts.

---

## System Overview

```
YAML configs (version-controlled)
      │
      ▼
config-loader.ts ──► path-resolver.ts
      │                     │
      │                     ▼
      └──────────► registry.ts (SQLite)
                        │
                        ▼
                    index.ts (OpenClaw tools)
                        │
                        ▼
                   Agent calls tools
```

Each layer has one job:

| File | Job |
|---|---|
| `config-loader.ts` | Parse YAML workflow definitions |
| `path-resolver.ts` | Turn naming templates into real paths |
| `registry.ts` | Track every item's lifecycle in SQLite |
| `index.ts` | Expose registry operations as OpenClaw tools |

---

## Data Model

### Work Items

Every artifact in the system has a corresponding row in `work_items`:

```
id              — auto-increment primary key
workflow        — which workflow this belongs to (e.g. "product-ideas")
name            — short slug identifying the item (e.g. "mobile-nav-redesign")
current_stage   — where the item is right now (e.g. "backlog")
status          — pending | in_progress | complete | failed
artifact_path   — the resolved filesystem path for this stage
metadata        — arbitrary JSON (source, tags, priority, etc.)
claimed_by      — agent ID that currently holds the item (null if unclaimed)
lease_expires_at — when the claim expires (ISO 8601 UTC)
created_at      — when the item was first registered
updated_at      — last time any field changed
```

### Stage History

Every time an item moves to a new stage, a row is appended to `stage_history`. This gives you a full audit trail:

```
id           — auto-increment
item_id      — references work_items.id
stage        — the stage name at this point in time
artifact_path — the path that was used at this stage
completed_at  — set when the item leaves this stage (null while active)
agent_id     — which agent was responsible (null if not recorded)
created_at   — when this history entry was created
```

This means you can reconstruct what happened to any item: when it entered each stage, what path it used, which agent processed it.

---

## Item Lifecycle (State Machine)

```
                    register()
                        │
                        ▼
                    [ pending ]
                        │
              claim() or manual query
                        │
                        ▼
                  [ in_progress ] ◄──── lease renewed
                        │
              advance() or setStatus()
                   ┌────┴────┐
                   ▼         ▼
              [ complete ] [ failed ]
```

Transitions:

- **`register`** → always creates at `pending`
- **`claim`** → atomically moves `pending` → `in_progress`, sets `claimed_by` and `lease_expires_at`
- **`advance`** → moves to next stage, resets to `pending` (new stage, new work to do)
- **`setStatus`** → manually override status to `complete` or `failed`

One important subtlety: **`advance` resets status to `pending`**. When an item moves from `backlog` to `researched`, the research agent hasn't started yet — so the item is pending again. Status tracks work done *within the current stage*, not progress through the overall workflow.

---

## The Claim / Lease Mechanism

Without `claim`, concurrent agents can race on the same item:

```
Agent A: query → sees "mobile-nav"
Agent B: query → sees "mobile-nav"       ← both pick the same item
Agent A: starts working ...
Agent B: starts working ...              ← duplicate work
```

`claim` solves this with a single atomic transaction:

```sql
BEGIN;
  SELECT the oldest pending item (or expired-lease item)
  UPDATE its status to in_progress, set claimed_by, set lease_expires_at
COMMIT;
```

Because `better-sqlite3` is synchronous and SQLite serializes writes, only one agent can complete this transaction at a time — the other will see no available item.

The lease handles agents that crash mid-work. If `lease_expires_at` passes without the item being advanced or completed, the next `claim` call can reclaim it. The comparison uses `datetime(lease_expires_at) < datetime('now')` rather than a raw string compare — ISO 8601 timestamps with the `T`/`Z` format sort differently than SQLite's `YYYY-MM-DD HH:MM:SS` format, so string comparison would give wrong results.

---

## Workflow Config Format

Workflow definitions live in YAML files in `~/.openclaw/workflows/` (or the `WORKFLOW_DIR` env var override). The config-loader reads these at runtime — they are never stored in SQLite.

This is an intentional design choice: configs are version-controlled YAML, not database records. You can review changes to stage definitions in git history, and adding a new stage doesn't require migrating any data.

Each stage has:

- **`name`** — the stage identifier agents use in tool calls
- **`path`** — where files for this stage live (can reference `{base_path}`)
- **`naming`** — a template for the filename (see [path templates](#path-templates) below)

Transitions define the default `advance` path (`from → to`). You can also skip stages by passing `to_stage` explicitly to `workflow_advance`.

### Path Templates

The `naming` field supports these substitutions:

| Variable | Value |
|---|---|
| `{date}` | `YYYY-MM-DD` (today's date) |
| `{datetime}` | `YYYY-MM-DD-HHmmss` |
| `{slug}` | item name, lowercased and hyphenated |
| `{name}` | item name, raw |
| `{stage}` | current stage name |
| `{workflow}` | workflow name |
| `{counter}` | zero-padded 4-digit counter |

---

## Why SQLite?

- **Single file, zero infra.** The DB lives at `~/.openclaw/workflow-directory/registry.db`. No server to run.
- **ACID transactions.** `claim` relies on atomic read-modify-write. SQLite in WAL mode handles concurrent readers well, and serializes writers.
- **Status lives in SQLite, not the filesystem.** Items don't move between folders to change stage. An item's `current_stage` is a database field — the file might live anywhere. This means you can query "all pending items in the research stage" in a single SQL statement rather than by scanning directories.

---

## Why Paths Come From the Registry, Not Agents

Agents are not allowed to construct artifact paths themselves. Every path is returned by a tool call.

This has two consequences:

1. **Refactoring is safe.** Change a `path` or `naming` template in the YAML and the next agent call gets the new path automatically. No prompt edits required.
2. **History is accurate.** The registry records the exact path used at each stage transition. If you change the naming template later, old history entries still reflect what was actually used.

---

## Config Search Order

When `loadWorkflowConfig("product-ideas")` is called, it searches for `product-ideas.yaml` (or `.yml`) in this order:

1. `WORKFLOW_DIR` env var (if set)
2. `<cwd>/workflows/`
3. `~/.openclaw/workflows/`

This is evaluated fresh on every call — not cached at module load. This matters for testing (where `WORKFLOW_DIR` is set in `beforeEach`) and for hot-reloading configs without restarting the process.

---

## Database Migration Strategy

The schema is created with `CREATE TABLE IF NOT EXISTS` on every startup, so the DB is initialized automatically on first use. For columns added after the initial release (`claimed_by`, `lease_expires_at`), the migration function runs `PRAGMA table_info` to check which columns exist and issues `ALTER TABLE ... ADD COLUMN` for any that are missing. This keeps existing databases working without a separate migration runner.
