export interface PartialResolveSummary {
  unassigned_count: number
  cross_boundary_request_count: number
}

/** Build the completion-summary toast lines for a partial cabin re-solve (#1609).
 *  Returns one line per non-zero count; empty array when nothing to report. */
export function partialResolveToastMessages(summary: PartialResolveSummary | undefined): string[] {
  if (!summary) return []
  const lines: string[] = []
  if (summary.unassigned_count > 0) {
    const n = summary.unassigned_count
    lines.push(`${n} camper${n === 1 ? '' : 's'} left unassigned — no room in the unlocked cabins`)
  }
  if (summary.cross_boundary_request_count > 0) {
    const m = summary.cross_boundary_request_count
    lines.push(`${m} request${m === 1 ? '' : 's'} couldn't be met — target is in a locked cabin`)
  }
  return lines
}
