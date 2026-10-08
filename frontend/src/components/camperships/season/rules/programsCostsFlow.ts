/**
 * Programs and costs' column flow (spec §5.2 F; programs-costs-v3's packCols / layoutFlows, ported). A group's lines
 * are cut into at most n columns at the lowest height that fits, found by binary search. A label (a sub-section's, or
 * the per-person column head) is kept with its next line, and a column that carries its run on starts with the label
 * again, marked continued. Pure, so it is tested on heights; `useFlowColumns` measures the DOM.
 */
export interface FlowCell {
  readonly index: number
  readonly continued: boolean
}

// An edit row: checkbox, name, group pick and (one line, or per person one line each) ‹old› → $ box.
export const MIN_COLUMN = { read: 250, edit: 400, editPerPerson: 360 } as const
const GAP = 28

export function columnCount(width: number, minColumn: number): number {
  return Math.max(1, Math.min(4, Math.floor((width + GAP) / (minColumn + GAP))))
}

function pack(
  heights: readonly number[],
  heads: ReadonlySet<number>,
  repeat: (head: number) => number,
  limit: number
): FlowCell[][] {
  const cols: FlowCell[][] = [[]]
  let used = 0
  let head: number | null = null
  heights.forEach((h, i) => {
    const isHead = heads.has(i)
    const need = h + (isHead && i + 1 < heights.length ? (heights[i + 1] ?? 0) : 0)
    if (used > 0 && used + need > limit + 0.5) {
      cols.push([])
      used = 0
      if (!isHead && head !== null) {
        cols[cols.length - 1]?.push({ index: head, continued: true })
        used += repeat(head)
      }
    }
    if (isHead) head = i
    cols[cols.length - 1]?.push({ index: i, continued: false })
    used += h
  })
  return cols
}

export function flowColumns(
  heights: readonly number[],
  heads: ReadonlySet<number>,
  n: number,
  repeat: (head: number) => number = (i) => heights[i] ?? 0
): FlowCell[][] {
  if (heights.length === 0) return []
  let lo = Math.max(
    0,
    ...heights.map(
      (h, i) => h + (heads.has(i) && i + 1 < heights.length ? (heights[i + 1] ?? 0) : 0)
    )
  )
  let hi = heights.reduce((a, b) => a + b, 0) + [...heads].reduce((a, i) => a + repeat(i), 0)
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2
    if (pack(heights, heads, repeat, mid).length <= n) hi = mid
    else lo = mid
  }
  return pack(heights, heads, repeat, hi)
}
