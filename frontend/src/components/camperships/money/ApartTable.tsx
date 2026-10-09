import { Fragment, type ReactNode } from 'react'

import { CELL_BG, TABLE, TABLE_CARD, TD, TH } from '../kit/kitStyles'

export interface ApartColumn<Row> {
  readonly key: string
  readonly header: string
  readonly width?: number
  readonly align?: 'right'
  /** A header that explains itself: its words as a native title (§13). */
  readonly help?: string
  readonly render: (row: Row) => ReactNode
  /** The cell's native title; a cut cell always carries its full words (§13). */
  readonly title?: (row: Row) => string | undefined
}

/**
 * A short, plain table for what To place sets apart (Left at family level, Reclassified): the kit's
 * card, header and cell grammar (§7–8) with no sorting, search or highlight, and a detail row under
 * a line (Reopen…'s editor).
 */
export function ApartTable<Row>({
  columns,
  rows,
  rowKey,
  detail,
}: {
  columns: ReadonlyArray<ApartColumn<Row>>
  rows: readonly Row[]
  rowKey: (row: Row) => string
  /** What to draw in a row under this one, or null for none. */
  detail?: (row: Row) => ReactNode
}) {
  return (
    <div className={TABLE_CARD}>
      <table className={TABLE}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width === undefined ? undefined : { width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.help}
                className={`${TH.replace('whitespace-normal', 'whitespace-nowrap')} ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const more = detail?.(row) ?? null
            return (
              <Fragment key={rowKey(row)}>
                <tr>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      title={c.title?.(row)}
                      className={`${TD} ${CELL_BG} whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {more !== null && (
                  <tr>
                    <td colSpan={columns.length} className={`${TD} ${CELL_BG} whitespace-normal`}>
                      {more}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
