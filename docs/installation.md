# Installation Guide

## Current Status

The plugin is **not yet published to ClawHub**. ClawHub publishing is planned but not done.

The two available install paths right now are:

| Method | Best for |
|---|---|
| Local link (from this repo) | Development and testing on your own machine |
| Git install | Installing on another machine before ClawHub publishing |

---

## Option A: Local Install (Development)

Use this if you have the repo cloned locally and want to test changes immediately.

### 1. Build the plugin

```bash
cd openclaw-workflow-directory
pnpm install
pnpm build
```

This compiles TypeScript to `dist/`. OpenClaw loads from `dist/index.js`.

### 2. Link it into OpenClaw

```bash
pnpm link --global
openclaw plugins install --link openclaw-workflow-directory
```

`pnpm link --global` makes the package available system-wide under its package name. `openclaw plugins install --link` tells OpenClaw to use the linked version rather than downloading from a registry.

### 3. Verify it loaded

```bash
openclaw plugins list
```

You should see `openclaw-workflow-directory` in the output.

### 4. Keep it updated

When you make code changes:

```bash
pnpm build
```

No reinstall needed — the link points directly to `dist/`, so a rebuild is enough.

---

## Option B: Install from GitHub (No Local Clone)

If you want to install on a machine without cloning the repo:

```bash
openclaw plugins install github:sunnydayw/openclaw-workflow-directory
```

> This installs the current state of the `main` branch. Re-run to pick up updates.

---

## Option C: ClawHub Install (Coming Soon)

Once the plugin is published to ClawHub, installation will be:

```bash
openclaw plugins install openclaw-workflow-directory
```

**Steps to publish to ClawHub (when ready):**

1. Make sure `openclaw.plugin.json` is complete and accurate
2. Make sure `README.md` is up to date
3. Run `pnpm build` and verify `dist/` is clean
4. Publish: `openclaw plugins publish` (or via the ClawHub web UI)
5. Tag the release in git: `git tag v0.1.0 && git push --tags`

After publishing, the `openclaw plugins install` command will work for anyone.

---

## Post-Install Setup

Regardless of install method, you need a workflow YAML config before the plugin does anything useful.

### 1. Create the workflows directory

```bash
mkdir -p ~/.openclaw/workflows
```

### 2. Write your first workflow config

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
    path: "{base_path}/summaries"
    naming: "weekly-summary-{date}.md"

transitions:
  - from: backlog
    to: researched
  - from: researched
    to: summarized
```

Adjust `base_path` to wherever you want artifacts to live on your machine.

See [`workflow-yaml-reference.md`](./workflow-yaml-reference.md) for the full field reference.

### 3. Create the artifact directories

The plugin resolves paths but does not create directories. Create the stage directories before any agent tries to write to them:

```bash
mkdir -p /workspace/ideas/backlog
mkdir -p /workspace/ideas/researched
mkdir -p /workspace/ideas/summaries
```

### 4. Verify the plugin can find the config

In an OpenClaw session, call:

```
workflow_config({ workflow: "product-ideas" })
```

If it returns the stage list, everything is wired up correctly. If it returns `Workflow "product-ideas" not found`, check:

- The file is at `~/.openclaw/workflows/product-ideas.yaml` (name must match exactly)
- The `workflow:` field inside the YAML matches the filename

---

## Database Location

The SQLite registry is created automatically at:

```
~/.openclaw/workflow-directory/registry.db
```

You don't need to create this file — it's initialized on first use. To reset all state (wipe all registered items), delete this file.

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `WORKFLOW_DIR` | Override where YAML configs are loaded from | `~/.openclaw/workflows/` |

`WORKFLOW_DIR` is useful during testing to point at a temp directory with test configs, without touching your real workflows.

---

## Uninstall

```bash
openclaw plugins uninstall openclaw-workflow-directory
```

This removes the plugin from OpenClaw but leaves your workflow YAML configs and SQLite database intact. Delete `~/.openclaw/workflow-directory/` manually if you want to remove all state.
