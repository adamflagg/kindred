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

## Step 2: Anonymize each issue

Strip the following from the body:
- `**Reported by:**` line (name + email)
- `**Environment:**` block (browser UA, viewport, app version)
- Any organization/company-specific names — replace with `{org_name}` or similar placeholder
- Any real person names — replace with fictional equivalents
- Any real session IDs, school names, or other PII

## Step 3: Rewrite title

Convert `[Bug]`/`[Feature Request]` prefix to conventional commit style:
- `[Bug] Something broke` → `bug(scope): something broke`
- `[Feature Request] Add X` → `feat(scope): add X`

## Step 4: Present table for approval

Show all issues before creating anything:

| # (feedback) | New Title | Labels | PII Concerns |
|---|---|---|---|

## Step 5: Wait for approval

Do NOT create issues until the user confirms.

## Step 6: Create in target repo

For each approved issue, create in the target repo with appropriate labels and a `*Source: {repo}-feedback#{N}*` backlink in the body.

## Step 7: Close originals

Close each transferred issue in the feedback repo with a comment: `Transferred to {owner}/{repo}#{N}`
