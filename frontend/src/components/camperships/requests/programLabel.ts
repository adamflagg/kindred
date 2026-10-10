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

/**
 * The program words every Camperships screen shares (#3131; owner 2026-10-10 for Funders and the household page):
 * the approved read's `program_words`, the server's family words laid over the rules' labels (summer is At Camp,
 * never the rules' "Summer"). A read that sends none falls back to the rules' own labels. No TypeScript copy.
 */
export function programWords(rules: ApiAidApprovedRules | undefined): Record<string, string> {
  const words = rules?.program_words ?? {}
  return Object.keys(words).length > 0 ? { ...words } : programLabels(rules)
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
 * The families' display order inside a pool (the summer app's own: At Camp, Quests, Teen Programs; Family Camp
 * before Adult Weekends). Order only: the families and their words come from the server, never from here.
 */
const FAMILY_ORDER = [
  'summer',
  'quest',
  'teen',
  'bmitzvah',
  'family_camp',
  'adult_weekend',
  'family_school',
]

/** A family's place in `FAMILY_ORDER`; a family it does not list goes after them. */
export function familyRank(family: string): number {
  const at = FAMILY_ORDER.indexOf(family)
  return at === -1 ? FAMILY_ORDER.length : at
}

/**
 * The Program dropdown's groups (ux3 taxonomy): every program family the rows hold (`program_family`, with the
 * server's word for it), under the budget pool its rows carry. Pools run in the rules' order, then by key;
 * families in `FAMILY_ORDER`, any other by label; a family in no pool comes last, under no heading. A family the
 * server sent no word for is spelled out, and the groups never wait on the rules read.
 */
export function programGroups(
  seen: ReadonlyArray<{
    readonly family: string
    readonly label: string
    readonly pool: string | null
  }>,
  rules: ApiAidApprovedRules | undefined
): ProgramGroup[] {
  const poolNames = poolLabels(rules)
  const byPool = new Map<string | null, Map<string, ProgramOption>>()
  for (const { family, label, pool } of seen) {
    const programs = byPool.get(pool) ?? new Map<string, ProgramOption>()
    programs.set(family, { value: family, label: label !== '' ? label : programLabel({}, family) })
    byPool.set(pool, programs)
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
      programs: [...programs.values()].sort(
        (x, y) => familyRank(x.value) - familyRank(y.value) || x.label.localeCompare(y.label)
      ),
    }))
}

/**
 * The ledger families the rules never key by their own name, and the budget pool each belongs to
 * (the server's `RULES_KEY_ALIASES` and fixed families): Quests and Teen Programs sit in the camp
 * and quest pool, B*Mitzvah is the rules' `tbm`, adult weekends are the weekend pool.
 */
const FAMILY_POOLS: Readonly<Record<string, string>> = {
  quest: 'camp_quest',
  teen: 'camp_quest',
  bmitzvah: 'tbm',
  adult_weekend: 'weekend',
}

/**
 * Where a program sits in the pool order (final audit M-E8; "pool order is the rules' order"): its
 * budget pool's place in the rules' `budget.pools`, then its place among the rules' programs, the
 * families the rules do not key (`FAMILY_POOLS`) after them. Any other unnamed family comes last.
 * Ties go to the caller's own key or label order. With no rules every key ranks alike.
 */
export function programRank(rules: ApiAidApprovedRules | undefined): (program: string) => number {
  const pools = Object.keys(poolLabels(rules))
  const programs = Object.keys(sectionContent(rules, 'programs') ?? {})
  const filed = stringField(sectionContent(rules, 'programs'), 'budget_pool')
  return (program) => {
    const known = programs.indexOf(program)
    const home = known === -1 ? FAMILY_POOLS[program] : filed[program]
    // A home the rules do not list ranks like no home: after every listed pool, never ahead of the first.
    const at = home === undefined ? -1 : pools.indexOf(home)
    const pool = at === -1 ? pools.length : at
    // Inside a pool the rules' programs keep the rules' order, and the unkeyed families follow them.
    return pool * 1000 + (known === -1 ? 999 : known)
  }
}
