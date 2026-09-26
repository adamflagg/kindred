# Commit Type Selection

> Referenced from `CLAUDE.md` → Daily Workflow → Commit Conventions. The
> allowed types and scopes live in `commitlint.config.js`; this file is the
> procedure for choosing between them.

**The PR title is the commit that counts.** PRs are squash-merged, so the title
becomes the commit on `main` and branch commits are discarded. The required
`Validate PR title` check lints the title with `commitlint.config.js`, and
git-cliff reads it on `main` to group the changelog and choose the version bump.
The local commit-msg hook only checks branch commits, and skips silently when
`node_modules` is missing.

Choose the type by **what the PR does for the people using the deployed app**,
not by how much work it was. The release notes are for staff: a type that
overstates a change inflates Features, and one that understates it hides work.

## What a type does to a release

| Type | Changelog group | Bump |
|------|-----------------|------|
| `feat` | Features | minor |
| `improve` | Improvements | patch |
| `fix` | Bug Fixes | patch |
| `perf` | Performance | patch |
| `build` | Dependencies & Build | patch |
| `refactor` | Internal | patch |
| `revert` | Reverts | patch |
| `chore`, `ci`, `docs`, `test` | skipped | none |

Any type with a `security` scope lands in **Security** instead, bumping by its
type. A revert is the exception: every revert stays in Reverts. A release
window holding only skipped types has nothing to release, and the Release
workflow says so. `tests/unit/scripts/test_commit_type_config.py`
holds this table to `cliff.toml`.

**Never write `!` or a `BREAKING CHANGE:` footer.** Kindred has no external
consumer for a breaking change to break. `cliff.toml` strips both before
git-cliff reads them, and a major is only ever cut by hand:
`gh workflow run release.yml -f version=7.0.0`.

## The types

| Type | Test — answer yes |
|------|-------------------|
| `feat` | Can staff now do something they could not do on `main` just before this PR, and is this the first PR that lets them? |
| `improve` | Does something that already existed now work, read or look better — without having been wrong, and without staff gaining a new action? |
| `fix` | Was the deployed app producing a wrong result or an exposure that this corrects? |
| `perf` | Is the only observable change speed or resources, with identical output? |
| `refactor` | Would every staff screen, number, export, solver result and staff-read log line be identical? |
| `build` | Is every file a shipped dependency manifest or lockfile, a Docker file, or build/toolchain config? |
| `revert` | Does this undo a merged PR? |
| `ci` | Is every file CI or release machinery? |
| `chore` | Is every file agent or dev tooling, or a dev-only dependency bump? |
| `docs` | Is every file project documentation? |
| `test` | Is every file a test, fixture or test helper? |

**`feat`** is a new capability: a new page, panel, workflow, export, report,
integration, or matching/constraint axis — **or a new action on a page that
already exists** (a new control, filter, drilldown, chart, or editing ability).
Compare against `main` just before the PR, not all of history: restoring an
ability an earlier PR removed is a `feat`. Never dev tooling, infra or
dependencies.

**`improve`** makes an existing capability better and gives staff no new action:
copy and layout, defaults and sorting, extra columns, markers or labels on an
existing view, a new way to do something staff could already do, extending an
existing feature to another surface or population, solver tuning, deliberate
visible removals, added diagnostics.

Owner-ruled examples (2026-09-25): a filter added to the unplaced popout, a
drilldown modal on the retention overview, velocity trends with a prior-year
comparison, and dragging a map pin to set coordinates are all `feat`. The Assign
modal replacing the inline picker, a flag on the family card, and a sleeps-count
warning on the unit form are `improve`.

**`fix`** is for the deployed app only. A broken workflow, hook, test or dev
script is `ci`, `chore` or `test`, never `fix`.

## Decision order — use the first that matches

1. Undoes a merged PR → `revert`
2. Every file is CI or release machinery → `ci`
3. Every file is a shipped dependency manifest, Dockerfile or toolchain config → `build`
4. Every file is agent or dev tooling, or a dev-only dependency bump → `chore`
5. Every file is documentation → `docs`
6. Every file is a test → `test`
7. Staff can do something new → `feat`
8. The deployed app was wrong → `fix`
9. Same output, faster or lighter → `perf`
10. Something existing works or reads better → `improve`
11. Nothing anyone can reach changes → `refactor`

Step 1 is a fact about the PR, and steps 2–6 are decided by the file list.
Steps 7–11 are judgment. When one PR mixes them, split it where practical;
otherwise `feat` beats `fix`, and `fix` beats `improve`.

The `Validate PR title` check enforces the file-list steps it can decide: when
every changed file is CI machinery, agent tooling or tests, the title must be
`ci`, `chore` or `test` (`scripts/ci/check_title_type.py`). If a PR's files
genuinely mislead, add the `type-override` label.

## Features that land over several PRs

A feature gets exactly one `feat`: on **the first PR staff can use**. Earlier
phases that staff cannot reach yet are `refactor` (they land under Internal).
Later phases are `improve` or `fix`. Say where the PR sits in the body ("Part 2
of 3", "Stacked on #N"); a phase marker in the title is fine too, and
`cliff.toml` strips it from the release notes.

**A dark phase that adds an API endpoint, a PocketBase collection, or an API
rule says so** in a body line: `New surface: <what>`. It is still `refactor`,
because staff cannot use it yet, but `refactor` reads as "nothing changed", and
production has no auth in front of the API. PocketBase rules are the only guard,
so a reviewer needs to know there is something new to check.

## Scopes

Scope is required, except on `ci`. CI work never reaches the changelog, and
most of it has no surface to name. Use a scope when one fits (`ci(deps)`,
`ci(release)`, `ci(security)`), and plain `ci:` when none does. No scope repeats
a type name, so `fix(ci)`, `docs(docs)` and `chore(ci)` all fail the title check.

**Security is a scope, not a type.** Keep the type that says what changed and
add the scope: `fix(pb,security)`, `build(deps,security)`, `ci(security)`.

## Dependency bumps

Typed by what the bump changes, never `fix`, CVE bumps included (name the CVE in
the subject, and add the `security` scope). Always the `deps` scope.
`.github/dependabot.yml` and `renovate.json` are configured to match.

| Bump | Title |
|------|-------|
| Ships in an image (Python, Go, frontend runtime deps, Docker base images) | `build(deps)` |
| Dev or test tooling only | `chore(deps)` |
| GitHub Actions and CI tool pins | `ci(deps)` |

## Common mis-types to avoid

- Polish, an extra column, or a tweak to an existing view → `improve`, not `feat`
- An early phase staff cannot use yet → `refactor`, not `feat`
- Removing a visible feature or toggle → `improve`, not `refactor`
- Test-only additions or fixes → `test`, not `feat`/`fix`/`fix(tests)`
- CI speedup (sharding, caching a job) → `ci`, not `perf`; `perf` is for the deployed app
- Repairing a workflow, a hook or a dev script → `ci` or `chore`, not `fix`
- Formatting sweep → `chore`; a visible restyle → `improve` (`style` is retired)
- A PR title copied from its issue. Issues use `bug(`, `decide(` and `question(`
  prefixes, which are not commit types: pick the type from the diff.

**When unsure between two types**, pick the one whose *primary effect* on the
deployed app dominates the diff — e.g. an `improve` that also tidies the code
behind it is still `improve`. A restructuring that happens to fix one minor bug
is `fix`, not `refactor`: its output changed, and `fix` comes first in the
decision order.
