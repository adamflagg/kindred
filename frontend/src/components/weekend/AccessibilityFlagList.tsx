/**
 * Housing needs, with the medical narrative behind an explicit
 * permission-checked reveal (spec §5).
 *
 * Rendered as alert rows in the same grammar as `CamperAlertSection` on the
 * summer side — icon, label, severity-tinted row — so a need reads the same
 * wherever staff meet one. Severity ordering is fixed: red before amber
 * before neutral.
 *
 * The API is the real boundary — /api/lodging/households/{id}/medical
 * requires `lodging.phi` and 403s otherwise. This UI gate exists so a user
 * who cannot see the narrative is not shown a button that always fails.
 * `lodging.phi` is currently granted to NO role, so admin bypass is the only
 * route that reaches the narrative in practice; a failed reveal therefore
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

type Tone = 'red' | 'amber' | 'neutral'

const TONE_ROW: Record<Tone, string> = {
  red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
  amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
  neutral: 'bg-muted/50 dark:bg-muted/30 text-foreground',
}

const TONE_ICON: Record<Tone, string> = {
  red: 'text-red-500 dark:text-red-400',
  amber: 'text-amber-500 dark:text-amber-400',
  neutral: 'text-muted-foreground',
}

function NeedRow({ label, icon: Icon, tone }: { label: string; icon: typeof Bath; tone: Tone }) {
  return (
    <li className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${TONE_ROW[tone]}`}>
      <Icon className={`h-4 w-4 flex-shrink-0 ${TONE_ICON[tone]}`} aria-hidden="true" />
      <span>{label}</span>
    </li>
  )
}

export function AccessibilityFlagList({ flags, householdCmId, year }: AccessibilityFlagListProps) {
  const { hasPermission } = usePermissions()
  const [revealed, setRevealed] = useState(false)
  const canSeePhi = hasPermission(Permission.LODGING_PHI)
  const { data, isLoading, error } = useHouseholdMedical(year, householdCmId, revealed && canSeePhi)

  const mandatory = flags.accommodation_is_mandatory === true
  const hasNarrative = flags.has_medical_narrative === true

  const needs: Array<{ key: string; label: string; icon: typeof Bath; tone: Tone }> = []
  if (flags.needs_accommodation === true) {
    needs.push({
      key: 'accommodation',
      label: mandatory ? 'Accommodation required' : 'Accommodation requested',
      icon: mandatory ? ShieldAlert : Accessibility,
      tone: mandatory ? 'red' : 'neutral',
    })
  }
  // Power and private bathroom are INDEPENDENT needs. The source fields are
  // multi-option and one option carries both — neither implies the other.
  if (flags.needs_private_bathroom === true) {
    needs.push({ key: 'bathroom', label: 'Private bathroom', icon: Bath, tone: 'amber' })
  }
  if (flags.needs_power === true) {
    needs.push({ key: 'power', label: 'Power', icon: Plug, tone: 'amber' })
  }
  // Housing suitability, not a request: it informs which cabin suits them
  // (crib space, bathroom proximity, who shares a wall) rather than gating it.
  if (flags.has_infant === true) {
    needs.push({ key: 'infant', label: 'Infant in party', icon: Baby, tone: 'neutral' })
  }

  if (needs.length === 0 && !hasNarrative) return null

  return (
    <div className="flex flex-col gap-1.5">
      {needs.length > 0 && (
        <ul className="space-y-1" role="list">
          {needs.map((need) => (
            <NeedRow key={need.key} label={need.label} icon={need.icon} tone={need.tone} />
          ))}
        </ul>
      )}

      {hasNarrative && (
        <div className="flex flex-col gap-1">
          {canSeePhi ? (
            // Every household in a real weekend has something on file (62 of
            // 62 in 2026), so this is a quiet icon: a text link repeated down
            // every row reads as decoration and stops being seen.
            <button
              type="button"
              onClick={() => {
                setRevealed((current) => !current)
              }}
              aria-label={revealed ? 'Hide medical detail' : 'Show medical detail'}
              aria-expanded={revealed}
              title={revealed ? 'Hide medical detail' : 'Show medical detail'}
              className={`hover:bg-muted focus-visible:ring-ring inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                revealed ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="h-3.5 w-3.5 flex-shrink-0" />
              Medical
            </button>
          ) : (
            <span className="text-muted-foreground px-2 text-xs">Medical detail on file</span>
          )}

          {revealed && canSeePhi && (
            <div className="rounded-r-lg border-l-2 border-red-400 bg-red-50/60 px-3 py-2 text-sm text-red-900 dark:border-red-500/60 dark:bg-red-900/20 dark:text-red-200">
              {isLoading && (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading medical detail…
                </span>
              )}
              {error && <span>{error.message}</span>}
              {data && (
                <dl className="space-y-1.5">
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
                        <dt className="text-xs font-bold tracking-wider uppercase opacity-70">
                          {label}
                        </dt>
                        <dd className="whitespace-pre-wrap">{value}</dd>
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
