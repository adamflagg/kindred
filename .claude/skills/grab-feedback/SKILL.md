---
name: grab-feedback
description: >
  Transfer open issues from a feedback repo to the main project repo, anonymizing
  PII and converting to conventional commit format. Triggers: "grab feedback",
  "check feedback", "pull feedback", or similar requests to transfer feedback issues.
---

# Grab Feedback — Feedback Issue Transfer

Transfers open issues from a `-feedback` companion repo to the main project repo.

## Convention

- **Source repo**: `{owner}/{repo}-feedback` (companion feedback repo)
- **Target repo**: `{owner}/{repo}` (current project repo)

Detect automatically:
```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
# e.g., "adamflagg/kindred" → source is "adamflagg/kindred-feedback"
```

## Step 1: Fetch open issues from feedback repo

```bash
gh issue list --repo {owner}/{repo}-feedback --state open --limit 50 --json number,title,body,labels --jq 'sort_by(.number)'
```

If none: report "No new feedback" and stop.

> **Order matters — oldest first.** `gh issue list` returns newest-first by
> default; the `sort_by(.number)` re-sorts the working set ascending (oldest
> feedback issue first, since GitHub issue numbers are monotonic with creation
> order). **Preserve this ascending order through every later step — classify,
> present, and especially create.** Creating newest-first inverts the mapping
> (e.g. feedback #45 → public #1608, feedback #46 → public #1607), which is
> confusing to reconcile. Oldest-first keeps public numbers increasing in
> lockstep with feedback numbers.

### Step 1a: Filter out already-mirrored issues

Open feedback issues may already have a public placeholder (placeholder-mode issues stay open by design). Skip any issue whose comments already contain a `Public placeholder created at` or `Transferred to` annotation — those are tracked, not new work.

```bash
for n in <numbers from step 1>; do
  mirrored=$(gh issue view "$n" --repo {owner}/{repo}-feedback --json comments \
    --jq '.comments[] | select(.body | test("Public placeholder created|Transferred to")) | .body' | head -1)
  if [ -n "$mirrored" ]; then
    echo "#$n already mirrored: $mirrored"
  fi
done
```

Drop mirrored issues from the working set before proceeding to Step 2.

### Step 1b: Close resolved mirrors (always run)

Already-mirrored OPEN feedback issues are placeholder-mode stubs kept open as the
source of truth until their public closes. **On every grab-feedback run, proactively
check each one** — don't wait for the user to ask. The mirror annotation from Step 1a
already contains the public issue number; extract it, check the public's state, and
if the public is `CLOSED`, run the mirror-close on the feedback original now.

```bash
# For each already-mirrored OPEN feedback issue from Step 1a:
pub=$(echo "$mirrored" | grep -oE '#[0-9]+' | head -1 | tr -d '#')
state=$(gh issue view "$pub" --repo {owner}/{repo} --json state --jq '.state')
if [ "$state" = "CLOSED" ]; then
  gh issue close "$n" --repo {owner}/{repo}-feedback \
    --comment "Auto-closed via {owner}/{repo}#${pub}"
fi
# else: public still OPEN → leave the feedback issue open, report it as pending.
```

In the final report, list each mirrored issue with its outcome: **closed** (public
resolved) or **still open** (public `#N` not yet closed). This way the user sees the
mirror set reconciled without having to ask.

## Step 2: Classify each issue

For each issue, decide which path it takes:

- **Clean transfer** — body has only generic PII (reporter line, env block). Anonymize and transfer normally; close original.
- **Placeholder mirror** — body has reproduction-critical PII (real names, real CampMinder IDs, real school/family identifiers) that anonymization would destroy. Create a PII-free placeholder in the main repo, **keep the private original open**, and rely on the mirror-close workflow to close it later.

Always offer the user the choice for borderline cases.

**The invariant: an open issue in the feedback repo means the public copy is lossy.** Nothing else. That is what makes `--state open` on the feedback repo a usable intake queue, and it is what Step 1b reconciles.

So don't "improve" this by leaving transfers open too. It's a tempting idea — keep everything open and linked so triage can always reach the private context — but it buys nothing and costs the signal. Closing a GitHub issue doesn't delete it, and the footer from Step 7 already makes the private original reachable, so the context is available either way. Leaving transfers open instead turns Step 1a into a filter over every issue ever transferred, gives Step 1b an unbounded sweep, and destroys the one bit of state the open/closed flag was carrying. There's a safety argument too: when every public issue routinely drags its private twin into an agent's context during triage, real names are in context constantly and only discipline keeps them out of a public body. Opt-in per issue is the safer default.

## Step 3: Anonymize each issue

Strip the following from the body:
- `**Reported by:**` line (name + email)
- `**Environment:**` block (browser UA, viewport, app version)
- Any organization/company-specific names — replace with `{org_name}` or similar placeholder
- Any real person names — replace with fictional equivalents (Emma Johnson set per CLAUDE.md)
- Any real session IDs, school names, or other PII

## Step 4: Rewrite title

Convert `[Bug]`/`[Feature Request]` prefix to conventional commit style:
- `[Bug] Something broke` → `bug(scope): something broke`
- `[Feature Request] Add X` → `feat(scope): add X`

## Step 5: Present table for approval

Show all issues before creating anything, **listed oldest-first (ascending feedback #)** so the approval order matches the creation order. Use the **Mode** column to call out which issues need placeholder treatment:

| # (feedback) | Mode | New Title | Labels | PII Concerns |
|---|---|---|---|---|

Modes: `transfer` (clean anonymize + close original) or `placeholder` (PII-free stub + keep original open for mirror-close).

## Step 6: Wait for approval

Do NOT create issues until the user confirms. For placeholder mode, also confirm the generic title doesn't itself leak context.

## Step 7: Create in target repo

**Create in ascending feedback-number order (oldest first), one at a time.**
Walk the approved working set from the lowest feedback `#N` to the highest so the
resulting public issue numbers stay monotonic with the feedback numbers. Do not
batch or parallelize creation — out-of-order creation re-inverts the mapping that
Step 1's sort fixed.

For each approved issue, create in the target repo with appropriate labels.

**Transfer mode** body footer — name what is behind the link, don't just leave a link:
```
*Reported via {repo}-feedback#{N} — the private original, which holds the reporter, the page it was filed from, and the app version.*
```
Add `, the screenshot` to that list when the feedback issue has one.

**Why the wording, and don't trim it back.** A bare `*Source: …*` line reads as provenance, so no later reader follows it. But the public issue is a strict *subset* of the private one: closing a GitHub issue doesn't delete it, and the private original keeps the reporter identity (who asked changes how a request is prioritised), the exact page URL, the app version that dates the report, and any screenshot that couldn't travel because the feedback repo is private. That context stays reachable forever — but only if the footer says it's there. The `triage-it` skill's step 4a depends on this line to know a twin exists and is worth pulling.

**Placeholder mode** body must:
- Describe the bug in generic terms only (no real names, IDs, schools, families)
- Include a "Note" pointing readers to the private feedback issue for reproduction details
- End with the mirror block below — ALWAYS include both the `Mirror:` line AND the agent-close instruction, exactly as shown:

```
---

**Mirror:** {repo}-feedback#{N} — the private original, which holds the reporter, the page it was filed from, the app version, the screenshot, and the detail withheld above.

**Note to agents closing this issue:** also close the private mirror with:
\`\`\`
gh issue close {N} --repo {owner}/{repo}-feedback --comment "Auto-closed via {owner}/{repo}#{PUBLIC_N}"
\`\`\`
```

Substitute `{N}` (private number), `{PUBLIC_N}` (public number after creation), `{owner}`, and `{repo}`. Drop `the screenshot,` from the `Mirror:` line if the feedback issue has none.

## Step 8: Close or annotate originals

- **Transfer mode:** close the feedback issue with comment `Transferred to {owner}/{repo}#{N}`.
- **Placeholder mode:** leave the feedback issue open. Add a comment: `Public placeholder created at {owner}/{repo}#{N} (no PII). This feedback issue stays open as the source of truth and will be closed when {repo}#{N} closes.`

## Mirror-close (manual, agent-driven)

Closing the private mirror has two triggers, and both should fire:

1. **At public-close time** — whichever agent closes the public issue (typically inside `handle-it` after a PR merges) closes the mirror too. The instruction is embedded in the public issue body in step 7 so any agent reading the issue will see and execute it.
2. **At grab-feedback time** — Step 1b sweeps every still-open mirror and closes any whose public has already closed. This catches mirrors missed by trigger 1 (e.g. the public was closed manually, or by an agent that didn't read the embedded note).

Trigger 2 is the safety net for trigger 1, so a forgotten close gets reconciled on the next `grab-feedback` run instead of lingering forever.

If you (the grab-feedback skill) are also the agent later closing the public issue, run the embedded `gh issue close` command against the `-feedback` repo as part of that close action. Both repos are owned by the same user; local `gh` auth has access to both.
