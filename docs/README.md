# Documentation

Minimal documentation for Kindred. **CLAUDE.md is the primary reference.**

## Structure

```
docs/
├── architecture/
│   └── data-model.md           # Database schema reference
├── guides/
│   ├── staff/                  # For camp staff/helpers
│   │   ├── lock-groups.md
│   │   ├── request-management.md
│   │   ├── scenario-management.md
│   │   ├── user-interface.md
│   │   └── visual-indicators.md
│   ├── csv-preparation.md      # External CSV format
│   ├── docker-deployment.md    # Production deployment
│   ├── solver-configuration.md # Solver settings reference
│   └── troubleshooting.md      # Common issues
├── api/
│   ├── solver-api.md           # REST API reference
│   └── external/campminder/    # CampMinder API docs
├── reference/
│   ├── cli-commands.md         # Command reference
│   └── configuration.md        # Env vars and config
├── features/
    ├── request-types-specification.md  # Business rules
    └── bunk_request_business_rules.md  # (needs update)
```

## Quick Links

- **System architecture & dev setup** → [CLAUDE.md](../CLAUDE.md)
- **Database schema** → [data-model.md](./architecture/data-model.md)
- **Production deployment** → [docker-deployment.md](./guides/docker-deployment.md)
- **Troubleshooting** → [troubleshooting.md](./guides/troubleshooting.md)
- **Staff guides** → [guides/staff/](./guides/staff/)
