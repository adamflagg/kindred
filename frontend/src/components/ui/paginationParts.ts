/**
 * The pager's classes and page-number window, apart from Pagination.tsx so that
 * file exports only its component (react-refresh/only-export-components).
 */

/** Where the pager sits in a card: a rule above, the card's muted text. */
export const BAR =
  'border-border text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2.5 text-sm'
export const PAGER_BUTTON =
  'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent'
export const PAGER_BUTTON_CURRENT =
  'bg-primary text-primary-foreground border-primary inline-flex min-w-[30px] items-center justify-center rounded-lg border px-2 py-1.5 text-sm font-semibold'
export const PAGE_BUTTON = `${PAGER_BUTTON} min-w-[30px] px-2`

/**
 * The page numbers to show: all of them up to seven pages, otherwise the first,
 * the last and the current page's neighbours, with a gap marker between runs.
 */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: Array<number | 'gap'> = []
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1]
    if (prev !== undefined && p - prev > 1) out.push('gap')
    out.push(p)
  })
  return out
}
