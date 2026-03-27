# Workflow YAML Reference

Complete reference for writing workflow configuration files.

## File Location

Place YAML files in one of these directories (searched in order):

1. Path set in the `WORKFLOW_DIR` environment variable
2. `workflows/` inside your current working directory
3. `~/.openclaw/workflows/`

The filename (without extension) becomes the workflow name. A file named `product-ideas.yaml` defines the workflow `"product-ideas"`.

---

## Full Example

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

---

## Fields

### `workflow` (required)

The name of this workflow. Must match the filename (without `.yaml`). Used in every tool call to identify which workflow an item belongs to.

```yaml
workflow: product-ideas
```

### `base_path` (required)

Root directory for this workflow's artifacts. Used as the `{base_path}` variable in stage `path` templates. Can be absolute or relative (relative paths are resolved from the current working directory).

```yaml
base_path: /workspace/ideas
# or
base_path: ~/projects/ideas
```

### `stages` (required)

Ordered list of stages. At minimum one stage is required.

Each stage has:

#### `name` (required)

The stage identifier. Used in tool calls (`workflow_query`, `workflow_register`, `workflow_advance`). Keep it short and lowercase with hyphens.

```yaml
- name: backlog
- name: in-review
- name: published
```

#### `path` (required)

Directory where this stage's artifacts live. Can reference `{base_path}`.

```yaml
path: "{base_path}/backlog"
path: "/absolute/path/to/stage"
path: "{base_path}/archive/2026"
```

#### `naming` (required)

Filename template for artifacts at this stage. Supports the following variables:

| Variable | Example output | Description |
|---|---|---|
| `{date}` | `2026-03-26` | Today's date (YYYY-MM-DD) |
| `{datetime}` | `2026-03-26-143022` | Date + time (YYYY-MM-DD-HHmmss) |
| `{slug}` | `mobile-nav-redesign` | Item name, lowercased and hyphenated |
| `{name}` | `Mobile Nav Redesign` | Item name, raw (as passed to `workflow_register`) |
| `{stage}` | `backlog` | Current stage name |
| `{workflow}` | `product-ideas` | Workflow name |
| `{counter}` | `0042` | Zero-padded counter (passed by caller, defaults to `0000`) |

Examples:

```yaml
naming: "{date}-{slug}.md"                 # 2026-03-26-mobile-nav-redesign.md
naming: "{date}-{slug}-research.md"        # 2026-03-26-mobile-nav-redesign-research.md
naming: "{datetime}-{slug}.md"             # 2026-03-26-143022-mobile-nav-redesign.md
naming: "weekly-summary-{date}.md"         # weekly-summary-2026-03-26.md
naming: "{counter}-{slug}.md"              # 0000-mobile-nav-redesign.md
```

### `transitions` (optional)

Defines the default advancement path between stages. Used by `workflow_advance` when no `to_stage` is specified.

```yaml
transitions:
  - from: backlog
    to: researched
  - from: researched
    to: summarized
```

If a stage has no transition defined, calling `workflow_advance` without a `to_stage` will throw an error. You can still advance explicitly by passing `to_stage` in the tool call.

Transitions do not have to be linear — you can define branching or skipping:

```yaml
transitions:
  - from: inbox
    to: triage
  - from: triage
    to: researched
  # No transition from researched → allows only explicit to_stage advances
```

---

## Complete Example with Comments

```yaml
# The workflow name — must match the filename (product-pipeline.yaml → "product-pipeline")
workflow: product-pipeline

# Root directory. All stage paths can reference this with {base_path}
base_path: /Users/me/workspace/product

stages:
  # Stage 1: Raw ideas from Discord/Slack/wherever
  - name: inbox
    path: "{base_path}/inbox"
    naming: "{date}-{slug}.md"          # e.g. 2026-03-26-dark-mode.md

  # Stage 2: Ideas that have been triaged and are ready to research
  - name: backlog
    path: "{base_path}/backlog"
    naming: "{date}-{slug}.md"

  # Stage 3: Research output from the research agent
  - name: researched
    path: "{base_path}/researched"
    naming: "{date}-{slug}-research.md" # e.g. 2026-03-26-dark-mode-research.md

  # Stage 4: Final weekly summary (one file per run, not per item)
  - name: summarized
    path: "{base_path}/summaries"
    naming: "summary-{date}.md"

transitions:
  - from: inbox
    to: backlog
  - from: backlog
    to: researched
  - from: researched
    to: summarized
```

---

## Tips

**Stage order in the YAML doesn't affect transitions.** Only the `transitions` list determines what `workflow_advance` does by default. The stage order in the YAML is just for readability.

**Multiple workflows can share a `base_path`.** Each workflow's stages use subdirectories, so there's no conflict.

**Stages don't have to map 1:1 with filesystem directories.** You can have multiple stages point to the same directory with different naming templates if that makes sense for your workflow.

**The `naming` template is evaluated at the time an item is registered or advanced.** If you change the template later, existing items keep their original paths — only new registrations and advances use the new template.
