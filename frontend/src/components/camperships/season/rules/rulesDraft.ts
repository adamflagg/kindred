/** Reading the rules draft (spec §7.5; D39): one section's settings, the sections still in draft. Pure. */
import type { ApiAidRulesDraft, ApiAidRulesSection } from '../../../../types/api-types'
import { MONEY_SECTIONS, SEASON_SECTIONS } from './rulesModel'

export const SECTION_ORDER: readonly ApiAidRulesSection[] = [...MONEY_SECTIONS, ...SEASON_SECTIONS]

/** One section's settings from a rules document, as its editor sends them back (`SectionSaveIn.content`). */
export function sectionContent(
  document: ApiAidRulesDraft['document'],
  section: ApiAidRulesSection
): Record<string, unknown> {
  const value: unknown = document[section]
  return (value ?? {}) as Record<string, unknown>
}

/** The sections still in draft, in the list's order: the ones there is something to approve in. */
export function draftSections(draft: ApiAidRulesDraft): ApiAidRulesSection[] {
  return SECTION_ORDER.filter(
    (section) => draft.sections.find((s) => s.section === section)?.status.state === 'draft'
  )
}

/** Whether a section reads the same in two reads of the draft: its settings and its status. */
export function sameSection(
  a: ApiAidRulesDraft,
  b: ApiAidRulesDraft,
  section: ApiAidRulesSection
): boolean {
  const statusOf = (d: ApiAidRulesDraft) => d.sections.find((s) => s.section === section)?.status
  return (
    JSON.stringify(sectionContent(a.document, section)) ===
      JSON.stringify(sectionContent(b.document, section)) &&
    JSON.stringify(statusOf(a)) === JSON.stringify(statusOf(b))
  )
}
