import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router'

import {
  STRIP,
  STRIP_BADGE,
  STRIP_BADGE_ON,
  REQ_LENS,
  STRIP_COUNT_AMBER,
  STRIP_COUNT_LENS,
  STRIP_COUNT_PICKED,
  STRIP_COUNT_PLAIN,
  STRIP_EXCEPTIONS,
  STRIP_LENSES,
  STRIP_MEASURE,
  STRIP_PIPE,
  STRIP_SEG,
} from '../kit/kitStyles'
import { FoldedBadges } from './FoldedBadges'
import {
  BADGE_TITLES,
  badgeTone,
  foldTone,
  lensTitle,
  PIPELINE_STAGES,
  shownBadges,
  stageTitle,
  type RequestLens,
} from './strip'
import { useBadgeFold } from './useBadgeFold'
import { REQUEST_VIEWS, type RequestView, type RequestViewKey, type ViewCount } from './views'

const LENSES: ReadonlyArray<{ readonly lens: RequestLens; readonly label: string }> = [
  { lens: 'all', label: 'All' },
  { lens: 'appeals', label: 'Appeals' },
]

/** Watched, not to do (rv=todo): the family has it, so its chevron and count stay muted. */
const WATCHED: ReadonlySet<RequestViewKey> = new Set(['waiting_on_family'])

function viewOf(key: RequestViewKey): RequestView {
  const view = REQUEST_VIEWS.find((v) => v.key === key)
  if (view === undefined) throw new Error(`No request view ${key}`)
  return view
}

/** The stage keys whose count the mock pills amber whatever it reads (`.stg.amber`). */
const AMBER_STAGES: ReadonlySet<RequestViewKey> = new Set(['not_reconciled'])

/**
 * A count (mock `.n`): a lens's reads in the lens's ink; a chevron's is plain muted, except the
 * picked stage's (amber-400 pill) and Not reconciled's (the amber pill, even at 0).
 */
function Count({
  count,
  kind,
}: {
  count: ViewCount | undefined
  kind: 'lens' | 'plain' | 'amber' | 'picked'
}) {
  const className =
    kind === 'lens'
      ? STRIP_COUNT_LENS
      : kind === 'picked'
        ? STRIP_COUNT_PICKED
        : kind === 'amber'
          ? STRIP_COUNT_AMBER
          : STRIP_COUNT_PLAIN
  return <i className={className}>{count === undefined ? '—' : count.requests}</i>
}

/**
 * The views strip (slice 1 grid layout T4; grid-layout-options.html v=f, ls=b, po=b, rv=todo,
 * ap=lens): the lenses (All, Appeals) on the left narrow every count; the pipeline runs left to
 * right per round; the exception badges on the right block a request at any stage, each drawn only
 * while something is in it or it is picked, the trailing ones folding into a +N chip when the line
 * is full (owner 2026-10-04). Every count is a link (D15, D20). `onOpen` lets the page save what is typed first (Decision 4); a modified click
 * still opens a new tab.
 */
export function RequestViewNav({
  lens,
  stage,
  counts,
  lensCounts,
  hrefOf,
  lensHrefOf,
  onOpen,
}: {
  lens: RequestLens
  /** The chevron or badge picked; null: the lens alone. */
  stage: RequestViewKey | null
  /** Each stage's count under the lens; null while the grid loads. */
  counts: ReadonlyMap<RequestViewKey, ViewCount> | null
  lensCounts: ReadonlyMap<RequestLens, ViewCount> | null
  hrefOf: (view: RequestView) => string
  lensHrefOf: (lens: RequestLens) => string
  onOpen?: ((href: string) => void) | undefined
}) {
  const open = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (onOpen === undefined || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onOpen(href)
  }
  const to = (
    key: string,
    href: string,
    className: string,
    state: 'on' | 'lens' | undefined,
    body: ReactNode,
    title: string
  ) => (
    <Link
      key={key}
      to={href}
      onClick={open(href)}
      className={className}
      data-state={state}
      title={title}
    >
      {body}
    </Link>
  )

  const badges = shownBadges(stage, counts)
  const said = (key: RequestViewKey) => {
    const count = counts?.get(key)
    return { view: viewOf(key), count, tone: badgeTone(key, count) }
  }
  const { navRef, lensesRef, pipeRef, groupRef, measureRef, shown } = useBadgeFold(
    badges.map((key) => `${key}:${String(counts?.get(key)?.requests ?? '-')}`).join('|')
  )
  const onLine = shown === null ? badges : badges.slice(0, shown)
  const folded = shown === null ? [] : badges.slice(shown)
  const badge = (key: RequestViewKey) => {
    const { view, count, tone } = said(key)
    const on = key === stage
    return to(
      key,
      hrefOf(view),
      on ? `${STRIP_BADGE[tone]} ${STRIP_BADGE_ON}` : STRIP_BADGE[tone],
      on ? 'on' : undefined,
      <>
        {view.label} <i>{count === undefined ? '—' : count.requests}</i>
      </>,
      BADGE_TITLES[key] ?? view.label
    )
  }

  return (
    <div>
      <nav ref={navRef} className={STRIP}>
        <span ref={lensesRef} className={STRIP_LENSES} data-testid="strip-lenses">
          {LENSES.map(({ lens: key, label }) => {
            const picked = key === lens
            const filled = picked && stage === null
            return to(
              key,
              lensHrefOf(key),
              picked ? REQ_LENS.on : REQ_LENS.idle,
              filled ? 'on' : picked ? 'lens' : undefined,
              <>
                {label} <Count count={lensCounts?.get(key)} kind="lens" />
              </>,
              lensTitle(key)
            )
          })}
        </span>
        <span ref={pipeRef} className={STRIP_PIPE} data-testid="strip-pipeline">
          {PIPELINE_STAGES.map((key) => {
            const view = viewOf(key)
            const on = key === stage
            const watched = WATCHED.has(key)
            const kind = on ? 'picked' : AMBER_STAGES.has(key) ? 'amber' : 'plain'
            return to(
              key,
              hrefOf(view),
              on ? STRIP_SEG.on : watched ? STRIP_SEG.watch : STRIP_SEG.todo,
              on ? 'on' : undefined,
              <>
                {view.label} <Count count={counts?.get(key)} kind={kind} />
              </>,
              stageTitle(view.label)
            )
          })}
        </span>
        <span ref={groupRef} className={STRIP_EXCEPTIONS} data-testid="strip-exceptions">
          {onLine.map(badge)}
          {folded.length > 0 && (
            <FoldedBadges
              count={folded.length}
              tone={foldTone(folded, counts)}
              on={stage !== null && folded.includes(stage)}
            >
              {folded.map(badge)}
            </FoldedBadges>
          )}
        </span>
        {/* Every shown badge at its natural width, and the chip at its widest, for useBadgeFold. */}
        <span ref={measureRef} className={STRIP_MEASURE}>
          {badges.map((key) => {
            const { view, count, tone } = said(key)
            return (
              <span key={key} data-measure="badge" className={STRIP_BADGE[tone]}>
                {view.label} <i>{count === undefined ? '—' : count.requests}</i>
              </span>
            )
          })}
          <span data-measure="chip" className={STRIP_BADGE.red}>
            +{badges.length}
          </span>
        </span>
      </nav>
    </div>
  )
}
