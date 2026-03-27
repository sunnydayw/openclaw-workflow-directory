# CLAUDE.md — Context for Claude Code

## What this is

An OpenClaw plugin that gives agents a **workflow directory** — a registry
they query at runtime to discover where to read/write artifacts, instead of
hardcoding paths in prompts.

## Architecture

- `src/index.ts` — Plugin entry point. Registers 4 tools with OpenClaw via `definePluginEntry` + `api.registerTool`.
- `src/registry.ts` — SQLite-backed work item tracker. Core operations: register, query, advance, setStatus.
- `src/config-loader.ts` — Loads workflow YAML configs from `~/.openclaw/workflows/` or `WORKFLOW_DIR`.
- `src/path-resolver.ts` — Resolves naming templates (`{date}-{slug}.md`) into concrete file paths.
- `skills/workflow-directory/SKILL.md` — Agent-facing instructions injected into system prompt.
- `workflows/` — Example YAML workflow configs.

## Key design decisions

- **Status lives in SQLite, not the filesystem.** Items don't move between folders to change status.
- **Paths are never constructed by agents.** Every path comes from the registry tools.
- **Workflow configs are YAML files**, not database records. Easy to version control and review.
- **Transitions are explicit.** The YAML defines `from → to` transitions so `advance` knows the next stage.

## Commands

```bash
pnpm install          # install deps
pnpm build            # compile TypeScript
pnpm test             # run vitest
pnpm test:watch       # run vitest in watch mode
```

## Testing

Tests use a temp directory with an in-memory workflow config and throwaway SQLite DB.
Set `WORKFLOW_DIR` env var to override where configs are loaded from.

## Plugin format

This is an OpenClaw plugin using `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry`.
Tools use TypeBox schemas for parameters. See https://docs.openclaw.ai/plugins/building-plugins.

## Things to work on next

- [ ] `workflow_claim` tool — atomic claim with lease/lock for concurrent agents
- [ ] File existence validation — warn if artifact_path doesn't actually exist on disk
- [ ] `workflow_create` tool — let agents define new workflows at runtime
- [ ] ClawHub publishing — package for community distribution
- [ ] Integration tests with actual OpenClaw agent loop
- [ ] Webhook/hook on stage transitions (notify downstream agents)
