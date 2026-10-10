import type { ApiAidApprovedRules } from '../../../types/api-types'

function sectionContent(
  rules: ApiAidApprovedRules | undefined,
  section: string
): Record<string, unknown> | null {
  return rules?.sections.find((s) => s.section === section)?.content ?? null
}

/** A map of rules entries to one string field each (`label`, `budget_pool`), skipping any without it. */
function stringField(entries: unknown, field: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof entries !== 'object' || entries === null) return out
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = (entry as Record<string, unknown>)[field]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * Program words come from the rules, never from this app: each rules program names itself
 * (`ProgramProfile.label`), and the approved-rules read sends them in its `programs` section.
 */
export function programLabels(rules: ApiAidApprovedRules | undefined): Record<string, string> {
  return stringField(sectionContent(rules, 'programs'), 'label')
}

/** Pool words, the same rule: the `budget` section's `pools`, each naming itself (`BudgetPool.label`). */
export function poolLabels(rules: ApiAidApprovedRules | undefined): Record<string, string> {
  return stringField(sectionContent(rules, 'budget')?.['pools'], 'label')
}

/**
 * A program key in words: the rules' label when they name it. While the read loads, after it
 * fails or 404s ("no rules yet"), or for a key the rules do not name, the key spelled out:
 * underscores become spaces, first letter capital.
 */
export function programLabel(labels: Readonly<Record<string, string>>, key: string): string {
  const named = labels[key]
  if (named !== undefined) return named
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface ProgramOption {
  readonly value: string
  readonly label: string
}

/** One heading of the Program dropdown: a budget pool (null: programs in none) and its programs. */
export interface ProgramGroup {
  readonly pool: ProgramOption | null
  readonly programs: readonly ProgramOption[]
}

/**
 * The Program dropdown's groups (slice 1 grid layout T6): every program the rows hold, under its
 * budget pool. The rules file a program (`budget_pool`) and name both; a program they do not file
 * keeps the pool its rows carry, so while the read loads, fails or 404s the dropdown still groups,
 * keys spelled out, and never waits on it. Pools run in the rules' order, then by key; programs by
 * label; a program in no pool comes last, under no heading.
 */
export function programGroups(
  seen: ReadonlyArray<{ readonly program: string | null; readonly pool: string | null }>,
  rules: ApiAidApprovedRules | undefined
): ProgramGroup[] {
  const programNames = programLabels(rules)
  const poolNames = poolLabels(rules)
  const filed = stringField(sectionContent(rules, 'programs'), 'budget_pool')
  const byPool = new Map<string | null, Map<string, ProgramOption>>()
  for (const { program, pool } of seen) {
    if (program === null) continue
    const home = filed[program] ?? pool
    const programs = byPool.get(home) ?? new Map<string, ProgramOption>()
    programs.set(program, { value: program, label: programLabel(programNames, program) })
    byPool.set(home, programs)
  }
  const order = Object.keys(poolNames)
  const rank = (pool: string | null) => {
    if (pool === null) return Number.MAX_SAFE_INTEGER
    const at = order.indexOf(pool)
    return at === -1 ? order.length : at
  }
  return [...byPool.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (a ?? '').localeCompare(b ?? ''))
    .map(([pool, programs]) => ({
      pool: pool === null ? null : { value: pool, label: programLabel(poolNames, pool) },
      programs: [...programs.values()].sort((x, y) => x.label.localeCompare(y.label)),
    }))
}

/**
 * Where a program sits in the pool order (final audit M-E8; "pool order is the rules' order"): its
 * budget pool's place in the rules' `budget.pools`, then its place among the rules' programs. A
 * family the rules do not name (Quest, Teen Leadership on a Ledger) belongs to the camp & quest
 * pool, as that pool's label says, and follows the programs the rules do name there. Ties go to the
 * caller's own key or label order. With no rules every key ranks alike.
 */
export function programRank(rules: ApiAidApprovedRules | undefined): (program: string) => number {
  const pools = Object.keys(poolLabels(rules))
  const programs = Object.keys(sectionContent(rules, 'programs') ?? {})
  const filed = stringField(sectionContent(rules, 'programs'), 'budget_pool')
  const homePool = Math.max(pools.indexOf('camp_quest'), 0)
  return (program) => {
    const known = programs.indexOf(program)
    const pool = known === -1 ? homePool : Math.max(pools.indexOf(filed[program] ?? ''), 0)
    // Inside a pool the rules' programs keep the rules' order, and the unnamed ones follow them.
    return pool * 1000 + (known === -1 ? 999 : known)
  }
}
