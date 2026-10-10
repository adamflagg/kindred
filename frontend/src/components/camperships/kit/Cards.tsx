import type { ReactNode } from 'react'

import { CS_BAND } from './csType'

/**
 * The kit's figure card (design-language §10; mock `CF.card`): live's Rounds & budget pool card in the kit's language.
 * ONE header row (§5): a caret + title (13.5/700) that folds the card, a muted one-line meta, pills, the figures on the
 * right (muted label + footnote mark, then a tabular value). Under it a 10px bar and a 12px legend; opened, a kit table
 * flush under a rule. A card that opens nothing has no caret. Shapes: the default (live's card), `compact` (a strip
 * card: figures stacked label over value, for AidCards) and `row` (one line, figures in fixed columns).
 * `band` puts a total card in THE green (§9, §10).
 */

export interface CardFigure {
  readonly label: string
  /** The footnote mark (a DefRef). */
  readonly note?: ReactNode
  readonly value: ReactNode
  readonly title?: string | undefined
  readonly testId?: string | undefined
}

const BAND_CARD =
  'border-[color-mix(in_oklab,var(--color-forest-700)_28%,var(--color-border))] dark:border-[color-mix(in_oklab,var(--color-forest-600)_45%,var(--color-border))]'

const HEAD =
  'flex min-h-[26px] min-w-0 items-center gap-2 px-3.5 pt-[7px] text-[13.5px] leading-[20px] whitespace-nowrap'
const META = 'text-muted-foreground min-w-0 flex-[0_1_auto] truncate text-xs leading-4'

function Label({ figure, block }: { figure: CardFigure; block: boolean }) {
  return (
    <span
      className={`text-muted-foreground font-normal ${block ? 'block truncate text-xs leading-4' : 'mr-1'}`}
    >
      {figure.label}
      {figure.note}
    </span>
  )
}

export function AidFoldCard({
  title,
  meta,
  metaTitle,
  pills = [],
  figures = [],
  actions = [],
  shape = 'default',
  band = false,
  open = false,
  onToggle,
  bar,
  legend,
  columns = 3,
  testId,
  children,
}: {
  readonly title: ReactNode
  readonly meta?: ReactNode
  readonly metaTitle?: string | undefined
  readonly pills?: readonly ReactNode[]
  readonly figures?: readonly CardFigure[]
  readonly actions?: readonly ReactNode[]
  readonly shape?: 'default' | 'compact' | 'row'
  readonly band?: boolean
  readonly open?: boolean
  /** Makes the caret + title ONE button that folds the card; without it the title is static. */
  readonly onToggle?: (() => void) | undefined
  readonly bar?: ReactNode
  readonly legend?: ReactNode
  /** Compact: how many figures sit across. */
  readonly columns?: number
  readonly testId?: string | undefined
  /** The opened body (a kit table); drawn only when open. */
  readonly children?: ReactNode
}) {
  const titleNode =
    onToggle === undefined ? (
      <span className="flex-none font-bold">{title}</span>
    ) : (
      <button
        type="button"
        aria-expanded={open}
        className="flex-none cursor-pointer font-bold hover:underline"
        onClick={onToggle}
      >
        <span className="text-muted-foreground inline-block w-3.5 text-[10px] no-underline">
          {open ? '▾' : '▸'}
        </span>
        {title}
      </button>
    )
  const metaNode =
    meta === undefined || meta === '' ? null : (
      <span className={META} title={metaTitle ?? (typeof meta === 'string' ? meta : undefined)}>
        {meta}
      </span>
    )
  const pillNodes = pills.filter(Boolean)
  const actionNodes = actions.filter(Boolean)
  const acts =
    actionNodes.length === 0 ? null : (
      <span className="flex flex-none items-center gap-1.5">{actionNodes}</span>
    )
  const inline = figures.map((f) => (
    <span
      key={f.label}
      data-testid={f.testId}
      title={f.title}
      className="whitespace-nowrap tabular-nums"
    >
      <Label figure={f} block={false} />
      {f.value}
    </span>
  ))
  const barBlock =
    bar === undefined && legend === undefined ? null : (
      <>
        {bar}
        {legend !== undefined && (
          <div className="text-muted-foreground mt-[5px] truncate text-xs leading-4 tabular-nums">
            {legend}
          </div>
        )}
      </>
    )
  let head: ReactNode
  let body: ReactNode = null
  if (shape === 'row') {
    head = (
      <div className="grid grid-cols-[minmax(160px,250px)_minmax(120px,1fr)_170px_170px_180px] items-center gap-x-[18px] px-3.5 py-[7px] text-[13.5px] leading-[20px] whitespace-nowrap">
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          {titleNode}
          {metaNode}
          {pillNodes}
          {acts}
        </span>
        <span className="min-w-0 self-center">{bar}</span>
        {figures.map((f) => (
          <span
            key={f.label}
            data-testid={f.testId}
            title={f.title}
            className="text-right whitespace-nowrap tabular-nums"
          >
            <Label figure={f} block={false} />
            {f.value}
          </span>
        ))}
      </div>
    )
  } else if (shape === 'compact') {
    head = (
      <div className={HEAD}>
        {titleNode}
        {metaNode}
        {pillNodes}
        {acts}
      </div>
    )
    body = (
      <div className="px-3.5 pt-1.5 pb-2">
        {barBlock}
        <div
          className="mt-[7px] grid gap-x-2.5"
          style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
        >
          {figures.map((f) => (
            <div key={f.label} data-testid={f.testId} title={f.title} className="min-w-0">
              <Label figure={f} block />
              <span className="block truncate text-sm leading-5 tabular-nums">{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  } else {
    head = (
      <div className={`${HEAD} ${barBlock === null && !open ? 'pb-[7px]' : ''}`}>
        {titleNode}
        {metaNode}
        {pillNodes}
        {inline.length > 0 && (
          <span className="ml-auto flex flex-none items-baseline gap-3.5">{inline}</span>
        )}
        {acts}
      </div>
    )
    if (barBlock !== null) body = <div className="px-3.5 pt-1.5 pb-[9px]">{barBlock}</div>
  }
  return (
    <section
      data-testid={testId}
      className={`shadow-lodge-sm overflow-hidden rounded-xl border ${
        band ? `${CS_BAND} ${BAND_CARD}` : 'bg-card border-border'
      }`}
    >
      {head}
      {body}
      {open && children !== undefined && (
        <div
          className={`border-t ${band ? BAND_CARD : 'border-border'} [&_tbody_tr:last-child>td]:border-b-0`}
        >
          {children}
        </div>
      )}
    </section>
  )
}

/** A strip of `count` compact cards across (mock `.cf-fcards`). */
export function AidCards({
  count,
  children,
}: {
  readonly count: number
  readonly children: ReactNode
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${String(count)}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

const TRACK = 'bg-[color-mix(in_oklab,var(--color-muted)_85%,var(--color-card))]'
const STRIPES =
  'bg-[repeating-linear-gradient(45deg,var(--color-amber-500)_0_3px,var(--color-amber-300)_3px_6px)]'
/** The season's overage past its total: the one red state. */
const RED_STRIPES =
  'bg-[repeating-linear-gradient(45deg,var(--color-red-600)_0_3px,var(--color-red-300)_3px_6px)] dark:bg-[repeating-linear-gradient(45deg,var(--color-red-400)_0_3px,var(--color-red-800)_3px_6px)]'
/** Round shades (R1 darkest) and pool shades; dark mode lifts them, and Round 3 lifts to a visible dim green inside a card. */
const SWATCH = {
  r1: 'bg-forest-700 dark:bg-forest-400',
  r2: 'bg-forest-500 dark:bg-forest-600',
  r3: 'bg-forest-300 dark:bg-[color-mix(in_oklab,var(--color-forest-400)_42%,var(--color-card))]',
  p0: 'bg-forest-700 dark:bg-forest-400',
  p1: 'bg-forest-400 dark:bg-forest-600',
  p2: 'bg-forest-200 dark:bg-[color-mix(in_oklab,var(--color-forest-400)_42%,var(--color-card))]',
} as const
export type SwatchTone = keyof typeof SWATCH

export interface MeterSegment {
  readonly tone: 'r1' | 'r2' | 'r3' | 'over'
  /** % of the track. */
  readonly left: number
  readonly width: number
}

/** A meter (mock `.cf-meter`): committed against allocated, one fill per round, amber stripes past 100%. */
export function AidMeter({
  segments,
  title,
}: {
  readonly segments: readonly MeterSegment[]
  readonly title?: string | undefined
}) {
  return (
    <span
      title={title}
      className={`relative block h-2.5 min-w-0 overflow-hidden rounded-full ${TRACK}`}
    >
      {segments.map((s) => (
        <i
          key={`${s.tone}-${String(s.left)}`}
          className={`absolute inset-y-0 ${s.tone === 'over' ? STRIPES : SWATCH[s.tone]}`}
          style={{ left: `${String(s.left)}%`, width: `${String(s.width)}%` }}
        />
      ))}
    </span>
  )
}

export interface ShareSegment {
  readonly key: string
  /** Flex-grow: the part's share. */
  readonly grow: number
  /** The fill, 0 to 100 of its own segment. */
  readonly fill: number
  /** Amber stripes at the end, 0 to 100 of its own segment. */
  readonly over: number
  /** `red`: the season's overage segment past its total. */
  readonly tone: 'p0' | 'p1' | 'p2' | 'red'
  readonly title?: string | undefined
}

/** The shares bar (mock `.cf-sbar`): one segment per part, grown by its share; amber stripes past 100%. */
export function AidShareBar({ segments }: { readonly segments: readonly ShareSegment[] }) {
  return (
    <div className="flex h-2.5 gap-[3px]">
      {segments.map((s) => (
        <span
          key={s.key}
          title={s.title}
          className={`relative min-w-1.5 overflow-hidden rounded-full ${TRACK}`}
          style={{ flex: `${String(s.grow)} 1 0` }}
        >
          <i
            className={`absolute inset-y-0 left-0 ${s.tone === 'red' ? RED_STRIPES : SWATCH[s.tone]}`}
            style={{ width: `${String(Math.min(s.fill, 100))}%` }}
          />
          {s.over > 0 && (
            <i
              className={`absolute inset-y-0 right-0 ${STRIPES}`}
              style={{ width: `${String(Math.min(s.over, 100))}%` }}
            />
          )}
        </span>
      ))}
    </div>
  )
}

/** "■ Round 1 $187,277 · ■ Round 2 $8,432" (mock `CF.legend`). */
export function AidLegend({
  items,
}: {
  readonly items: ReadonlyArray<{ readonly swatch?: SwatchTone; readonly label: ReactNode }>
}) {
  return (
    <>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span> · </span>}
          {item.swatch !== undefined && (
            <i className={`mr-1 inline-block size-2 rounded-[2px] ${SWATCH[item.swatch]}`} />
          )}
          <span>{item.label}</span>
        </span>
      ))}
    </>
  )
}
