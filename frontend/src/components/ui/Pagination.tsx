/**
 * Kindred's pager: "1–10 of 42 · Rows per page [10]" on the left, previous /
 * page numbers / next on the right. First built for the Audit Log (mockup v8),
 * kept generic: the labels for the two ends and the rows-per-page choices are
 * props, and it renders nothing when there is nothing to page.
 *
 * Buttons are the secondary button (lodgingStyles.ts BUTTON_SECONDARY), sized
 * down; the current page takes the primary fill.
 */
import { BAR, PAGE_BUTTON, PAGER_BUTTON, PAGER_BUTTON_CURRENT, pageWindow } from './paginationParts'

export interface PaginationProps {
  page: number
  perPage: number
  total: number
  perPageOptions: readonly number[]
  onPageChange: (page: number) => void
  onPerPageChange: (perPage: number) => void
  previousLabel?: string
  nextLabel?: string
}

export function Pagination({
  page,
  perPage,
  total,
  perPageOptions,
  onPageChange,
  onPerPageChange,
  previousLabel = '← Previous',
  nextLabel = 'Next →',
}: PaginationProps) {
  if (total <= 0) return null
  const pages = Math.max(1, Math.ceil(total / perPage))
  const current = Math.min(Math.max(1, page), pages)
  const first = (current - 1) * perPage + 1
  const last = Math.min(current * perPage, total)

  return (
    <div className={BAR} data-testid="pagination">
      <span className="flex items-center gap-1.5">
        {`${String(first)}–${String(last)} of ${String(total)}`}
        <span>·</span>
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="bg-background border-border rounded-lg border px-1.5 py-1 text-sm font-medium"
          >
            {perPageOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={PAGER_BUTTON}
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          {previousLabel}
        </button>
        {pageWindow(current, pages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${String(i)}`} className="px-1">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={p === current ? PAGER_BUTTON_CURRENT : PAGE_BUTTON}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className={PAGER_BUTTON}
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
        >
          {nextLabel}
        </button>
      </span>
    </div>
  )
}
