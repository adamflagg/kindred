// Commitlint configuration for conventional commits with required scopes
// https://commitlint.js.org/

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Require a scope for all commits
    'scope-empty': [2, 'never'],

    // Define allowed scopes (matches CLAUDE.md documentation)
    'scope-enum': [2, 'always', [
      // Technical areas
      'frontend',  // React components, hooks, pages, styles
      'api',       // FastAPI endpoints, Python backend logic
      'sync',      // Go sync services, CampMinder integration
      'pb',        // PocketBase schema, migrations, Go extensions
      'solver',    // OR-Tools constraint solver
      'docker',    // Dockerfiles, compose, container configs
      'ci',        // GitHub Actions workflows
      'auth',      // Authentication, OAuth, permissions
      'google',    // Google Sheets/Drive API integration
      'security',  // Security hardening, CVE fixes, vulnerability remediation
      'logging',   // Logging configuration
      'release',   // Release scripts, versioning
      'config',    // Configuration files (not code)
      'deps',      // Dependency updates
      'tests',     // Test infrastructure (not test: type)
      'scripts',   // Development and utility scripts
      'docs',      // Documentation files in docs/
      // Domain features (cross-cutting)
      'metrics',   // Analytics, dashboards, statistics
      'graph',     // Social network graph features
      'data',      // Data models, schema changes
    ]],

    // Allowed types (must match cliff.toml commit_parsers)
    'type-enum': [2, 'always', [
      'feat',     // New features → cliff: Features
      'fix',      // Bug fixes → cliff: Bug Fixes
      'perf',     // Performance → cliff: Performance
      'refactor', // Refactoring → cliff: Refactoring
      'docs',     // Documentation → cliff: Documentation
      'style',    // Styling → cliff: Styling
      'test',     // Testing → cliff: Testing
      'build',    // Build system → cliff: Build
      'config',   // Configuration → cliff: Configuration
      'chore',    // Maintenance → cliff: skipped
      'ci',       // CI/CD → cliff: skipped
      'revert',   // Reverting commits
    ]],

    // Enforce lowercase for type and scope
    'type-case': [2, 'always', 'lower-case'],
    'scope-case': [2, 'always', 'lower-case'],

    // Subject case not enforced - allow proper nouns (Python, Docker, etc.)
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],

    // Reasonable length limits
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 200],
  },
};
