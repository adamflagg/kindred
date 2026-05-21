/**
 * CamperAlertSection — mirrors bunking-board camper card alerts in the
 * CamperDetailsPanel sidebar, rendered above the requests section.
 *
 * Alert catalog (sourced from CamperCard.tsx):
 *
 * | ID                   | Icon            | Label                              | Severity | Request-related |
 * |----------------------|-----------------|------------------------------------|----------|-----------------|
 * | unsatisfied-requests | orange triangle | "Has N requests, none satisfied"   | yellow   | YES → clickable |
 * | friend-group         | lock icon       | "In friend group (N members)"      | blue     | NO → plain row  |
 *
 * Severity ordering (fixed): red → yellow → blue
 */
import { AlertTriangle, Lock, AlertCircle } from 'lucide-react'

// Stage 2 parent-paramount: 'orange' for parent-unsatisfied (was 'yellow'),
// 'amber' for staff-unsatisfied. 'yellow' kept for backwards compat with any
// callers not yet migrated.
export type AlertSeverity = 'red' | 'yellow' | 'blue' | 'orange' | 'amber'

export interface CamperAlert {
  id: string
  severity: AlertSeverity
  label: string
  /** If true, clicking the row opens the manage-all-requests modal */
  requestRelated: boolean
}

interface CamperAlertSectionProps {
  alerts: CamperAlert[]
  /** Called when a request-related alert row is clicked */
  onRequestAlertClick: () => void
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
  amber: 3,
  blue: 4,
}

function alertIcon(alert: CamperAlert) {
  switch (alert.id) {
    case 'unsatisfied-requests':
    case 'unsatisfied-parent-requests':
      return (
        <AlertTriangle
          className="h-4 w-4 flex-shrink-0 text-orange-500 dark:text-orange-400"
          aria-hidden="true"
        />
      )
    case 'unsatisfied-staff-requests':
      return (
        <AlertCircle
          className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400"
          aria-hidden="true"
        />
      )
    case 'friend-group':
      return (
        <Lock className="h-4 w-4 flex-shrink-0 text-sky-500 dark:text-sky-400" aria-hidden="true" />
      )
    default:
      // Generic fallback per severity
      return (
        <AlertCircle
          className={`h-4 w-4 flex-shrink-0 ${
            alert.severity === 'red'
              ? 'text-red-500 dark:text-red-400'
              : alert.severity === 'orange' || alert.severity === 'yellow'
                ? 'text-orange-500 dark:text-orange-400'
                : alert.severity === 'amber'
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-sky-500 dark:text-sky-400'
          }`}
          aria-hidden="true"
        />
      )
  }
}

function rowColorClasses(severity: AlertSeverity): string {
  switch (severity) {
    case 'red':
      return 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
    case 'orange':
      return 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
    case 'yellow':
      return 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
    case 'amber':
      return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
    case 'blue':
      return 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
  }
}

export function CamperAlertSection({ alerts, onRequestAlertClick }: CamperAlertSectionProps) {
  if (alerts.length === 0) return null

  const sorted = alerts.toSorted((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return (
    <section aria-label="Alerts" className="space-y-1">
      <ul className="space-y-1" role="list">
        {sorted.map((alert) => {
          const icon = alertIcon(alert)
          const colorClasses = rowColorClasses(alert.severity)
          const baseClasses = `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${colorClasses}`

          if (alert.requestRelated) {
            return (
              <li key={alert.id}>
                <button
                  type="button"
                  aria-label={alert.label}
                  onClick={onRequestAlertClick}
                  className={`${baseClasses} w-full text-left transition-opacity hover:opacity-80`}
                >
                  {icon}
                  <span>{alert.label}</span>
                </button>
              </li>
            )
          }

          return (
            <li key={alert.id}>
              <div className={baseClasses}>
                {icon}
                <span>{alert.label}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
