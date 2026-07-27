# Consolidate Migrations — Templates

Commit, PR, and tracking-doc templates for Steps 9–11.

## Tracking-doc per-table entry (Step 9)

Update the backlog table first: change the status cell from `[ ]` to `[⏳]`.
Then append or update the per-table section:

```markdown
### <table> — [⏳] IN PROGRESS <date> (PR pending — set in Step 11)

**Rounds (compressed history):**
- <date> — round N — absorbed M files (#X, #Y, ...) into base #BBB — verified ✅ locally; pending PR merge

**Round N detail (kept for reference until next round compresses):**

<full detail block: absorbed migrations, trimmed multi-table files,
 final schema, surprises / cross-cutting findings>
```

Add cross-cutting findings if anything novel surfaced (e.g. a multi-table
migration was trimmed and the remainder is queued for another table's round).

**Why `[⏳]` not `[x]`:** the table can't be picked up by a parallel session while
the PR is open, but if the PR is closed without merging, Step 0a reverts the row
to `[ ]` and the table returns to the backlog. A premature `[x] DONE` would
silently strand it.

### Compressed-round one-liner (Step 0b)

```markdown
- YYYY-MM-DD — round N — absorbed M files (#X, #Y, ...) into base #BBB — verified ✅
```

## Commit (Step 11)

All git operations run from `$WORKTREE_DIR`.

```bash
cd "$WORKTREE_DIR"
git add pocketbase/pb_migrations/
git commit -m "$(cat <<'EOF'
refactor(pb): consolidate $TABLE migrations (round N, -M files)

<one-paragraph summary of what was absorbed/trimmed and the verified
final state — fields, indexes, rules. Mirrors the per-table tracking-doc
entry but written for the squash-merge commit log.>
EOF
)"
git push -u origin "$(git branch --show-current)"
```

Append the `Co-Authored-By:` trailer your harness instructions specify for the
current model — don't hardcode a model version here, it rots.

Never pipe `git push` through `tail`: pre-push hooks stream their output and
`tail` hides the errors that caused a failure.

## Pull request (Step 11)

```bash
gh pr create --title "refactor(pb): consolidate $TABLE migrations (round N, -M files)" --body "$(cat <<'EOF'
## Summary
- Collapses M modify-migrations into base #BBB (CREATE)
- <multi-table trim notes if any>
- Net delta: **-M files** in `pocketbase/pb_migrations/`
- Verified empirically by `scripts/dev/verify-consolidation.sh`: schemas match between proposed (1 file) and current (M+1 files)

Absorbed:
- `<file1>` — <one-line summary>
- `<file2>` — <one-line summary>
- ...

Final state of `$TABLE`: <field count>, <index count>, <rules summary>.

## Test plan
- [x] Local schema-diff harness passes (`schemas match`)
- [ ] CI green
- [ ] After merge, prod boot's OnServe `migrate history-sync` hook auto-cleans the orphan `_migrations` rows for the M absorbed files

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR number for Step 12 and the tracking-doc update:

```bash
PR_URL=$(gh pr create --title "..." --body "...")
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
```

Then replace the `(PR pending — set in Step 11)` placeholder from Step 9 with
`(PR #$PR_NUM awaiting merge)` in both the backlog row's Notes column and the
per-table section header. Step 0a of future invocations reconciles state from
this record via `gh pr view <PR#> --json state`.

If pre-push hooks fail, fix the underlying issue and retry — never `--no-verify`.
A commitlint warning about footer spacing is non-blocking; the commit succeeds.

## Step 10 summary table

| Field | Value |
|-------|-------|
| Table consolidated | T |
| Round number | N |
| Files absorbed | M (deleted) + K (trimmed multi-table) |
| Net migration count delta | -M (no new files) |
| Verification | ✅ schema match |
| PR title | `refactor(pb): consolidate $TABLE migrations (round N, -M files)` |
