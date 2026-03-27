# Test Plan: OpenClaw Integration Testing

This covers manual testing of all five tools in a live OpenClaw environment.
Unit tests (vitest) cover the registry logic — this plan covers the full stack:
plugin loaded, YAML config present, tools called from an actual agent session.

---

## Prerequisites

Before starting:

- [ ] Plugin installed (`openclaw plugins list` shows `openclaw-workflow-directory`)
- [ ] Test workflow YAML written and placed in `~/.openclaw/workflows/`
- [ ] Artifact directories created on disk
- [ ] No stale registry state (`~/.openclaw/workflow-directory/registry.db` either fresh or wiped)

### Test workflow config

Create `~/.openclaw/workflows/test-workflow.yaml` for these tests:

```yaml
workflow: test-workflow
base_path: /tmp/openclaw-test

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
```

Create directories:

```bash
mkdir -p /tmp/openclaw-test/inbox
mkdir -p /tmp/openclaw-test/processed
mkdir -p /tmp/openclaw-test/archived
```

---

## Test 1: `workflow_config` — list all workflows

**Call:**
```
workflow_config({})
```

**Expected:**
- Returns a list under `"workflows"` that includes `"test-workflow"`
- No error

**Failure signals:**
- Empty list → YAML not found (check `~/.openclaw/workflows/` path)
- Error → plugin not loaded

---

## Test 2: `workflow_config` — get a specific workflow

**Call:**
```
workflow_config({ workflow: "test-workflow" })
```

**Expected:**
- Returns `stages` array with three entries: `inbox`, `processed`, `archived`
- Each stage has `name`, `path`, `naming`
- `base_path` in the paths is resolved to `/tmp/openclaw-test` (not the `{base_path}` literal)
- `transitions` shows `inbox → processed → archived`

**Failure signals:**
- `Workflow "test-workflow" not found` → YAML filename or `workflow:` field mismatch

---

## Test 3: `workflow_register` — register a new item

**Call:**
```
workflow_register({
  workflow: "test-workflow",
  stage: "inbox",
  name: "my-first-idea"
})
```

**Expected:**
- `registered: true`
- `artifact_path` contains `/tmp/openclaw-test/inbox/`
- `artifact_path` ends in `.md`
- `artifact_path` contains `my-first-idea` (slugified)
- No file is created on disk (the plugin only tracks paths, it doesn't write files)

**Failure signals:**
- Stage not found error → stage name typo or YAML not loaded

---

## Test 4: `workflow_query` — find the registered item

**Call:**
```
workflow_query({ workflow: "test-workflow", stage: "inbox" })
```

**Expected:**
- `count: 1`
- Item has `name: "my-first-idea"`, `stage: "inbox"`, `status: "pending"`
- `artifact_path` matches what was returned by `workflow_register`

**Then filter by status:**
```
workflow_query({ workflow: "test-workflow", stage: "inbox", status: "pending" })
```

**Expected:** Same result — item is pending.

```
workflow_query({ workflow: "test-workflow", stage: "inbox", status: "complete" })
```

**Expected:** `items: []` — nothing complete yet.

---

## Test 5: `workflow_advance` — move to next stage

**Call:**
```
workflow_advance({ workflow: "test-workflow", item_name: "my-first-idea" })
```

**Expected:**
- `advanced: true`
- `from_stage: "inbox"`, `to_stage: "processed"`
- `save_to` contains `/tmp/openclaw-test/processed/` and ends in `-done.md`
- Message tells you where to save output

**Verify the item moved:**
```
workflow_query({ workflow: "test-workflow", stage: "inbox" })
```
→ `items: []` (no longer in inbox)

```
workflow_query({ workflow: "test-workflow", stage: "processed" })
```
→ `count: 1`, item is back to `status: "pending"` at the new stage

---

## Test 6: `workflow_advance` — skip to a specific stage

Register a second item:
```
workflow_register({ workflow: "test-workflow", stage: "inbox", name: "skip-ahead-idea" })
```

Then jump directly to archived:
```
workflow_advance({
  workflow: "test-workflow",
  item_name: "skip-ahead-idea",
  to_stage: "archived"
})
```

**Expected:**
- `from_stage: "inbox"`, `to_stage: "archived"` (skipped `processed`)
- `save_to` path is inside `/tmp/openclaw-test/archived/`
- `save_to` ends in `-final.md` (the `archived` stage naming template)

---

## Test 7: `workflow_claim` — basic claim

Register a fresh item:
```
workflow_register({ workflow: "test-workflow", stage: "inbox", name: "claim-test" })
```

Then claim it:
```
workflow_claim({
  workflow: "test-workflow",
  stage: "inbox",
  agent_id: "test-agent-001"
})
```

**Expected:**
- `claimed: true`
- `item_name: "claim-test"`
- `artifact_path` is the inbox path for this item
- `lease_expires_at` is a future timestamp (roughly 5 minutes from now)

**Verify status changed:**
```
workflow_query({ workflow: "test-workflow", stage: "inbox", status: "pending" })
```
→ item is gone from pending (it's now `in_progress`)

```
workflow_query({ workflow: "test-workflow", stage: "inbox", status: "in_progress" })
```
→ item appears with `status: "in_progress"`

---

## Test 8: `workflow_claim` — nothing available returns false

With no pending items in inbox (all claimed or empty):
```
workflow_claim({
  workflow: "test-workflow",
  stage: "inbox",
  agent_id: "test-agent-002"
})
```

**Expected:**
- `claimed: false`
- Message says no pending items available
- No error thrown

---

## Test 9: `workflow_claim` — concurrent claim simulation

Register two items:
```
workflow_register({ workflow: "test-workflow", stage: "inbox", name: "concurrent-a" })
workflow_register({ workflow: "test-workflow", stage: "inbox", name: "concurrent-b" })
```

Claim twice in sequence (simulating two agents):
```
workflow_claim({ workflow: "test-workflow", stage: "inbox", agent_id: "agent-A" })
workflow_claim({ workflow: "test-workflow", stage: "inbox", agent_id: "agent-B" })
```

**Expected:**
- First claim: `claimed: true`, gets `concurrent-a` (oldest)
- Second claim: `claimed: true`, gets `concurrent-b`
- A third claim: `claimed: false` (both taken)
- The two `claimed_by` values are `"agent-A"` and `"agent-B"` respectively

---

## Test 10: End-to-end flow

A complete run through the full lifecycle:

1. `workflow_register` → create item at `inbox`
2. `workflow_claim` → lock it
3. Write a file to the returned `artifact_path` (create it on disk)
4. `workflow_advance` → move to `processed`, get `save_to`
5. Write output to `save_to`
6. `workflow_advance` again → move to `archived`, get final `save_to`
7. Write final output to `save_to`
8. `workflow_query` on all three stages → inbox and processed are empty, archived has the item

**Expected at step 8:**
- `inbox`: 0 items
- `processed`: 0 items
- `archived`: 1 item, `status: "pending"` (nothing has completed the archived stage yet)

---

## Error Cases to Verify

These should all return clear error messages, not crash the agent:

| Call | Expected error |
|---|---|
| `workflow_config({ workflow: "does-not-exist" })` | "not found" error |
| `workflow_register({ workflow: "test-workflow", stage: "bad-stage", name: "x" })` | stage not found error |
| `workflow_advance({ workflow: "test-workflow", item_name: "no-such-item" })` | item not found error |
| `workflow_advance({ workflow: "test-workflow", item_name: "my-item", to_stage: "bad-stage" })` | stage not found error |
| `workflow_claim({ workflow: "test-workflow", stage: "bad-stage", agent_id: "x" })` | returns `claimed: false` (not an error — just no items) |

---

## Cleanup

After testing:

```bash
# Remove test artifacts
rm -rf /tmp/openclaw-test

# Reset the registry (wipes all registered items)
rm ~/.openclaw/workflow-directory/registry.db

# Remove test workflow config
rm ~/.openclaw/workflows/test-workflow.yaml
```

---

## What's Not Covered Here

These require more complex setup and are out of scope for initial manual testing:

- **Lease expiry reclaim** — requires waiting or manually backdating the DB
- **True concurrent agents** — requires two agent processes running simultaneously
- **File existence validation** — not implemented yet (items track paths, not whether files exist)
- **Webhook/hook on stage transitions** — not implemented yet
