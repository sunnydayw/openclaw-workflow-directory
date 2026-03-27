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

- You need to **find items to work on** → `workflow_query`
- You need to **create a new item** → `workflow_register`
- You're **done with an item** and need the next save location → `workflow_advance`
- You need to **know where a stage's files live** → `workflow_config`

## Typical agent flow

1. Call `workflow_query` with your workflow name and stage to find pending items
2. Read the artifact at the `artifact_path` returned
3. Do your work
4. Call `workflow_advance` to get the output path for the next stage
5. Save your output to the `save_to` path returned

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

## Rules

- **Never construct artifact paths yourself.** Always get them from the tools.
- **Always query before acting.** Don't assume items exist — check first.
- **Use `workflow_config` when you first start** if you're unsure about stage names.
