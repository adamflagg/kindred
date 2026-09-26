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

Pick the most specific type before defaulting to `feat`/`fix`. The release
changelog groups by type, so mis-typing hides work.

## What a type does to a release

| Type | Changelog group | Bump |
|------|-----------------|------|
| `feat` | Features | minor |
| `fix` | Bug Fixes | patch |
| `perf` | Performance | patch |
| `refactor` | Refactoring | patch |
| `build` | Build | patch |
| `docs` | Documentation | patch |
| `style` | Styling | patch |
| `test` | Testing | patch |
| `revert` | Reverts | patch |
| `chore`, `ci` | skipped | none |

A release window holding only `chore` and `ci` has nothing to release, and the
Release workflow says so.

**Never write `!` or a `BREAKING CHANGE:` footer.** Kindred has no external
consumer for a breaking change to break. `cliff.toml` strips both before
git-cliff reads them, and a major is only ever cut by hand:
`gh workflow run release.yml -f version=7.0.0`.

**Scope is required, except on `ci`.** CI work never reaches the changelog, and
most of it has no surface to name. Use a scope when one fits (`ci(deps)`,
`ci(release)`, `ci(security)`), and plain `ci:` when none does. No scope repeats a
type name, so `fix(ci)`, `docs(docs)` and `chore(ci)` all fail the title check.

## Decision order — use the first that matches

1. Diff touches only `.github/workflows/`, `scripts/ci/` or release tooling → `ci`
2. Diff touches only `docs/` or top-level markdown → `docs` (scope = the area
   documented; `harness` for agent guidance)
3. Diff touches only `tests/` or `*_test.*` / `*.test.*` files → `test`
4. Diff touches only Dockerfiles, `docker-compose.*`, `pyproject.toml` build
   config, or dependency manifests and lockfiles for something that ships in an
   image → `build`
5. Diff touches only formatting (prettier, ruff format, whitespace) → `style`
6. Measurable performance improvement of the deployed app with no behavior
   change → `perf`
7. Code restructure with no behavior change (extract helper, rename, move) → `refactor`
8. Fixes a bug that was previously broken → `fix`
9. Adds new user-visible functionality or endpoint → `feat`
10. Reverts a prior commit → `revert`
11. Agent tooling (`.claude/`, `CLAUDE.md`, skills, `.lefthook.yml`), dev-only
    dependency bumps, and other maintenance with no user impact → `chore`

## Dependency bumps

Typed by what the bump changes, never `fix`, CVE bumps included (name the CVE in
the subject). Always the `deps` scope. `.github/dependabot.yml` and
`renovate.json` are configured to match.

| Bump | Title |
|------|-------|
| Ships in an image (Python, Go, frontend runtime deps, Docker base images) | `build(deps)` |
| Dev or test tooling only | `chore(deps)` |
| GitHub Actions and CI tool pins | `ci(deps)` |

## Common mis-types to avoid

- Refactor that moves code but doesn't add features → `refactor`, not `feat`
- Test-only additions or fixes → `test`, not `feat`/`fix`/`fix(tests)`
- Perf improvement (caching, memoization, algorithm change) → `perf`, not `refactor`
- CI speedup (sharding, caching a job) → `ci`, not `perf`; `perf` is for the deployed app
- Repairing a workflow, a hook or a dev script → `ci` or `chore`, not `fix`; `fix`
  is for the deployed app
- Dockerfile change → `build`, not `ci`
- GitHub Actions change → `ci`, not `build`
- A PR title copied from its issue. Issues use `bug(`, `decide(` and `question(`
  prefixes, which are not commit types: pick the type from the diff.

Phase markers such as `(Phase 2 of 3)` are fine in a title. The PR's reviewer
and scan-it use them, and `cliff.toml` strips them from the release notes.

**When unsure between two types**, pick the one whose *primary effect* dominates
the diff — e.g. a refactor that happens to fix one minor bug is still
`refactor` if restructuring is the point.
