# Git Workflow Reference

> Referenced from `CLAUDE.md`. The *rules* — always use a worktree, never push
> to main, branch protection, commit conventions — live in `CLAUDE.md`. This
> file is the mechanics: worktree internals, git hooks, dependabot, releases.

## Worktree Mechanics

> The *rule* — always use a worktree for feature work — is in `CLAUDE.md` →
> Critical Rules → Worktrees & Branches. This section is how worktrees work.

### Quick Start
```bash
# 1. Sync main first
git pull --rebase origin main

# 2. Create a worktree
./scripts/worktree/new.sh <descriptive-feature-name>

# 3. Move to the worktree
cd ../kindred-worktrees/<feature-name>

# 4. Start development
./scripts/start_dev.sh

# 5. Work, commit, push, create PR as normal

# 6. After PR merged, cleanup
./scripts/worktree/cleanup.sh <feature-name>
```

### How It Works
| Main Repo | Worktree |
|-----------|----------|
| `<repo>/` | `<repo>-worktrees/<feature>/` |
| Ports: 3000, 8000, 8080, 8090 | Ports: Vite 3110-3199, FastAPI 8210-8299, Caddy 8310-8399, PB 8410-8499 |
| Branch: main | Branch: feature/<feature> |
| Database: production data | Database: seeded from main |

### Port Assignment
Ports are deterministically derived from the feature name (cksum hash, mod 90,
offset 10..99). Each service sits in its own dedicated band, all bands disjoint
from main's ports — so no worktree port can ever equal a main-repo port, even
across services:

| Service    | Band       | Example (offset 42) |
|------------|------------|---------------------|
| Vite       | 3110-3199  | 3142                |
| FastAPI    | 8210-8299  | 8242                |
| Caddy      | 8310-8399  | 8342                |
| PocketBase | 8410-8499  | 8442                |

Same feature name always gets the same ports on first allocation. If the
hash-derived offset is already claimed by a sibling worktree (its `.env` is
scanned at allocation time), `new.sh` deterministically walks forward through
the 90 slots to the next free one and persists the chosen offset in the new
`.env`. A final `lsof` check catches non-worktree port holders (an unrelated
dev process, leftover services from a deleted worktree).

### What Gets Isolated
- `.venv/` - Python virtual environment
- `node_modules/` - Frontend dependencies
- `pocketbase/pb_data/` - Database (seeded from main)
- `.env` - Environment with port overrides
- Build artifacts and caches

### Cleanup
After `git pull`, the `post-merge` hook detects merged worktree branches and suggests cleanup commands.

```bash
# Clean up a specific worktree
./scripts/worktree/cleanup.sh <feature-name>

# Clean up ALL merged worktrees at once
./scripts/worktree/cleanup.sh --all-merged
```

## Git Hooks — Escape Hatches & Manual Runs

> The hook *stages* table (what runs when) is in `CLAUDE.md` → Daily Workflow →
> Git Hooks.

**Escape hatches:** `LEFTHOOK=0 git commit` or `git commit --no-verify`

**Run manually:**
```bash
lefthook run pre-commit    # Test formatters
lefthook run pre-push      # Test type checks + fast linters
```

## Dependabot PRs — Use `@dependabot recreate`, Not `rebase`

A GitHub Actions workflow in this repo edits dependabot PRs after open to extend
lockfiles (`uv.lock`, `frontend/package-lock.json`) so all three lockfile families
stay in sync. When GHA has modified a dependabot PR, `@dependabot rebase` can
force-push over those edits or leave the branch in an inconsistent state.

**Rule:** When interacting with a dependabot PR (asking it to update against main,
resolve lockfile conflicts, etc.), always comment `@dependabot recreate` — never
`@dependabot rebase`. Recreate closes the PR and opens a fresh one from current
main, which is safe regardless of prior GHA edits.

Exception: if you are manually pushing a lockfile fix to the dependabot branch
yourself (maintainer edit), skip the dependabot command entirely and push the
fix directly.

## Releases

### Version Tags
- Semantic versioning: `v0.1.0`, `v0.2.0`, `v1.0.0`
- Tags created by the Release workflow, not manually

### Release Workflow
Release via GitHub Actions: **Actions → Release → Run workflow**. Leave version empty for auto-bump (git-cliff), or enter a version to override. The workflow waits for CI and CD to pass, promotes the existing `sha-<commit>` Docker images to version tags (e.g., `3.2.0`, `3.2`), then creates the git tag and GitHub release.

Requires `RELEASE_TOKEN` repo secret (fine-grained PAT with `contents: write`).

### Creating a Release
1. Create feature branch: `git checkout -b fix/something`
2. Push and create PR: `gh pr create`
3. Wait for CI to pass
4. Merge via GitHub UI (squash merge)
5. GitHub → Actions → Release → Run workflow (auto-bump or enter version)
