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
gh issue list --repo {owner}/{repo}-feedback --state open --limit 50 --json number,title,body,labels
```

If none: report "No new feedback" and stop.

## Step 2: Classify each issue

For each issue, decide which path it takes:

- **Clean transfer** — body has only generic PII (reporter line, env block). Anonymize and transfer normally; close original.
- **Placeholder mirror** — body has reproduction-critical PII (real names, real CampMinder IDs, real school/family identifiers) that anonymization would destroy. Create a PII-free placeholder in the main repo, **keep the private original open**, and rely on the mirror-close workflow to close it later.

Always offer the user the choice for borderline cases.

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

Show all issues before creating anything. Use the **Mode** column to call out which issues need placeholder treatment:

| # (feedback) | Mode | New Title | Labels | PII Concerns |
|---|---|---|---|---|

Modes: `transfer` (clean anonymize + close original) or `placeholder` (PII-free stub + keep original open for mirror-close).

## Step 6: Wait for approval

Do NOT create issues until the user confirms. For placeholder mode, also confirm the generic title doesn't itself leak context.

## Step 7: Create in target repo

For each approved issue, create in the target repo with appropriate labels.

**Transfer mode** body footer:
```
*Source: {repo}-feedback#{N}*
```

**Placeholder mode** body must:
- Describe the bug in generic terms only (no real names, IDs, schools, families)
- Include a "Note" pointing readers to the private feedback issue for reproduction details
- End with the mirror block below — ALWAYS include both the `Mirror:` line AND the agent-close instruction, exactly as shown:

```
---

**Mirror:** {repo}-feedback#{N}

**Note to agents closing this issue:** also close the private mirror with:
\`\`\`
gh issue close {N} --repo {owner}/{repo}-feedback --comment "Auto-closed via {owner}/{repo}#{PUBLIC_N}"
\`\`\`
```

Substitute `{N}` (private number), `{PUBLIC_N}` (public number after creation), `{owner}`, and `{repo}`.

## Step 8: Close or annotate originals

- **Transfer mode:** close the feedback issue with comment `Transferred to {owner}/{repo}#{N}`.
- **Placeholder mode:** leave the feedback issue open. Add a comment: `Public placeholder created at {owner}/{repo}#{N} (no PII). This feedback issue stays open as the source of truth and will be closed when {repo}#{N} closes.`

## Mirror-close (manual, agent-driven)

There is no workflow — closing the private mirror is the responsibility of whichever agent closes the public issue (typically inside `handle-it` after a PR merges). The instruction is embedded in the public issue body in step 7 so any agent reading the issue will see and execute it.

If you (the grab-feedback skill) are also the agent later closing the public issue, run the embedded `gh issue close` command against the `-feedback` repo as part of that close action. Both repos are owned by the same user; local `gh` auth has access to both.
