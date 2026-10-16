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
 * nothing to do, which draws an empty cell (never the grid's dash).
 */
// eslint-disable-next-line react-refresh/only-export-components -- a column factory, kept beside the button it draws
export function aidActionColumn<Row>({
  key = 'action',
  width,
  action,
}: {
  readonly key?: string
  readonly width?: number | undefined
  readonly action: (row: Row) => AidRowActionSpec | null
}): AidColumn<Row> {
  return {
    key,
    header: '',
    width,
    sortable: false,
    inCsv: false,
    value: () => '',
    title: (row) => action(row)?.title,
    render: (row) => {
      const spec = action(row)
      return spec === null ? '' : <AidRowAction {...spec} />
    },
  }
}
