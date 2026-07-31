/**
 * Derived accessibility flags, with the medical narrative behind an explicit
 * permission-checked reveal (spec §5).
 *
 * The API is the real boundary — /api/lodging/households/{id}/medical
 * requires `lodging.phi` and 403s otherwise. This UI gate exists so a user
 * who cannot see the narrative is not shown a button that always fails.
 *
 * `lodging.phi` is currently granted to NO role, so admin bypass is the only
 * route that reaches the narrative in practice. A failed reveal therefore
 * renders inline and never escalates into a page error.
 */
import { Accessibility, Baby, Bath, Eye, Loader2, Plug, ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { Permission } from '../../constants/permissions'
import { usePermissions } from '../../hooks/usePermissions'
import { useHouseholdMedical } from '../../hooks/useWeekendRoster'
import type { AccessibilityFlags } from '../../types/lodging'

export interface AccessibilityFlagListProps {
  flags: AccessibilityFlags
  householdCmId: number
  year: number
}

function Flag({ label, icon: Icon, tone }: { label: string; icon: typeof Bath; tone: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

export function AccessibilityFlagList({ flags, householdCmId, year }: AccessibilityFlagListProps) {
  const { hasPermission } = usePermissions()
  const [revealed, setRevealed] = useState(false)
  const canSeePhi = hasPermission(Permission.LODGING_PHI)
  const { data, isLoading, error } = useHouseholdMedical(year, householdCmId, revealed && canSeePhi)

  const neutral = 'bg-muted/60 text-foreground'
  const warn = 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  const blocker = 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'

  const mandatory = flags.accommodation_is_mandatory === true
  const hasAnyFlag =
    flags.needs_private_bathroom === true ||
    flags.needs_power === true ||
    flags.has_infant === true ||
    flags.needs_accommodation === true
  const hasNarrative = flags.has_medical_narrative === true

  if (!hasAnyFlag && !hasNarrative) return null

  return (
    <div className="flex flex-col gap-1.5">
      {hasAnyFlag && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Power and private bathroom are INDEPENDENT needs. The source
              fields are multi-option, and one option carries both — neither
              flag implies the other. */}
          {flags.needs_private_bathroom === true && (
            <Flag label="Needs private bathroom" icon={Bath} tone={warn} />
          )}
          {flags.needs_power === true && <Flag label="Needs power" icon={Plug} tone={warn} />}
          {/* Housing suitability, not an accessibility need -- neutral tone: it
              informs unit choice (crib space, bathroom proximity, who shares a
              wall) rather than gating it. */}
          {flags.has_infant === true && <Flag label="Infant in party" icon={Baby} tone={neutral} />}
          {flags.needs_accommodation === true && (
            <Flag
              label={mandatory ? 'Accommodation required' : 'Accommodation requested'}
              icon={mandatory ? ShieldAlert : Accessibility}
              tone={mandatory ? blocker : neutral}
            />
          )}
        </div>
      )}

      {hasNarrative && (
        <div className="flex flex-col gap-1">
          {canSeePhi ? (
            // Every household in a real weekend has something on file (62 of
            // 62 in 2026), so this is icon-only: a text link repeated down
            // every row reads as decoration and stops being seen.
            <button
              type="button"
              onClick={() => {
                setRevealed((current) => !current)
              }}
              aria-label={revealed ? 'Hide medical detail' : 'Show medical detail'}
              aria-expanded={revealed}
              title={revealed ? 'Hide medical detail' : 'Show medical detail'}
              className={`hover:bg-muted focus-visible:ring-ring inline-flex w-fit rounded p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                revealed ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="text-muted-foreground text-[11px]">Medical detail on file</span>
          )}

          {revealed && canSeePhi && (
            <div className="bg-muted/40 rounded-md p-2 text-xs">
              {isLoading && (
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading medical detail…
                </span>
              )}
              {error && <span className="text-red-600 dark:text-red-400">{error.message}</span>}
              {data && (
                <dl className="space-y-1">
                  {(
                    [
                      ['CPAP', data.cpap_info],
                      ['Bathroom', data.bathroom_explain],
                      ['Accommodation', data.accommodation_explain],
                      ['Special needs', data.special_needs_info],
                      ['Allergies', data.allergy_info],
                      ['Dietary', data.dietary_info],
                      ['Physician', data.physician_info],
                      ['Additional', data.additional_info],
                    ] as const
                  )
                    .filter(([, value]) => typeof value === 'string' && value.length > 0)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground font-medium">{label}</dt>
                        <dd className="text-foreground">{value}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
