import type { AidColumn } from './AidTable'
import { CS_ROW_BTN } from './csType'

/** One row's action: its Title Case words (ending "…" when it opens something), what it does, and its title. */
export interface AidRowActionSpec {
  readonly label: string
  readonly onClick: () => void
  readonly title?: string | undefined
  readonly disabled?: boolean | undefined
}

/**
 * A row's own action in a grid cell (design-language rule 20): the 20px `CS_ROW_BTN`, so the row keeps the grid's
 * 30px. The click is also a click on the row, so the row opens; the page draws the editor in its detail line.
 */
export function AidRowAction({ label, onClick, title, disabled }: AidRowActionSpec) {
  return (
    <button
      type="button"
      className={CS_ROW_BTN}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/**
 * The action column (rule 20): no header words, no sort, not in the CSV. `action` returns null on a row with
 * nothing to do, which draws an empty cell (never the grid's dash). It may return two actions (Form intake's Link… ·
 * Ignore…): both row buttons, side by side, the cell titled with both.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a column factory, kept beside the button it draws
export function aidActionColumn<Row>({
  key = 'action',
  width,
  action,
}: {
  readonly key?: string
  readonly width?: number | undefined
  readonly action: (row: Row) => AidRowActionSpec | readonly AidRowActionSpec[] | null
}): AidColumn<Row> {
  const specs = (row: Row): readonly AidRowActionSpec[] => {
    const spec = action(row)
    return spec === null ? [] : 'label' in spec ? [spec] : spec
  }
  return {
    key,
    header: '',
    width,
    sortable: false,
    inCsv: false,
    value: () => '',
    title: (row) => {
      const titles = specs(row)
        .map((s) => s.title)
        .filter((t): t is string => t !== undefined)
      return titles.length === 0 ? undefined : titles.join(' · ')
    },
    render: (row) => {
      const list = specs(row)
      if (list.length === 0) return ''
      if (list.length === 1 && list[0] !== undefined) return <AidRowAction {...list[0]} />
      return (
        <span className="inline-flex gap-1">
          {list.map((s) => (
            <AidRowAction key={s.label} {...s} />
          ))}
        </span>
      )
    },
  }
}
