# Documentation

Minimal documentation for Kindred. **CLAUDE.md is the primary reference.**

## Structure

```text
docs/
├── architecture/   # sync-layer, bunk-request-pipeline, session-types, metrics-module,
│                   # data-model, solver-internals, request-classification,
│                   # lodging-occupancy, campminder-date-fields
├── guides/
│   ├── staff/      # Older in-app staff notes; the staff guide is maintained separately
│   ├── csv-preparation.md, dev-database-seeding.md, docker-deployment.md,
│   └── solver-configuration.md, troubleshooting.md
├── api/
│   ├── solver-api.md           # REST API reference
│   └── external/campminder/    # CampMinder API docs
├── reference/      # cli-commands, configuration, tables, git-workflow, lodging-*, weekend-*,
│                   # family-camp-*, pocketbase-migrations, go-sync-patterns, and more;
│                   # issue-triage.md is gitignored and exists only in a local checkout
└── features/
    ├── request-types-specification.md  # Business rules
    └── bunk_request_business_rules.md  # (needs update)
```

## Quick Links

- **System architecture & dev setup** → [CLAUDE.md](../CLAUDE.md)
- **Database schema** → [data-model.md](./architecture/data-model.md)
- **Production deployment** → [docker-deployment.md](./guides/docker-deployment.md)
- **Troubleshooting** → [troubleshooting.md](./guides/troubleshooting.md)
- **Staff guides** → [guides/staff/](./guides/staff/)
- **Modernization backlog** → [reference/modernization-backlog.md](./reference/modernization-backlog.md)
