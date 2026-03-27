---
name: workflow_directory
description: >
  Discover where to read and write workflow artifacts at runtime.
  Never hardcode file paths — always use the workflow directory tools.
---

# Workflow Directory

You have access to a **workflow directory** that manages artifact locations for
multi-stage workflows. Use it instead of hardcoding file paths.

## When to use

- You need to **find items to work on** → `workflow_query` (single agent) or `workflow_claim` (concurrent agents)
- You need to **create a new item** → `workflow_register`
- You're **done with an item** and need the next save location → `workflow_advance`
- You need to **know where a stage's files live** → `workflow_config`

## Typical agent flow (single agent)

1. Call `workflow_query` with your workflow name and stage to find pending items
2. Read the artifact at the `artifact_path` returned
3. Do your work
4. Call `workflow_advance` to get the output path for the next stage
5. Save your output to the `save_to` path returned

## Typical agent flow (concurrent agents)

Use `workflow_claim` instead of `workflow_query` when multiple agents may run simultaneously on the same stage. It atomically picks one item and locks it so no other agent picks the same one.

1. Call `workflow_claim` with your workflow name, stage, and a unique `agent_id`
2. If `claimed: false` is returned, there is nothing to do — exit
3. Read the artifact at the `artifact_path` returned
4. Do your work (complete before `lease_expires_at` or the item may be reclaimed)
5. Call `workflow_advance` to move the item and get the output path
6. Save your output to the `save_to` path returned

## Tools

### workflow_config

Get stage paths and naming rules. Call with no arguments to list all workflows.

```
workflow_config({ workflow: "product-ideas" })
→ { stages: [...], transitions: [...], base_path: "..." }
```

### workflow_query

Find items waiting for you. Always filter by `status: "pending"` to get
unprocessed items.

```
workflow_query({ workflow: "product-ideas", stage: "backlog", status: "pending" })
→ { items: [{ name: "...", artifact_path: "...", ... }] }
```

### workflow_register

Register a new item. Use a short descriptive name (it becomes part of the filename).

```
workflow_register({ workflow: "product-ideas", stage: "backlog", name: "mobile-nav-redesign" })
→ { artifact_path: "/workspace/ideas/backlog/2026-03-26-mobile-nav-redesign.md" }
```

Then save the artifact content to that path.

### workflow_advance

Move an item to the next stage. Returns the path where you should save output.

```
workflow_advance({ workflow: "product-ideas", item_name: "mobile-nav-redesign" })
→ { from_stage: "backlog", to_stage: "researched", save_to: "/workspace/ideas/researched/2026-03-26-mobile-nav-redesign-research.md" }
```

### workflow_claim

Atomically claim one pending item for exclusive processing. Use this when multiple agents work the same stage concurrently.

```
workflow_claim({ workflow: "product-ideas", stage: "backlog", agent_id: "research-agent-run-42" })
→ { claimed: true, item_name: "mobile-nav-redesign", artifact_path: "...", lease_expires_at: "..." }

workflow_claim({ workflow: "product-ideas", stage: "backlog", agent_id: "research-agent-run-43" })
→ { claimed: false, message: "No pending items available ..." }
```

The `lease_seconds` parameter controls how long the lock lasts (default 300 / 5 min). If you don't advance or complete the item before the lease expires, another agent can reclaim it.

## Rules

- **Never construct artifact paths yourself.** Always get them from the tools.
- **Always query or claim before acting.** Don't assume items exist — check first.
- **Use `workflow_claim` (not `workflow_query`) when agents run concurrently** to avoid duplicate work.
- **Use `workflow_config` when you first start** if you're unsure about stage names.
