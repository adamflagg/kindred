/** Reading the rules draft (spec §7.5; D39): one section's settings. Pure. */
import type { ApiAidRulesDraft, ApiAidRulesSection } from '../../../../types/api-types'

/** One section's settings from a rules document, as its editor sends them back (`SectionSaveIn.content`). */
export function sectionContent(
  document: ApiAidRulesDraft['document'],
  section: ApiAidRulesSection
): Record<string, unknown> {
  const value: unknown = document[section]
  return (value ?? {}) as Record<string, unknown>
}
