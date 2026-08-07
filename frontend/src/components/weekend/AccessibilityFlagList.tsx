/**
 * Housing needs as alert rows.
 *
 * Rendered in the same grammar as `CamperAlertSection` on the summer side —
 * icon, label, severity-tinted row — so a need reads the same wherever staff
 * meet one. Severity ordering is fixed: red before amber before neutral.
 *
 * Presentational, with no data access of its own. It used to also carry the
 * medical narrative behind a permission-checked reveal; kindred#1889 moved
 * that to `MedicalNarrative`, which only `FamilyDetailsPanel` renders. This
 * component appears once per roster row, 62 to a page, so keeping it free of
 * the PHI hook is what stops a later change from making 62 gated requests.
 */
import { Accessibility, Baby, Bath, Plug, ShieldAlert } from 'lucide-react'

import type { AccessibilityFlags } from '../../types/lodging'

export interface AccessibilityFlagListProps {
  flags: AccessibilityFlags
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

export function AccessibilityFlagList({ flags }: AccessibilityFlagListProps) {
  const mandatory = flags.accommodation_is_mandatory === true

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

  if (needs.length === 0) return null

  return (
    // NOT redundant: Tailwind Preflight sets list-style: none on every <ul>, which strips the
    // implicit `list` role in Safari's a11y tree unless role="list" is explicit. See
    // CamperAlertSection.tsx for the same pattern.
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <ul className="space-y-1" role="list">
      {needs.map((need) => (
        <NeedRow key={need.key} label={need.label} icon={need.icon} tone={need.tone} />
      ))}
    </ul>
  )
}
