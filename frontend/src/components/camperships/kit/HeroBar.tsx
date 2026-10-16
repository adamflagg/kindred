import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { CS_HERO_CARD, CS_HERO_FIG, CS_HERO_TITLE, CS_SMALL } from './csType'

/** Design-language section 13 "The hero bar": the one bold element on Today. The fills use the kit's forest, amber,
 *  stone and sky scales; `est` is the hatch for the one estimate (on hold, at what was asked) and `over` the amber
 *  hatch past the budget marker. Dark mode takes the kit's dark pairs. */
export type HeroTone =
  | 'done'
  | 'progress'
  | 'light'
  | 'act'
  | 'act2'
  | 'mute'
  | 'est'
  | 'over'
  | 'gap'
  | 'sky0'
  | 'sky1'
  | 'sky2'
  | 'sky3'
  | 'sky4'
  | 'sky5'

const FILL: Record<HeroTone, string> = {
  done: 'bg-forest-700 text-white dark:bg-forest-500',
  progress: 'bg-forest-500 text-white dark:bg-forest-600',
  light: 'bg-forest-300 text-forest-950 dark:bg-forest-700 dark:text-white',
  act: 'bg-amber-500 text-amber-950',
  act2: 'bg-amber-300 text-amber-950',
  mute: 'bg-stone-300 text-foreground dark:bg-stone-600',
  est: 'bg-[repeating-linear-gradient(135deg,var(--color-forest-300)_0_6px,var(--color-forest-200)_6px_12px)] text-forest-900',
  over: 'bg-[repeating-linear-gradient(45deg,var(--color-amber-500)_0_5px,var(--color-amber-300)_5px_10px)] text-amber-950',
  gap: 'bg-transparent text-muted-foreground font-semibold',
  sky0: 'bg-sky-800 text-white',
  sky1: 'bg-sky-700 text-white',
  sky2: 'bg-sky-600 text-white',
  sky3: 'bg-sky-500 text-white',
  sky4: 'bg-sky-400 text-sky-950',
  sky5: 'bg-sky-200 text-sky-950',
}
const SWATCH: Record<HeroTone, string> = { ...FILL, gap: 'bg-muted' }

export interface HeroSegment {
  readonly key: string
  /** Its amount: the key row's, and its size on the bar unless `drawn` says otherwise; 0 is drawn nowhere. */
  readonly value: number
  /** Its size on the bar when that differs from `value`: an over-budget bar draws spending up to the allocation and
   *  the overrun once, in its own segment (final check S3). The key row keeps `value`. */
  readonly drawn?: number
  /** The key row's words, e.g. "Need an offer". */
  readonly label: string
  /** The key row's bold figure, e.g. "31" or "$125k". */
  readonly figure: string
  /** Words inside the segment; default the figure. */
  readonly inner?: string
  readonly tone: HeroTone
  /** Waits on the viewer: amber key label. */
  readonly mine?: boolean
  /** Native title; default "{label}: {figure}". */
  readonly title?: string
  /** The door. */
  readonly href?: string
  /** Text ink for the words inside the segment, e.g. a delta token on Analytics › Today's shortfall. */
  readonly ink?: string
}

export function AidHeroBar({
  segments,
  total,
  marker,
  compact = false,
  mid = false,
  reveal = false,
  labelMinPct = 6,
}: {
  readonly segments: readonly HeroSegment[]
  readonly total?: number
  readonly marker?: { readonly at: number; readonly title: string }
  readonly compact?: boolean
  /** The 26px bar (the development funder bar), between compact and the full 34px. */
  readonly mid?: boolean
  readonly reveal?: boolean
  readonly labelMinPct?: number
}) {
  const size = (s: HeroSegment) => s.drawn ?? s.value
  const live = segments.filter((s) => size(s) > 0)
  const sum = total ?? live.reduce((a, s) => a + size(s), 0)
  return (
    <div
      data-reveal={reveal ? 'true' : undefined}
      className={`bg-muted relative flex overflow-hidden ${compact ? 'h-2.5 rounded-full' : mid ? 'mt-1 h-[26px] rounded-lg' : 'mt-2.5 h-[34px] rounded-lg'} ${reveal ? 'motion-safe:animate-[cs-hero-reveal_900ms_cubic-bezier(.2,.7,.2,1)_both]' : ''}`}
    >
      {live.map((s) => {
        const pct = sum > 0 ? (size(s) / sum) * 100 : 0
        const words = !compact && pct > labelMinPct ? (s.inner ?? s.figure) : ''
        const cls = `border-card flex min-w-1 items-center justify-center overflow-hidden border-r-2 text-[12.5px] font-bold whitespace-nowrap tabular-nums last:border-r-0 ${FILL[s.tone]}${s.ink ? ` ${s.ink}` : ''}`
        const style = { flexGrow: size(s), flexShrink: 1, flexBasis: 0 }
        const title = s.title ?? `${s.label}: ${s.figure}`
        return s.href ? (
          <Link
            key={s.key}
            to={s.href}
            data-testid="hero-seg"
            className={`${cls} hover:brightness-110`}
            style={style}
            title={title}
          >
            {words}
          </Link>
        ) : (
          <span key={s.key} data-testid="hero-seg" className={cls} style={style} title={title}>
            {words}
          </span>
        )
      })}
      {marker && sum > 0 ? (
        <span
          data-testid="hero-marker"
          title={marker.title}
          className="border-foreground/60 pointer-events-none absolute -top-1 -bottom-1 border-l-2 border-dashed"
          style={{ left: `${String((marker.at / sum) * 100)}%` }}
        />
      ) : null}
    </div>
  )
}

/** Past about this many characters a key's label is cut (about 260px at 12.5px). */
const KEY_LABEL_CHARS = 40

export function AidHeroKeys({ segments }: { readonly segments: readonly HeroSegment[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] leading-[18px]">
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span
            key={s.key}
            data-testid="hero-key"
            title={s.title ?? s.label}
            className={`whitespace-nowrap ${s.mine ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-foreground'}`}
          >
            <i className={`mr-1.5 inline-block size-[9px] rounded-[2px] ${SWATCH[s.tone]}`} />
            {s.label.length > KEY_LABEL_CHARS ? (
              // A long funder name is cut at about 260px, its title the whole name (audit D4), so one name never
              // pushes the key row onto a third line. Short labels (every registrar and finance key) stay as they are.
              <span className="inline-block max-w-[260px] truncate align-top">{s.label}</span>
            ) : (
              s.label
            )}{' '}
            <b className="tabular-nums">{s.figure}</b>
          </span>
        ))}
    </div>
  )
}

export function AidHeroCard({
  title,
  description,
  figure,
  figureLabel,
  children,
}: {
  readonly title: string
  readonly description: ReactNode
  readonly figure: ReactNode
  readonly figureLabel: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className={CS_HERO_CARD}>
      <div className="flex items-center gap-4">
        <div className="min-w-0">
          <h2 className={CS_HERO_TITLE}>{title}</h2>
          <div className={CS_SMALL}>{description}</div>
        </div>
        <div
          data-testid="hero-figure"
          className="ml-auto flex items-baseline gap-2 whitespace-nowrap"
        >
          <span className={CS_SMALL}>{figureLabel}</span>
          <b className={CS_HERO_FIG}>{figure}</b>
        </div>
      </div>
      {children}
    </section>
  )
}
