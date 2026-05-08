---
name: solver-config-it
description: >
  Resume the solver/admin config cleanup. Walk one constraint domain at a time
  across all four surfaces (CONFIG_SCHEMA, seed migration, GUI, code reads),
  propose KEEP/HARDCODE/DELETE/FIX decisions, hold for user gut-check before
  any Phase 2 PR. Triggers: "solver config it", "config-it", "config decisions",
  "next config domain", or similar requests to advance the cleanup.
---

# Solver Config It — Phase 1.5 Domain Walks

Advances the multi-phase solver/admin config cleanup. The decisions doc is the source of truth across conversations; this skill is the repeatable workflow.

## Convention

The decisions doc lives in the project's **main repo**, never in worktrees. Always resolve the absolute path before reading or writing:

```bash
MAIN_REPO=$(dirname "$(git rev-parse --git-common-dir)")
DECISIONS_DOC="$MAIN_REPO/docs/reference/solver-config-decisions.md"
```

`git rev-parse --git-common-dir` returns the canonical `.git` directory regardless of whether you're invoked from a worktree or the main repo. Use `$DECISIONS_DOC` for **all** Read and Write calls — never a worktree-relative path. Worktree copies, if any exist, are stale snapshots; edits there are lost on cleanup.

Companion to `docs/reference/issue-triage.md` (resolved the same way). Both are reference-tier working docs that survive across conversations.

If `$DECISIONS_DOC` doesn't exist, do NOT create it. Tell the user: this skill is for resuming an in-flight cleanup; the doc should already exist with prior context. Stop.

## Step 1: Read state, top to bottom

Read the entire `docs/reference/solver-config-decisions.md`. The "For fresh agents" header at the top has the orientation. Then read the spec/plan it points at:

- Spec: `docs/superpowers/specs/2026-05-07-solver-config-cleanup-design.md`
- Plan: `docs/superpowers/plans/2026-05-07-solver-config-cleanup.md`

Note which domain checkboxes are `[ ]`, which are `✅`. Find any "Status: in progress" markers on individual domain sections.

## Step 2: Pick the domain

Backlog states:
- `[ ]` — not yet walked.
- `[⏳]` — surface walk done, decisions proposed, awaiting user green-light. Resume.
- `[⏸]` — **TABLED.** Surface walk may be done, but user has explicitly deferred until upstream PRs ship or some other condition. **Skip.** Don't re-walk, don't re-prompt for green-light. The user picks the unblock moment, not you.
- `[x]` / `✅` — decisions locked in (or PR shipped). Don't reopen.

Default order:
1. If user named a domain, use that — even if tabled. ("Take another look at Grade Ratio" is an explicit unblock.)
2. Else if any domain is `[⏳]` (decisions proposed, no green-light), resume that one — re-state the proposed decisions and hold for the user.
3. Else pick the first `[ ]` from the backlog, **skipping any `[⏸]` entries**. If you skipped tabled domains to reach the chosen one, mention this in your opening line so the user knows you saw them and respected the deferral.

When the user tables a domain (e.g., "let's circle back after the other PRs ship"), update the doc:
- Backlog line: change marker to `[⏸]`, append a brief "TABLED — revisit when [condition]" note explaining what unblocks it.
- Domain section: change `**Status:**` to `⏸ **TABLED [date].** [reason]. Skip when picking the next domain.`
- Preserve the surface walk and decision leans intact — the work isn't wrong, just deferred.

## Step 3: Walk all four surfaces for the chosen domain

For the chosen domain, lay out:

1. **CONFIG_SCHEMA** entries in `bunking/config/schema.py` — keys, types, ranges, required flags.
2. **Seed migration** entries — every key seeded in `pocketbase/pb_migrations/1500000011_config.js` (the main migration) plus any later fixup migrations that touch this domain. Capture seeded values, FRIENDLY_NAMES, TOOLTIPS, SECTION_MAPPING bucket.
3. **GUI** — section header in `1500000012_config_sections.js`, which `/admin/config/*` page renders it, any frontend live reads via `useSolverConfigValue` or direct `pb.collection('config')` reads.
4. **Code paths (Python)** — every `get_int`/`get_float`/`get_bool`/`get_str`/`get_constraint`/`get_soft_constraint_weight` consumer in `bunking/` and `api/`. Note `default=` kwarg drift, phantom keys not in schema, dead-row queries that look up nonexistent rows.

Use the existing **Cabin Capacity** section in the decisions doc as the depth template — that's the canonical surface breakdown shape.

## Step 4: Propose per-key decisions

For every key in the domain, propose one of:

- **KEEP** — stays in admin GUI as a tunable knob; user actually tunes it at runtime.
- **HARDCODE** — move to a constants module; user can change via code PR.
- **DELETE** — orphan; no consumer; remove from schema/seed/GUI entirely.
- **FIX** — has a real bug (phantom key, wrong default, wrong query) that needs a code change before keep/hardcode/delete can apply.

User strongly prefers HARDCODE over KEEP for anything they don't actually tune at runtime. Defer to the user when in doubt — they're the sole admin-config user and know which knobs they touch.

If multiple keys interact (e.g., a `mode` flag that gates a code path consuming a `penalty` key), propose decisions as a coherent group, not key-by-key.

## Step 5: Capture in the doc

Update the domain's section in `docs/reference/solver-config-decisions.md`:

- Surface breakdown (1 through 4).
- Per-key decisions with rationale.
- Required FIXes that must precede the keep/hardcode/delete actions.
- Open questions for the user.
- "Status: decisions proposed, awaiting user green-light before Phase 2 PR" until user approves.

Also update the "Cross-cutting findings" section if the domain surfaced anything that applies to other domains (e.g., another phantom key, another dead-row query, another section-drift case).

## Step 6: Hold for feedback

The full surface walk lives in the doc. **Do not paste it into chat.** The user has the doc open if they want depth. Chat is for the gut-check: name the domain, frame the asks, surface what's surprising, list the open questions. Nothing more.

Structure the chat presentation in this order:

1. **Domain header** — one line: which domain you walked, where it lives in the doc (`### <Domain> in solver-config-decisions.md`). The user can't tell from your tool calls; they need to know which slice you analyzed.
2. **One-sentence framing per key** — what each key actually controls in the system, in plain English. The user is the sole admin-config user but won't remember every knob's runtime role from a key name. One short clause is enough — "max % of cabin from one grade", "bonus weight for matching target grade per bunk", etc.
3. **Tuning evidence summary** — one line per key on whether it's been touched (logs, git, GUI). "No tuning evidence" or "fired 3/6 May 2026 runs at seeded value" or "confirmed orphan, zero consumers". This is what drives HARDCODE vs KEEP.
4. **In reality today** — 2-4 bullets translating each surface into staff-visible behavior at current values. Solver: what does the cost path actually push toward, and how does this domain's penalty/bonus weight stack against the others (must_satisfy_one=100k is the reference)? Validator/board: do `_validate_*` methods emit user-visible ValidationIssue WARNINGs, and does that path read these keys or run independently? Frontend: any live reads, or display-only? What's already dead — phantom-controlled bonus paths, stub functions, soft paths gated off by a flipped toggle? This is the lens that turns "is value X tuned?" into "would changing X be visible to anyone?", which is what makes HARDCODE-vs-KEEP an actionable call rather than a static-analysis exercise. Skip bullets that are obvious or shared with another domain you've already presented.
5. **Surprises and gotchas** — anything that broke your assumptions or might break the user's. Phantom keys, parallel hardcodes, orphan-from-initial-commit findings, B-class drift surfaces, conceptually-different validator algorithms. Two to four bullets max.
6. **Decision table** — keys × leaning decision × one-clause rationale. Mark leans clearly (HARDCODE *(open)*) when the call is genuinely the user's.

   | Key | Lean | Rationale |
   |---|---|---|

7. **Open questions** — numbered, each with enough framing that the user can answer without re-reading anything. Two phrasings to avoid: "thoughts?" (too open) and "should I X or Y?" with no context (too closed). The right shape: "X is the seeded behavior; Y would require Z. Pattern-match says X, but you might want Y because [edge case]. Your call."

Length budget: the whole presentation should fit on one screen. If you're past 40 lines, you're dumping the doc. Cut.

**Do NOT start implementing the Phase 2 PR.** Wait for the user to:
- Answer open questions.
- Green-light the per-key decisions (or amend them).
- Tell you to proceed with implementation.

After green-light, mark the domain `✅` in the backlog with a brief note on what shipped, and stop. The user picks the next domain.

## Hard rules

- **One domain at a time.** Don't conflate. Don't propose Phase 2 PRs that span multiple domains unless the user explicitly asks.
- **Don't run ahead.** No PR drafting before user green-light. No "while I'm at it" cleanups in adjacent domains.
- **Don't propose Phase 3 (storage split) work.** Out of scope.
- **Don't reopen Phase 1 (PRs #1212-#1215) decisions.** Those shipped; reference them, don't relitigate.
- **Workstream 5 (manifest pattern) stays deferred** until after Phase 2 — sections will collapse during the hardcoding sweep.
- **Workstream 6 (runtime metadata backfill)** is a small standalone PR available anytime; user has held it for now. Don't ship without explicit ask.
