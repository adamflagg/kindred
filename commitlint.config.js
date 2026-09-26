// Commitlint configuration for conventional commits with required scopes
// https://commitlint.js.org/

module.exports = {
  extends: ['@commitlint/config-conventional'],
  // GitHub's auto-generated revert format ("Revert ...") has no scope — skip linting for those
  ignores: [
    (message) => message.startsWith('Revert '),
    // Dependabot/Renovate bump messages have unpredictable length (package
    // names, dirs, groups). Types follow .github/dependabot.yml and renovate.json.
    // Granted only when the title check says a bot opened the PR: a bump-shaped
    // title is text anyone can type, and this skips the length and full-stop
    // rules on the only commit message that reaches main.
    ...(process.env.PR_AUTHOR_IS_BOT === 'true'
      ? [(message) => /^(build|chore|ci)\(deps\): (bump|update) .+ to .+/.test(message)]
      : []),
  ],
  plugins: [
    {
      rules: {
        // Scope is required everywhere except `ci`. CI work never reaches the
        // changelog, and most of it (path filters, sharding, the gate) has no
        // surface to name: 83 of 103 CI PRs audited in 2026-09 reached for a
        // `ci` scope, which is only the type said twice.
        'scope-required-unless-ci': ({ type, scope }) => [
          type === 'ci' || Boolean(scope),
          'scope may not be empty (only ci may omit it)',
        ],
      },
    },
  ],
  rules: {
    'scope-empty': [0],
    'scope-required-unless-ci': [2, 'always'],

    // Allowed scopes. No scope repeats a type name: `fix(ci)` and `docs(docs)`
    // were how CI and docs work ended up under the wrong type
    // (tests/unit/scripts/test_commit_type_config.py).
    'scope-enum': [2, 'always', [
      // Technical areas
      'frontend',  // React components, hooks, pages, styles
      'api',       // FastAPI endpoints, Python backend logic
      'sync',      // Go sync services, CampMinder integration
      'pb',        // PocketBase schema, migrations, Go extensions
      'solver',    // OR-Tools constraint solver
      'docker',    // Dockerfiles, compose, container configs
      'auth',      // Authentication, OAuth/OIDC (permissions → rbac)
      'google',    // Google Sheets/Drive API integration
      'security',  // Security hardening, CVE fixes, vulnerability remediation
      'logging',   // Logging configuration
      'release',   // Release scripts, versioning
      'config',    // Configuration files (not code)
      'deps',      // Dependency updates
      'tests',     // Test infrastructure (not test: type)
      'scripts',   // Development and utility scripts
      'harness',   // Agent tooling: .claude/, CLAUDE.md, skills, lefthook
      // Domain features (cross-cutting)
      'metrics',   // Analytics, dashboards, statistics
      'graph',     // Social network graph features
      'data',      // Data models, schema changes
      'rbac',      // Role-based access control
    ]],

    // Allowed types. cliff.toml must give each one a parser of its own, and
    // tests/unit/scripts/test_commit_type_config.py checks that it does.
    'type-enum': [2, 'always', [
      'feat',     // New features → cliff: Features
      'fix',      // Bug fixes → cliff: Bug Fixes
      'perf',     // Performance → cliff: Performance
      'refactor', // Refactoring → cliff: Refactoring
      'docs',     // Documentation → cliff: Documentation
      'style',    // Styling → cliff: Styling
      'test',     // Testing → cliff: Testing
      'build',    // Build system → cliff: Build
      'chore',    // Maintenance → cliff: skipped
      'ci',       // CI/CD → cliff: skipped
      'revert',   // Reverting commits → cliff: Reverts
    ]],

    // Enforce lowercase for type and scope
    'type-case': [2, 'always', 'lower-case'],
    'scope-case': [2, 'always', 'lower-case'],

    // Subject case not enforced - allow proper nouns (Python, Docker, etc.)
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],

    // Reasonable length limits
    'header-max-length': [2, 'always', 120],
    'body-max-line-length': [1, 'always', 200],
  },
};
