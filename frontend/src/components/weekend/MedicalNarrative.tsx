/**
 * The medical narrative for one household, for a holder of `bunking.manage`.
 *
 * Rendered by `FamilyDetailsPanel` and deliberately NOT by
 * `HouseholdRosterRow` — the same split summer makes between a camper card
 * and `CamperDetailsPanel`, and the reason this can fetch on mount at all: a
 * panel shows one household, a roster shows 62 rows.
 *
 * There is no reveal button (kindred#1889). One existed to gate the narrative
 * behind a click, driven by a `has_medical_narrative` flag that was true for
 * every household — so the button appeared on every row and gated nothing.
 * With that flag deleted the rule is the one the API already enforces:
 * `bunking.manage` holders see the text, everyone else sees no trace of it.
 * The old "Medical detail on file" line shown to non-holders is gone with it,
 * because telling someone a disclosure exists that they may not read is not
 * information they can act on.
 *
 * kindred#2312: this used to read a separate `lodging.phi` permission,
 * removed because RBAC here is screen-reduction, not a data boundary, and
 * every sibling endpoint on this router already gated on `bunking.manage`.
 *
 * The API is the real boundary — /api/lodging/households/{id}/medical requires
 * `bunking.manage` and 403s otherwise. This UI gate exists so the request is
 * not made on behalf of a user who cannot have the answer, and a 403 that
 * arrives anyway renders inline rather than escalating to the page
 * ErrorBoundary.
 */
import { Loader2 } from 'lucide-react'

import { Permission } from '../../constants/permissions'
import { usePermissions } from '../../hooks/usePermissions'
import { useHouseholdMedical } from '../../hooks/useWeekendRoster'

export interface MedicalNarrativeProps {
  /**
   * The household the narrative belongs to, or `null` when the party has no
   * household — an adult weekend enrols the person directly. There is then
   * nothing to look a narrative up by, so nothing is fetched.
   */
  householdCmId: number | null
  year: number
}

/** Display order, which is need-first rather than the API's field order. */
const FIELDS = [
  ['CPAP', 'cpap_info'],
  ['Bathroom', 'bathroom_explain'],
  ['Accommodation', 'accommodation_explain'],
  ['Special needs', 'special_needs_info'],
  ['Allergies', 'allergy_info'],
  ['Dietary', 'dietary_info'],
  ['Physician', 'physician_info'],
  ['Additional', 'additional_info'],
] as const

export function MedicalNarrative({ householdCmId, year }: MedicalNarrativeProps) {
  const { hasPermission } = usePermissions()
  // Both halves are required: the permission, and a household to fetch by.
  const canRead = hasPermission(Permission.BUNKING_MANAGE) && householdCmId !== null
  const { data, isLoading, error } = useHouseholdMedical(year, householdCmId, canRead)

  if (!canRead) return null

  const populated = FIELDS.map(([label, key]) => [label, data?.[key]] as const).filter(
    ([, value]) => typeof value === 'string' && value.length > 0
  )

  // Nothing to show and nothing pending. Emptiness is now discovered from the
  // payload rather than predicted by a flag, so this branch is what stands in
  // for the flag's one honest use — and an empty bordered box would read as a
  // disclosure that failed to load.
  if (!isLoading && !error && populated.length === 0) return null

  return (
    <div className="rounded-r-lg border-l-2 border-red-400 bg-red-50/60 px-3 py-2 text-sm text-red-900 dark:border-red-500/60 dark:bg-red-900/20 dark:text-red-200">
      {isLoading && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading medical detail…
        </span>
      )}
      {error && <span>{error.message}</span>}
      {populated.length > 0 && (
        <dl className="space-y-1.5">
          {populated.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-bold tracking-wider uppercase opacity-70">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
