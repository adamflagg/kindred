import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

/** Design-language §6 "Next-up chips never truncate; they drop": a name that would be cut is not shown, and "+N"
 *  counts everyone not shown. */
export interface NameChip {
  readonly key: string
  readonly label: string
  readonly days?: number | null
  readonly late?: boolean
  readonly href?: string
  readonly title: string
}

// eslint-disable-next-line react-refresh/only-export-components -- pure fit function, exported for its unit tests
export function fitChips(
  widths: readonly number[],
  room: number,
  total: number,
  gap = 4,
  reserve = 34
): number {
  let used = 0
  for (let i = 0; i < widths.length; i++) {
    const w = (widths[i] ?? 0) + gap
    const leftAfter = total - (i + 1)
    if (used + w + (leftAfter > 0 ? reserve : 0) > room) return i
    used += w
  }
  return widths.length
}

const CHIP =
  'inline-flex h-[22px] flex-none items-baseline gap-1 whitespace-nowrap rounded-full border border-border bg-card px-2 text-[12px] leading-5 text-foreground hover:border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))]'

export function AidNameChips({
  chips,
  total,
}: {
  readonly chips: readonly NameChip[]
  readonly total: number
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(chips.length)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const kids = [...el.querySelectorAll<HTMLElement>('[data-chip]')]
      kids.forEach((k) => {
        k.style.display = ''
      })
      const n = fitChips(
        kids.map((k) => k.getBoundingClientRect().width),
        el.clientWidth,
        total
      )
      // jsdom reports 0 widths and 0 room: treat an unmeasured box as roomy so tests read every chip
      setShown(el.clientWidth === 0 ? chips.length : n)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [chips, total])
  const rest = total - Math.min(shown, chips.length)
  return (
    <span ref={box} className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
      {chips.map((c, i) => {
        const inner = (
          <>
            {c.label}
            {c.days != null ? (
              <span
                className={
                  c.late
                    ? 'font-bold text-amber-700 dark:text-amber-300'
                    : 'text-muted-foreground tabular-nums'
                }
              >
                {String(c.days)}d
              </span>
            ) : null}
          </>
        )
        const style = i < shown ? undefined : { display: 'none' }
        return c.href ? (
          <Link key={c.key} data-chip to={c.href} title={c.title} className={CHIP} style={style}>
            {inner}
          </Link>
        ) : (
          <span key={c.key} data-chip title={c.title} className={CHIP} style={style}>
            {inner}
          </span>
        )
      })}
      {rest > 0 ? (
        <span data-testid="chips-more" className="text-muted-foreground flex-none text-[12px]">
          +{rest}
        </span>
      ) : null}
    </span>
  )
}
