/** Reading the rules draft (spec §7.5; D39): one section's settings, the sections still in draft. Pure. */
import type {
  ApiAidRulesDocumentIn,
  ApiAidRulesDraft,
  ApiAidRulesSection,
} from '../../../../types/api-types'
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

/**
 * Whether a section reads the same in two reads of the draft: the server's fingerprint of its stored
 * content (what a save's 409 compares) and its status.
 */
export function sameSection(
  a: ApiAidRulesDraft,
  b: ApiAidRulesDraft,
  section: ApiAidRulesSection
): boolean {
  const rowOf = (d: ApiAidRulesDraft) => d.sections.find((s) => s.section === section)
  return (
    rowOf(a)?.fingerprint === rowOf(b)?.fingerprint &&
    JSON.stringify(rowOf(a)?.status) === JSON.stringify(rowOf(b)?.status)
  )
}

/** A rules document with one section's settings replaced: what a scenario's "All settings" records (D39). */
export function withSection(
  document: ApiAidRulesDraft['document'],
  section: ApiAidRulesSection,
  content: Readonly<Record<string, unknown>>
): ApiAidRulesDocumentIn {
  return { ...document, [section]: content }
}
