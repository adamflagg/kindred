/**
 * Season › Rules' layout (spec §6.1, §6.2; rules-v3.html after Fix 1): two groups of folding chapters under a chapter
 * bar, each chapter a card of section cards. Pure: which sections sit where, what a chip and a folded chapter say.
 */
import type { ApiAidRulesDraft, ApiAidRulesSection } from '../../../../types/api-types'
import type { DefinitionNote } from '../../kit/DefinitionNotes'
import type { PillTone } from '../../kit/kitStyles'
import { SECTION_TITLES, type StatusWords } from './rulesModel'

export type CardKey = ApiAidRulesSection | 'tiergrid' | 'programs_costs'

export interface ChapterDef {
  readonly n: number
  readonly key: string
  readonly title: string
  readonly group: 'Awards' | 'Setup'
  readonly cards: readonly CardKey[]
}

/** The combined tier grid shows three sections (owner: "Tier tables = (ii) ONE COMBINED GRID"). */
export const GRID_PARTS = ['tiers', 'award_tables', 'round2'] as const
export const GRID_TITLES = {
  tiers: 'Income tiers',
  award_tables: 'Round 1 award table',
  round2: 'Appeal caps, by tier',
} as const satisfies Record<(typeof GRID_PARTS)[number], string>

export const CHAPTERS: readonly ChapterDef[] = [
  {
    n: 1,
    key: 'qualify',
    title: 'Tiers & equity',
    group: 'Awards',
    cards: ['income', 'tiergrid', 'equity'],
  },
  { n: 2, key: 'awards', title: 'Awards', group: 'Awards', cards: ['awards'] },
  { n: 3, key: 'r3', title: 'Round 3', group: 'Awards', cards: ['round3'] },
  { n: 4, key: 'checks', title: 'Checks', group: 'Awards', cards: ['quality_checks'] },
  { n: 5, key: 'programs', title: 'Programs', group: 'Setup', cards: ['programs_costs'] },
  { n: 6, key: 'dates', title: 'Dates', group: 'Setup', cards: ['milestones'] },
  { n: 7, key: 'grants', title: 'Grants', group: 'Setup', cards: ['grants'] },
]

export function sectionsOf(chapter: ChapterDef): ApiAidRulesSection[] {
  return chapter.cards.flatMap((card): ApiAidRulesSection[] =>
    card === 'tiergrid'
      ? [...GRID_PARTS]
      : card === 'programs_costs'
        ? ['programs', 'cost']
        : [card]
  )
}

export function chapterOfSection(section: ApiAidRulesSection): ChapterDef | null {
  return CHAPTERS.find((c) => sectionsOf(c).includes(section)) ?? null
}

export interface ChapterMarks {
  readonly draft: boolean
  readonly issues: number
}

/** A chip's marks (§6.2 A): a dot when the chapter holds a draft section, a count of its issues; none without a draft read. */
export function chapterMarks(chapter: ChapterDef, draft: ApiAidRulesDraft | null): ChapterMarks {
  if (draft === null) return { draft: false, issues: 0 }
  const rows = draft.sections.filter((s) => sectionsOf(chapter).includes(s.section))
  return {
    draft: rows.some((s) => s.status.state === 'draft'),
    issues: rows.reduce((n, s) => n + s.errors + s.warnings, 0),
  }
}

/** Open the chapters holding a draft section, a warning or an error; fold the rest (§6.2 C). */
export function defaultOpen(draft: ApiAidRulesDraft | null): number[] {
  return CHAPTERS.filter((c) => {
    const marks = chapterMarks(c, draft)
    return marks.draft || marks.issues > 0
  }).map((c) => c.n)
}

export function parseOpenChapters(raw: string | null): number[] | null {
  if (raw === null) return null
  return [
    ...new Set(
      raw
        .split(',')
        .map(Number)
        .filter((n) => CHAPTERS.some((c) => c.n === n))
    ),
  ]
}

/** `?open=` after one chapter is clicked; '' keeps every chapter folded (it overrides the default). */
export function toggleChapter(open: readonly number[], n: number): string {
  const next = open.includes(n) ? open.filter((o) => o !== n) : [...open, n].sort((a, b) => a - b)
  return next.join(',')
}

export interface SummaryPill {
  readonly text: string
  readonly tone: PillTone
}

const cardTitle = (section: ApiAidRulesSection) =>
  (GRID_PARTS as readonly string[]).includes(section)
    ? GRID_TITLES[section as (typeof GRID_PARTS)[number]]
    : SECTION_TITLES[section]

/**
 * A folded chapter's line (rules-v3): "3 locked", "1 in effect", each draft section by name, the issues count. `errors`
 * is how many of `issues` are errors: they read as errors, in red, as on the section's own head.
 */
export function chapterSummary(
  chapter: ChapterDef,
  statuses: ReadonlyMap<ApiAidRulesSection, StatusWords>,
  issues: number,
  errors = 0
): SummaryPill[] {
  const words = sectionsOf(chapter).flatMap((s) => {
    const w = statuses.get(s)
    return w === undefined ? [] : [[s, w] as const]
  })
  const count = (pill: string) => words.filter(([, w]) => w.pill === pill).length
  const out: SummaryPill[] = []
  if (count('Locked') > 0) out.push({ text: `${String(count('Locked'))} locked`, tone: 'stone' })
  if (count('In effect') > 0)
    out.push({ text: `${String(count('In effect'))} in effect`, tone: 'emerald' })
  for (const [section, w] of words) {
    if (w.tone === 'amber')
      out.push({ text: `${cardTitle(section)}: ${w.pill.toLowerCase()}`, tone: 'amber' })
    if (w.pill === 'Not approved yet')
      out.push({ text: `${cardTitle(section)}: not approved yet`, tone: 'stone' })
  }
  if (errors > 0)
    out.push({ text: `${String(errors)} ${errors === 1 ? 'error' : 'errors'}`, tone: 'red' })
  const warnings = issues - errors
  if (warnings > 0)
    out.push({
      text: `${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}`,
      tone: 'amber',
    })
  return out
}

/** Rules' own page notes (§6.2 H), in rules-v3's Fix 1 words; not money definitions. */
export const RULES_FOOTNOTES: readonly DefinitionNote[] = [
  {
    n: 1,
    text: 'Locked: in effect, and a posted round has read it. Editing it starts a new version; posted amounts stand.',
  },
  {
    n: 2,
    text: 'Tier: tier 1 is the lowest income and gets the most aid; equity criteria can move a family toward it, never past tier 1.',
  },
  {
    n: 3,
    text: 'Income ceiling: above this counted income, no camp money in any round. Outside grants are unaffected.',
  },
  {
    n: 4,
    text: 'Read-only: how the dashboard prices, shown so staff know it. Changing one is a developer change, not a rules edit.',
  },
  {
    n: 5,
    // Owner 10-06 (a): the named fund subtracts outside grants too (Task 17's engine branch).
    text: "Named award kinds: full cost pays the cost less grants, plus the extra amount; full cost after camp aid pays what the camp award and outside grants leave of the cost; a fixed top-up adds its amount; staff type the amount on the request. A named award that doesn't count toward the budget sits below the line.",
  },
  {
    n: 6,
    text: 'Award above cost and Household income conflict always hold, whether or not they are listed here.',
  },
  {
    n: 7,
    text: "Equity class: picks both the program's row of equity weights and its award table (Round 1 % and appeal caps).",
  },
]
