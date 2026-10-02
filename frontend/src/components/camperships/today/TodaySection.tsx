import { Link } from 'react-router'

import type { AidView } from '../kit/asOf'
import {
  countWords,
  detailWords,
  LINE_NAMES,
  openHref,
  type TodaySection as Section,
} from './todayModel'

/**
 * One section of Today (§6.4; D24; round3.html's Today tab): each queue on one dense line, its
 * name, its count, its reasons inline and "Open ›". A line at zero stays, quiet, with nothing to open.
 */
export function TodaySection({ section, view }: { section: Section; view: AidView }) {
  return (
    <section className="space-y-1">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {section.title}
      </h2>
      <div className="card-lodge divide-border divide-y">
        {section.lines.map((line) => {
          const href = openHref(line, view)
          const zero = line.items === 0
          return (
            <div
              key={line.key}
              data-today-line={line.key}
              className={`grid grid-cols-[minmax(0,15rem)_7rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm ${zero ? 'text-muted-foreground' : ''}`}
            >
              <span className={zero ? 'font-medium' : 'font-semibold'}>{LINE_NAMES[line.key]}</span>
              <span className="font-semibold tabular-nums">{countWords(line)}</span>
              <span className="text-muted-foreground text-xs">{detailWords(line)}</span>
              {href === null ? (
                <span />
              ) : (
                <Link to={href} className="text-primary text-xs font-medium hover:underline">
                  Open ›
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
