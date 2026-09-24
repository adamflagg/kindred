# Security Policy

Kindred stores data about children and their families — names, birthdates, addresses,
cabin placements and, for Family Camp, medical and accessibility notes. I take reports
that could expose that data seriously, and I am grateful to anyone who takes the time to
report one responsibly.

## Reporting a Vulnerability

**Please do not open a public issue, pull request, or discussion for a security problem.**

Report privately through either channel:

- **GitHub private vulnerability reporting** (preferred) — use the
  [**Report a vulnerability**](https://github.com/adamflagg/kindred/security/advisories/new)
  button on this repository's Security tab. It keeps the conversation, the fix, and the
  eventual advisory in one place.
- **Email** — <kindred@flagg.moi>, with `[SECURITY]` in the subject line.

A useful report includes:

- the affected component (frontend, FastAPI, PocketBase/sync, solver, Docker/deploy config)
  and the version or commit you tested
- steps to reproduce, or a proof of concept
- what an attacker could achieve — which data could be read or changed, and by whom

**Never include real personal data in a report.** If you demonstrate a data exposure,
show it against test records you created yourself, and describe what *would* be exposed
rather than attaching it.

## What to Expect

Kindred is a personal project with a single developer, and there is no security team or
on-call rotation behind it. The timelines below are soft targets I aim for in good faith,
not guarantees. If one slips, I will tell you rather than go quiet:

| Step | Target |
|------|--------|
| Acknowledge your report | within 5 business days |
| Initial assessment (confirmed, needs more info, or not a vulnerability) | within 14 days |
| Fix for a confirmed high-severity issue | as fast as I can, typically within 30 days |

I will keep you informed as I work on it, and coordinate the disclosure date with you.
I ask that you give me **90 days** from your report, or until a fix is released —
whichever comes first — before disclosing publicly. If a fix needs longer, I will tell you
why and agree a new date together.

Once fixed, I publish a GitHub Security Advisory and, with your permission, credit you in
it.

## Supported Versions

Only the **latest release** receives security fixes. Kindred ships frequently and does not
maintain backport branches, so the fix for any vulnerability is to upgrade.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Anything older | ❌ |

## Scope

**In scope** — the code and configuration in this repository, including:

- authentication, OIDC and session handling
- role-based access control — any way to read or change data your role should not reach
- the FastAPI and PocketBase HTTP APIs
- the CampMinder sync pipeline and how it stores what it fetches
- the Docker images, Caddy configuration, and CI/CD workflows

**Out of scope:**

- **Any deployment of Kindred you do not own.** Do not test against someone else's
  instance — run your own local install (`./scripts/start_dev.sh`) with test data you
  created.
- Vulnerabilities in third-party services Kindred integrates with (CampMinder, Google,
  your identity provider) — please report those to the vendor directly.
- Vulnerabilities in upstream dependencies with no demonstrated impact on Kindred. I
  already track these through Dependabot and Trivy container scanning.
- Denial of service, social engineering, and physical attacks.
- Missing security headers or best-practice findings without a working exploit.

## Safe Harbor

I will not pursue legal action against anyone who, in good faith:

- makes a reasonable effort to avoid privacy violations, data destruction, and service
  disruption
- tests only against their own installation and their own test data
- does not access, keep, or share more data than needed to demonstrate the issue
- reports the vulnerability to me promptly and keeps it confidential until it is fixed or
  the agreed disclosure date passes

If you are unsure whether something you plan to do is covered, ask me first at
<kindred@flagg.moi>.
