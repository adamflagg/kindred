/**
 * The household's housing needs, each row carrying the family's own words.
 *
 * ## Why this is not `AccessibilityFlagList`
 *
 * `AccessibilityFlagList` renders once per roster row, 62 to a page, so it
 * must never acquire the medical hook — 62 rows would fire 62 gated requests.
 * This component exists only inside `FamilyDetailsPanel`, which shows ONE
 * household, and the roster never imports it. A component that cannot be
 * mounted on 62 rows cannot make 62 requests: the guarantee is a fact about
 * the module graph rather than a rule someone has to remember.
 *
 * That is a REQUEST-VOLUME boundary, not a privacy one. Private data --
 * health information included -- is gated behind `bunking.manage` and nothing
 * else; kindred#2312 removed the separate `lodging.phi` permission because
 * "RBAC here is screen-reduction, not a data boundary".
 *
 * ## One calculation, both surfaces
 *
 * `needExplainTexts` is the same mapping the board's glyph tooltips use. This
 * renders it inline instead of in a bubble; nothing is re-derived here.
 *
 * ## The merge (kindred#2255, superseded in place)
 *
 * The need and its explain used to render twice in this section -- the gate as
 * an amber row from `family_camp_registrations`, the narrative as a red row
 * from `family_camp_medical`, one directly below the other. Measured on the
 * 2026 roster they fired on exactly the same households: bathroom 42/42,
 * accommodation 29/29, zero on either side alone. #2255 proposed collapsing
 * the duplicate behind a click; this removes it.
 *
 * NO GATE PILL. The row renders because the gate was Yes, so a pill restates
 * the row's own existence -- `cpap_gate = yes` matched `needs_power` 29 of 29.
 * NO SEVERITY FILL, because the glyph carries the ink and the board struck the
 * `need` amber tone. The blocker is the one exception.
 */
import { HandHeart, HandHelping, ShieldAlert, type LucideIcon } from 'lucide-react'

import { Permission } from '../../constants/permissions'
import { usePermissions } from '../../hooks/usePermissions'
import { useHouseholdMedical } from '../../hooks/useWeekendRoster'
import type { RosterPartyRow } from '../../types/lodging'
import { askedNeedGlyphs, needExplainTexts } from './needGlyphs'

export interface HousingNeedDetailsProps {
  party: RosterPartyRow
  /** `null` for a person-grain party — an adult weekend enrols the person
   *  directly, so there is no household to look a narrative up by. */
  householdCmId: number | null
  year: number
}

interface PanelRow {
  key: string
  label: string
  Icon: LucideIcon
  hueClassName: string
  texts: string[]
  isBlocker?: boolean
}

export function HousingNeedDetails({ party, householdCmId, year }: HousingNeedDetailsProps) {
  const { hasPermission } = usePermissions()
  const canRead = hasPermission(Permission.BUNKING_MANAGE) && householdCmId !== null
  const { data } = useHouseholdMedical(year, householdCmId, canRead)

  const flags = party.flags
  const mandatory = flags?.accommodation_is_mandatory === true
  const accommodationText = canRead
    ? [(data?.accommodation_explain ?? '').trim()].filter(Boolean)
    : []

  const rows: PanelRow[] = []

  // 1. The blocker: "I am only able to attend with this accommodation in
  //    place." True for 2 of 392 rostered 2026 households, and the single
  //    highest-stakes fact in this section.
  if (mandatory) {
    rows.push({
      key: 'blocker',
      label: 'Accommodation required',
      Icon: ShieldAlert,
      hueClassName: 'text-red-500 dark:text-red-400',
      texts: accommodationText,
      isBlocker: true,
    })
  } else if (flags?.needs_accommodation === true) {
    // 2. The gate without the blocker. NOT `Accessibility` -- that is the
    //    board's step-free glyph, and drawing it here would put one icon on
    //    two meanings on adjacent rows.
    rows.push({
      key: 'accommodation',
      label: 'Accommodation',
      Icon: HandHelping,
      hueClassName: 'text-rose-500 dark:text-rose-400',
      texts: accommodationText,
    })
  }

  // 3-6. The four graded needs, in NEED_GLYPHS order, with their own words.
  for (const glyph of askedNeedGlyphs(party)) {
    rows.push({
      key: glyph.key,
      label: glyph.label,
      Icon: glyph.Icon,
      hueClassName: glyph.hueClassName,
      texts: canRead ? needExplainTexts(glyph.key, data) : [],
    })
  }

  // 7. Special needs -- the one row with no flag behind it. It renders on
  //    text alone, which is why it disappears entirely without the
  //    permission. Deliberately NOT a NEED_GLYPHS entry: an entry there would
  //    draw on the board card too, and the board shows four graded needs.
  const specialNeeds = canRead ? (data?.special_needs_info ?? '').trim() : ''
  if (specialNeeds.length > 0) {
    rows.push({
      key: 'special_needs',
      label: 'Special needs',
      Icon: HandHeart,
      hueClassName: 'text-rose-500 dark:text-rose-400',
      texts: [specialNeeds],
    })
  }

  if (rows.length === 0) return null

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li
          key={row.key}
          data-testid={`need-row-${row.key}`}
          className={
            row.isBlocker
              ? 'flex flex-col gap-1 rounded-r-lg border-l-[3px] border-red-400 bg-red-50 px-3 py-2 dark:border-red-500/60 dark:bg-red-900/20'
              : 'flex flex-col gap-1'
          }
        >
          <div className="flex items-center gap-2 text-sm">
            <row.Icon className={`h-4 w-4 flex-shrink-0 ${row.hueClassName}`} />
            <span
              className={
                row.isBlocker
                  ? 'font-bold text-red-700 dark:text-red-300'
                  : 'text-foreground font-semibold'
              }
            >
              {row.label}
            </span>
            {row.isBlocker && (
              <span className="ml-auto rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-red-900 uppercase dark:bg-red-500/30 dark:text-red-100">
                Blocker
              </span>
            )}
          </div>
          {row.texts.map((text, index) => (
            <p
              key={`${row.key}-${String(index)}`}
              className={
                row.isBlocker
                  ? 'text-sm whitespace-pre-wrap text-red-700 dark:text-red-300'
                  : 'text-foreground/85 pl-6 text-sm whitespace-pre-wrap'
              }
            >
              {text}
            </p>
          ))}
        </li>
      ))}
    </ul>
  )
}
