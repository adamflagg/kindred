import { RefreshCw, Upload } from 'lucide-react'

import { formatAgo } from '../utils/formatAgo'

/**
 * One freshness chip on the secondary bar, the same grammar for summer, weekend and Camperships:
 * "<noun> synced 18h ago" or "<noun> uploaded 3d ago". The icon repeats the verb — refresh for a
 * CampMinder sync, upload for a CSV — because the two are deliberately distinct (kindred#2570: a job
 * that RAN is not text that ARRIVED). Grey, unless `warn` says the sync is behind; the absolute time in
 * the tooltip (#1706).
 */
export function FreshnessChip({
  noun,
  verb,
  at,
  title,
  suffix,
  warn = false,
}: {
  noun: string
  verb: 'synced' | 'uploaded'
  at: string
  title: string
  /** Words after the age, inside the same chip (Analytics' " · syncing now"). */
  suffix?: string
  /** Amber: the sync is behind (Analytics' enrollments past 2 hours, PR 5b ruling #111). */
  warn?: boolean
}) {
  const Icon = verb === 'synced' ? RefreshCw : Upload
  return (
    <span
      className={
        warn
          ? 'flex items-center gap-1.5 whitespace-nowrap text-amber-600 dark:text-amber-400'
          : 'flex items-center gap-1.5 whitespace-nowrap'
      }
      title={title}
    >
      <Icon className="h-3 w-3" />
      {noun} {verb} {formatAgo(at)}
      {suffix}
    </span>
  )
}
