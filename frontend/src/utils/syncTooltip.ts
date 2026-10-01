import type { SyncStatus } from '../hooks/useSyncStatusAPI'

/** A freshness chip's tooltip: the run's absolute time, status and counts (#1706). */
export function buildSyncTooltip(kind: string, status: SyncStatus): string {
  const parts = [`Last ${kind} sync`]
  if (status.end_time) {
    parts.push(new Date(status.end_time).toISOString())
  }
  if (status.status) {
    parts.push(`status: ${status.status}`)
  }
  const s = status.summary
  if (s) {
    parts.push(
      `created ${s.created}, updated ${s.updated}, skipped ${s.skipped}, errors ${s.errors}`
    )
  }
  return parts.join(' • ')
}
