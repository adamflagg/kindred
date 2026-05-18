# Issue Triage Maintenance Prompt

Copy-paste this into a new Claude Code conversation to refresh `docs/reference/issue-triage.md`.

---

```text
Read docs/reference/issue-triage.md to get the current grouping, then:

1. **Closed issue removal**: Run `gh issue list --state closed --limit 50` and cross-reference against every issue number in the triage doc. Remove any that are now closed. Note which groups lost issues.

2. **New issue discovery**: Run `gh issue list --state open --limit 100` and identify any issues NOT in the triage doc. For each new issue, read its title/labels and assign it to an existing group or propose a new group if 3+ related issues don't fit anywhere.

3. **Staleness check for next target group**: For the highest-priority group that hasn't been completed yet, read the actual current code referenced by each issue in that group. For each issue:
   - Does the problem described still exist in the code?
   - Has it been fixed by a recent PR without the issue being closed?
   - Has the surrounding code changed enough that the issue description is outdated?
   Report which issues are still valid, which are stale, and which need updated descriptions.

4. **Update the doc**: Apply all changes to docs/reference/issue-triage.md:
   - Remove closed issues
   - Add new issues to appropriate groups
   - Update the "Last updated" date and issue count
   - Move any fully-completed groups to the "Completed Groups" table
   - Update the attack order if priorities shifted

5. **Present a summary table**:

| Action | Details |
|--------|---------|
| Removed (closed) | #N, #N, ... |
| Added (new) | #N → Group X, #N → Group Y, ... |
| Stale (needs closing) | #N — reason |
| Still valid | Group Z: all N issues confirmed |

Then ask which group to attack next.
```
