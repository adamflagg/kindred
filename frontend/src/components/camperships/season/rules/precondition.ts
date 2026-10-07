/**
 * What a rules write sends so the server can refuse it when a section moved since it was read
 * (Decisions 16-17; owner ruling 2026-10-02). The mechanism is a per-section fingerprint: the sha256
 * of the section's stored content, which changes only when that section's content changes (never on
 * another section's save or on an approval). This file is the only place that knows the field names;
 * spread the results into the request bodies. Pure.
 */
import type {
  ApiAidRulesApproveIn,
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidSectionSaveIn,
} from '../../../../types/api-types'

/** A section save's precondition: the section as the editor last read it. */
export function savePrecondition(
  draft: ApiAidRulesDraft,
  section: ApiAidRulesSection
): Pick<ApiAidSectionSaveIn, 'expected_fingerprint'> {
  const fingerprint = draft.sections.find((s) => s.section === section)?.fingerprint
  // Every section row carries one; the server refuses '' with a 422, so never send it.
  if (!fingerprint) throw new Error(`The rules draft has no fingerprint for ${section}`)
  return { expected_fingerprint: fingerprint }
}

/** An approval's precondition: every ticked section as the form last read it. */
export function approvePrecondition(
  draft: ApiAidRulesDraft,
  sections: readonly ApiAidRulesSection[]
): Pick<ApiAidRulesApproveIn, 'fingerprints'> {
  return {
    fingerprints: Object.fromEntries(
      sections.map((section) => [section, savePrecondition(draft, section).expected_fingerprint])
    ),
  }
}
