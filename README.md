# openclaw-workflow-directory

> A workflow directory plugin for [OpenClaw](https://docs.openclaw.ai/) that lets agents discover where to read and write artifacts — without hardcoding paths in prompts.

## The Problem

Today, every agent prompt contains hardcoded paths:

```
"Save tickets to /workspace/ideas/backlog/..."
"Look in /workspace/ideas/researched/ for items..."
```

Rename a folder and everything breaks. Add a new stage and you're editing twenty prompts.

## The Solution

Agents ask the **workflow directory** what to do:

```
Agent: "What's waiting for me in product-ideas at the backlog stage?"
Tool:  → [{ item: "cool-feature", path: "/workspace/ideas/backlog/2026-03-26-cool-feature.md" }]

Agent: "I'm done with this item, advance it to researched."
Tool:  → { save_to: "/workspace/ideas/researched/2026-03-26-cool-feature-research.md" }
```

No paths in prompts. One YAML config per workflow. Agents discover everything at runtime.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  OpenClaw Agent                                 │
│  (only knows: workflow name + its stage)        │
│                                                 │
│  Calls tools:                                   │
│    workflow_query     → "what's waiting for me?" │
│    workflow_register  → "I made a new item"      │
│    workflow_advance   → "move to next stage"     │
│    workflow_config    → "where do things live?"   │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │  Workflow Directory  │
        │  (this plugin)       │
        │                      │
        │  ┌────────────────┐  │
        │  │ SQLite tracker │  │
        │  └────────────────┘  │
        │  ┌────────────────┐  │
        │  │ YAML configs   │  │
        │  └────────────────┘  │
        └─────────────────────┘
```

## Quick Start

### 1. Install the plugin

```bash
openclaw plugins install openclaw-workflow-directory
```

### 2. Define a workflow

Create `~/.openclaw/workflows/product-ideas.yaml`:

```yaml
workflow: product-ideas
base_path: /workspace/ideas

stages:
  - name: backlog
    path: "{base_path}/backlog"
    naming: "{date}-{slug}.md"

  - name: researched
    path: "{base_path}/researched"
    naming: "{date}-{slug}-research.md"

  - name: summarized
    path: "{base_path}/summarized"
    naming: "weekly-summary-{date}.md"

transitions:
  - from: backlog
    to: researched
  - from: researched
    to: summarized
```

### 3. Use it from any agent

No path in the agent prompt — just reference the workflow:

```
You are the research agent for the "product-ideas" workflow.
Use the workflow_query tool to find pending items at the "backlog" stage.
Use the workflow_advance tool to move completed items to the next stage.
```

## Tools Provided

| Tool | Purpose | Key Parameters |
|---|---|---|
| `workflow_config` | Get stage paths and naming rules | `workflow` |
| `workflow_register` | Register a new work item | `workflow`, `stage`, `name`, optional `metadata` |
| `workflow_query` | Find items at a stage | `workflow`, `stage`, optional `status` filter |
| `workflow_advance` | Move item to next stage + get output path | `workflow`, `item_name`, optional `to_stage` |
| `workflow_claim` | Atomically claim one pending item for exclusive processing | `workflow`, `stage`, `agent_id`, optional `lease_seconds` |

## Development

```bash
git clone https://github.com/YOUR_USER/openclaw-workflow-directory.git
cd openclaw-workflow-directory
pnpm install
pnpm build
pnpm test
```

### Local dev with OpenClaw

```bash
# Link the plugin locally
cd openclaw-workflow-directory
pnpm link --global
openclaw plugins install --link openclaw-workflow-directory
```

## Project Structure

```
openclaw-workflow-directory/
├── src/
│   ├── index.ts              # Plugin entry point (registers tools)
│   ├── registry.ts           # SQLite-backed work item tracker
│   ├── config-loader.ts      # YAML workflow config parser
│   └── path-resolver.ts      # Naming template + path resolution
├── skills/
│   └── workflow-directory/
│       └── SKILL.md          # Teaches agents how to use the tools
├── workflows/
│   └── product-ideas.yaml    # Example workflow config
├── tests/
│   └── registry.test.ts      # Core logic tests
├── package.json
├── tsconfig.json
├── openclaw.plugin.json
└── README.md
```

## License

MIT
