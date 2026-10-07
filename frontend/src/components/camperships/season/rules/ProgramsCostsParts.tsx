/** Programs and costs' shared pieces: the flow box, the Per person head and formula, a row's name. */
import { CS_META, CS_PILL, CS_SMALL } from '../../kit/csType'
import { columnCount } from './programsCostsFlow'
import type { FlowItem } from './programsCostsLayout'
import type { CardRow } from './programsCostsModel'
import { useFlowColumns } from './useFlowColumns'

export function Flow({
  items,
  width,
  minColumn,
}: {
  items: readonly FlowItem[]
  width: number
  minColumn: number
}) {
  const count = columnCount(width, minColumn)
  const { ref, cut } = useFlowColumns(count)
  const heads = new Set(items.flatMap((item, i) => (item.head ? [i] : [])))
  const columns = cut(
    items.map(() => 1),
    heads
  )
  return (
    <div
      ref={ref}
      className="mt-0.5 grid gap-x-7"
      style={{ gridTemplateColumns: `repeat(${String(count)}, minmax(0, 1fr))` }}
    >
      {columns.map((column, c) => (
        <div key={c} className="min-w-0">
          {column.map((cell) => {
            const item = items[cell.index]
            if (item === undefined) return null
            return (
              <div
                key={`${item.key}${cell.continued ? ':again' : ''}`}
                data-flow-item={cell.index}
                data-flow-continued={cell.continued ? '' : undefined}
              >
                {cell.continued ? (item.repeat ?? item.node) : item.node}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export const PerPersonHead = ({ editing = false }: { editing?: boolean }) => (
  <div
    className={`${CS_META} flex justify-end gap-2 border-b border-[color-mix(in_oklab,var(--border)_55%,transparent)] font-semibold`}
  >
    <span className="mr-auto font-normal">Per person</span>
    <span className={`${editing ? 'min-w-[104px]' : 'min-w-16'} text-right`}>Standard</span>
    <span className={`${editing ? 'min-w-[104px]' : 'min-w-16'} text-right`}>Infant</span>
  </div>
)

/** The per-person formula, once under a group's header (spec §5.2 E); in the editor it carries a muted "read-only". */
export function FormulaLine({
  cutoff,
  readOnlyTag = false,
}: {
  cutoff: number | null | undefined
  readOnlyTag?: boolean
}) {
  return (
    <p className={CS_SMALL}>
      Per person: everyone but infants pays the standard rate, infants the infant rate ·{' '}
      {cutoff == null ? (
        <>
          infant age <b className="text-foreground font-medium">not set</b>
        </>
      ) : (
        <>
          infants are under{' '}
          <b className="text-foreground font-medium">{`${String(cutoff)} months`}</b> on the
          session&apos;s first day
        </>
      )}
      {readOnlyTag && <span className={`${CS_META} ml-1`}>read-only</span>}
    </p>
  )
}

/** The row's name, with its muted tags: the program (where it adds something), minimum only, the lodging board's word. */
export function RowName({ row, tags = true }: { row: CardRow; tags?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      {row.session.name}
      {tags && row.tag !== null && <span className={`${CS_META} ml-1.5`}>{row.tag}</span>}
      {tags && row.minimumOnly && <span className={`${CS_PILL.muted} ml-1.5`}>minimum only</span>}
      {row.cancelledOnBoard && (
        <span className={`${CS_META} ml-1.5`}>cancelled on the lodging board</span>
      )}
    </span>
  )
}
