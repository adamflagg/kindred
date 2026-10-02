/**
 * "Make A1 the rules draft" (spec §7.5; D39; rules.html A, task 3). Pure. Each section the option
 * changes, old → new, and each one whose edit it would replace, which the person confirms by the token
 * the server gave with the warning: a re-edit since the preview brings a new token, so an old tick
 * no longer counts (Decision 21).
 */
import type {
  ApiAidPromotionPreview,
  ApiAidPromotionSection,
  ApiAidRulesSection,
} from '../../../../types/api-types'
import { campToday, formatLongDate } from '../../kit/dates'
import { SECTION_TITLES } from '../rules/rulesModel'

/** Who and what a replaced change was, in words. */
export function warningWords(section: ApiAidPromotionSection): string | null {
  const warning = section.warning
  if (warning === null) return null
  // A stored timestamp's camp-time day, as the Rules tab names it: an evening edit is that day.
  const day = (iso: string) => {
    const at = new Date(iso)
    return formatLongDate(Number.isNaN(at.getTime()) ? iso : campToday(at))
  }
  const who = [warning.by, warning.at ? day(warning.at) : null].filter(Boolean).join(', ')
  if (warning.kind === 'unapproved_edit') {
    return `Replaces an unapproved change in the rules draft${who ? ` (${who}` : ''}${warning.via ? `, from ${warning.via}` : ''}${who ? ')' : ''}.`
  }
  return `Undoes a change approved since this option's starting point${who ? ` (${who})` : ''}.`
}

/** The confirmations still standing: a tick counts only while its token is the preview's own. */
export function standingAcks(
  preview: ApiAidPromotionPreview,
  acks: ReadonlyMap<string, string>
): Record<string, string> {
  const standing: Record<string, string> = {}
  for (const section of preview.sections) {
    const token = section.warning?.token
    if (token !== undefined && acks.get(section.section) === token)
      standing[section.section] = token
  }
  return standing
}

/** Every warned section confirmed: the server refuses a promotion with any left unconfirmed. */
export function allConfirmed(
  preview: ApiAidPromotionPreview,
  acks: ReadonlyMap<string, string>
): boolean {
  const standing = standingAcks(preview, acks)
  return preview.sections.every(
    (section) => section.warning === null || section.section in standing
  )
}

/**
 * A section a posted round read is locked: the server may start a new version of it, or lift a lock
 * the draft only carried from its parent, in place (`_save_over`/`_protected`). Either way what was
 * posted stands (§7.5; S1 Q1).
 */
export function lockedWords(section: ApiAidRulesSection): string {
  return `${SECTION_TITLES[section]} is locked by a posted round: making this the rules draft may start a new version of it. Posted amounts stand.`
}
