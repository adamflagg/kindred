import type { RetentionTrendYear } from '../../types/metrics'

export interface ChartDataItem {
  name: string
  transition: string
  /** The final rate; null for the live year, which is not drawn on the finals line (#89). */
  retentionRate: number | null
  /** The rate at the same registration day, percent; the live year's is today's. */
  samePoint: number | null
  baseCount: number
  returnedCount: number
}

/**
 * Points labelled by the year campers returned into (a ruled call, #3207 PR 11; it read the base
 * year before). While live, the newest is "so far" and sits on the dashed line only.
 */
export function retentionLineData(data: RetentionTrendYear[], live: boolean): ChartDataItem[] {
  const newest = Math.max(0, ...data.map((y) => y.to_year))
  return data.map((year) => {
    const isLive = live && year.to_year === newest
    return {
      name: isLive ? `${year.to_year} so far` : year.to_year.toString(),
      transition: `${year.from_year} → ${year.to_year}`,
      retentionRate: isLive ? null : year.retention_rate * 100,
      samePoint: live && year.same_point_rate != null ? year.same_point_rate * 100 : null,
      baseCount: year.base_count,
      returnedCount: year.returned_count,
    }
  })
}
