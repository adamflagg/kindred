# Go Verification Checklist

All commands run from the `pocketbase/` directory.

## 1. Format

```bash
cd pocketbase && gofmt -w .
```

Auto-fixes formatting in place. Unlike Python, Go formatting is canonical and non-configurable.

## 2. Build

```bash
cd pocketbase && go build .
```

Must pass before any other checks. If this fails, nothing else matters.

Common build failures:
- **Unused imports**: Remove them (Go treats these as errors, not warnings)
- **Unused variables**: Remove or use them
- **Missing dependencies**: Run `go mod tidy`

## 3. Lint

```bash
cd pocketbase && golangci-lint run --config ../.golangci.yml
```

The config file is at the repo root (`.golangci.yml`), not in the pocketbase directory. The `--config` flag is required.

**This step is the reason the checklist exists.** `.lefthook.yml` moved `golangci-lint` to
CI-only, so the pre-push hook builds Go but never lints it — a clean push is not evidence of a
clean lint, and the failure surfaces in CI minutes later. Running it here is what closes that gap.

Common lint issues:
- **errcheck**: Unhandled error returns. Wrap with `if err != nil { ... }`
- **govet**: Suspicious constructs (printf arg mismatches, struct tag issues)
- **staticcheck**: Bug-prone patterns
- **misspell**: Note that "cancelled" is allowed (British spelling, configured in `.golangci.yml` extra-words)

## 4. Tests

```bash
cd pocketbase && go test -race ./... -v
```

The `-race` flag enables the race detector. This catches data races in concurrent code. Do not skip it.

## Common Gotchas

- **`go mod tidy`**: If you add or remove imports, run `go mod tidy` to update `go.mod` and `go.sum`. Failing to do so will break the build in CI.
- **"cancelled" spelling**: The project uses British spelling consistently. The golangci-lint config allows it. Do not "fix" it to American spelling.
- **CGO**: The build may require CGO for SQLite. If `go build` fails with CGO errors, ensure `gcc` is available.
- **Migration JS files**: Go loads PocketBase migrations from `pb_migrations/*.js`. If you change migrations, `go build` verifies they parse correctly. See the [migration checklist](migration.md) for JS-specific checks.
