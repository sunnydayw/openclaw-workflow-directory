# Bugs & Known Issues

## Fixed: ISO timestamp vs SQLite datetime string comparison

**Status:** Fixed in commit `80dc85f`
**Affected:** `registry.ts` — the `claim()` lease expiry check

### What went wrong

The `claim()` method stores `lease_expires_at` as a JavaScript ISO 8601 timestamp:

```typescript
new Date(Date.now() + leaseSecs * 1000).toISOString()
// produces: "2026-03-26T23:59:21.000Z"
```

The SQL query that checks for expired leases originally compared this directly against SQLite's `CURRENT_TIMESTAMP`:

```sql
AND lease_expires_at < CURRENT_TIMESTAMP
```

SQLite's `CURRENT_TIMESTAMP` returns a string in this format:

```
2026-03-26 23:59:21
```

Note the difference:
- Stored value: `2026-03-26T23:59:21.000Z`  (uses `T` separator, ends with `Z`)
- CURRENT_TIMESTAMP: `2026-03-26 23:59:21`  (uses space separator, no Z)

SQLite compared these as plain strings. In ASCII, `T` (code 84) is greater than ` ` (space, code 32). This means the ISO timestamp always compared as *greater* than the SQLite timestamp at the same moment in time — so `lease_expires_at < CURRENT_TIMESTAMP` was always `false`, even for a lease set to expire immediately.

**Consequence:** Expired leases were never reclaimed. An agent that crashed or timed out would leave its item permanently stuck in `in_progress`, unavailable to any other agent.

### How it was fixed

Wrap both sides in SQLite's `datetime()` function, which parses ISO 8601 strings into a normalized format before comparing:

```sql
AND datetime(lease_expires_at) < datetime('now')
```

`datetime()` understands both ISO 8601 (`T`/`Z` format) and SQLite's native format, normalizes them to the same representation, and then compares correctly.

### How it was caught

A test that backdated a lease to `'2000-01-01T00:00:00.000Z'` and expected a second claim to succeed was failing — the second `claim()` returned `null` instead of reclaiming the expired item. This revealed that the expiry check was silently broken for any ISO-formatted timestamp.

---

## Known: FIFO ordering uses `updated_at` instead of `created_at`

**Status:** Open
**Affected:** `registry.ts` — the `claim()` candidate selection query

### What the problem is

`claim()` picks the "oldest" item using:

```sql
ORDER BY updated_at ASC
```

The intent is FIFO — process the item that has been waiting longest. But `updated_at` is reset on every status change. An item that gets reclaimed (because its lease expired) has a newer `updated_at` than a genuinely older item that was never touched. This means reclaimed items jump to the back of the queue, which is the opposite of what you'd want.

### What the correct fix is

Sort by `created_at ASC` instead:

```sql
ORDER BY created_at ASC
```

`created_at` is set once on insert and never changes, so it correctly reflects when the item entered the system.

### Why it hasn't been fixed yet

The fix is one word but the correct test requires two items with distinct `created_at` values. SQLite's `CURRENT_TIMESTAMP` has 1-second precision, so two items registered in rapid succession can have the same `created_at`, making the ordering test non-deterministic. The test needs to either insert with an explicit `created_at` offset or use a nanosecond clock.
