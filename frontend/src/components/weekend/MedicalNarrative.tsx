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
 *
 * kindred#2542: the gate answer renders as a pill beside the row label, not
 * concatenated into the narrative. The API used to fold the yes/no answer
 * into the free-text column, so a family who answered "No" and wrote nothing
 * else showed a paragraph that read the bare word "No" — 418 of 676 populated
 * allergy rows in 2026. The narrative column now holds the family's own words
 * alone; the gate is its own `'yes' | 'no' | 'unknown'` field, rendered here.
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

/**
 * Display order, which is need-first rather than the API's field order.
 *
 * The third entry is the row's GATE column, or null where the question has no
 * stored gate: `additional_info` was never a gate/explain pair, and
 * `bathroom_explain` / `accommodation_explain` keep their gates as booleans on
 * family_camp_registrations, where `AccessibilityFlagList` already renders them
 * one section above. Adding a row here is the one edit a new pair needs.
 */
const FIELDS = [
  ['CPAP', 'cpap_info', 'cpap_gate'],
  ['Bathroom', 'bathroom_explain', null],
  ['Accommodation', 'accommodation_explain', null],
  ['Special needs', 'special_needs_info', 'special_needs_gate'],
  ['Allergies', 'allergy_info', 'allergy_gate'],
  ['Dietary', 'dietary_info', 'dietary_gate'],
  ['Physician', 'physician_info', 'physician_gate'],
  ['Additional', 'additional_info', null],
] as const

export function MedicalNarrative({ householdCmId, year }: MedicalNarrativeProps) {
  const { hasPermission } = usePermissions()
  // Both halves are required: the permission, and a household to fetch by.
  const canRead = hasPermission(Permission.BUNKING_MANAGE) && householdCmId !== null
  const { data, isLoading, error } = useHouseholdMedical(year, householdCmId, canRead)

  if (!canRead) return null

  // A row earns its place if the family wrote something OR answered the gate.
  // "unknown" is not an answer -- the household never reached the question, and
  // rendering it as a denial would tell staff a family declined something they
  // were never shown.
  const rows = FIELDS.map(([label, key, gateKey]) => {
    const text = data?.[key]
    const gate = gateKey ? data?.[gateKey] : undefined
    return {
      label,
      text: typeof text === 'string' ? text : '',
      gate: gate === 'yes' || gate === 'no' ? gate : null,
    }
  }).filter((row) => row.text.length > 0 || row.gate !== null)

  // Nothing to show and nothing pending. Emptiness is now discovered from the
  // payload rather than predicted by a flag, so this branch is what stands in
  // for the flag's one honest use — and an empty bordered box would read as a
  // disclosure that failed to load.
  if (!isLoading && !error && rows.length === 0) return null

  return (
    <div className="rounded-r-lg border-l-2 border-red-400 bg-red-50/60 px-3 py-2 text-sm text-red-900 dark:border-red-500/60 dark:bg-red-900/20 dark:text-red-200">
      {isLoading && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading medical detail…
        </span>
      )}
      {error && <span>{error.message}</span>}
      {rows.length > 0 && (
        <dl className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase opacity-70">
                {row.label}
                {row.gate !== null && (
                  <span
                    className={
                      row.gate === 'yes'
                        ? 'rounded-full bg-red-200 px-2 py-0.5 text-xs font-semibold tracking-normal text-red-900 normal-case dark:bg-red-500/30 dark:text-red-100'
                        : 'bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold tracking-normal normal-case'
                    }
                  >
                    {row.gate === 'yes' ? 'Yes' : 'No'}
                  </span>
                )}
              </dt>
              {row.text.length > 0 && <dd className="whitespace-pre-wrap">{row.text}</dd>}
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
