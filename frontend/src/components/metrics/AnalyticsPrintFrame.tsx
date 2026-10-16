import { useEffect, useRef, type ReactNode } from 'react'

const CAMP_TIME_ZONE = 'America/Los_Angeles'

/** "Thu Oct 15, 2026, 4:12 PM", in camp time. */
export function formatPrintStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('month')} ${get('day')}, ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

/**
 * Wraps an Analytics page so Ctrl+P prints cleanly (#3207 PR 10, rulings #68-#69; there is no Print
 * button). The rules live in index.css under [data-print-analytics]: the app chrome (data-app-chrome)
 * is hidden, the page prints landscape with "Page n of N", table headers repeat, rows never split.
 *
 * This component supplies the two things CSS cannot: the header line (the page, season, what it
 * counts, and when it was printed), which sits in a table-header-group so it repeats on every sheet,
 * and the light colours. Staff on the dark theme get a light page, because the theme is a class on
 * <html>: it comes off for the print and goes back after.
 */
export function AnalyticsPrintFrame({
  path,
  season,
  scope,
  children,
}: {
  path: string
  season: number
  scope: string
  children: ReactNode
}) {
  const stampRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let wasDark = false
    const before = () => {
      const root = document.documentElement
      wasDark = root.classList.contains('dark')
      root.classList.remove('dark')
      if (stampRef.current) stampRef.current.textContent = formatPrintStamp(new Date())
    }
    const after = () => {
      if (wasDark) document.documentElement.classList.add('dark')
      wasDark = false
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
      after()
    }
  }, [])

  return (
    <div data-print-analytics className="analytics-sheet">
      <div className="analytics-sheet-head">
        <div data-print-head className="analytics-print-head">
          <strong>Kindred</strong> · {path}
          <br />
          Season {season} · {scope} · Printed{' '}
          <span ref={stampRef}>{formatPrintStamp(new Date())}</span>
        </div>
      </div>
      <div className="analytics-sheet-body">{children}</div>
    </div>
  )
}
