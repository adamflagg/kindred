/**
 * Analytics › Today › Recent sign-ups (#3207 PR 8; decisions 37, 40): the last 7 days by Enrolled on, one
 * line per camper per day ("+N more" opens the rest on click), at most 6 lines, newest first. "View all"
 * opens the drill-down at Rows: Enrollments for the same window. The card folds away when it is empty.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import { formatShortDate } from '../../../components/camperships/kit/dates'
import { CS_CARD_HEADING, CS_LINK_SM, CS_SMALL } from '../../../components/camperships/kit/csType'
import { PILL } from '../../../components/camperships/kit/kitStyles'
import { formatCount } from '../../../utils/numberFormat'
import { DELTA_INK } from '../../../utils/deltaTokens'
import type { ApiRecentSignupLine, ApiRecentSignups } from '../../../types/api-types'

function displayName(line: ApiRecentSignupLine): string {
  // An empty preferred name falls back to the first name, so `||`, not `??`
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return `${line.preferred_name || line.first_name} ${line.last_name}`.trim()
}

export function RecentSignupsCard({
  data,
  note,
  onViewAll,
}: {
  data: ApiRecentSignups
  note: number | undefined
  onViewAll: () => void
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <section
      data-testid="today-recent"
      className="border-border bg-card overflow-hidden rounded-xl border"
    >
      <div className="flex items-baseline gap-2 px-3.5 pt-[9px]">
        <h2 className={CS_CARD_HEADING}>
          Recent sign-ups
          {note !== undefined && <DefRef n={note} />}
        </h2>
        <span className={CS_SMALL}>last 7 days</span>
        <span className={`${CS_SMALL} ml-auto whitespace-nowrap`}>Enrolled on</span>
      </div>
      <ul className="flex flex-col px-3.5 pt-0.5 pb-1">
        {data.lines.map((line) => {
          const key = `${String(line.person_id)}-${line.day}`
          const isOpen = open.has(key)
          const more = line.sessions.length - 1
          const name = (
            <Link
              to={`/camper/${String(line.person_id)}`}
              className="text-foreground font-semibold hover:underline"
            >
              {displayName(line)}
            </Link>
          )
          return (
            <li
              key={key}
              className="border-border grid items-baseline gap-x-2 border-b border-dashed py-1 text-[13.5px] leading-[17px] last:border-b-0"
              style={{ gridTemplateColumns: '18px minmax(0,1fr) auto 44px' }}
            >
              <span className={`text-center font-bold ${DELTA_INK.good}`}>＋</span>
              {isOpen ? (
                <span className="min-w-0">
                  {name} · {line.sessions.join(', ')}{' '}
                  <button
                    type="button"
                    data-app-chrome
                    className={`${CS_LINK_SM} cursor-pointer`}
                    onClick={() => toggle(key)}
                  >
                    less
                  </button>
                </span>
              ) : (
                <span className="flex min-w-0 items-baseline gap-1">
                  <span className="min-w-0 truncate">
                    {name} · {line.sessions[0]}
                  </span>
                  {more > 0 && (
                    <button
                      type="button"
                      className={`${CS_LINK_SM} flex-none cursor-pointer whitespace-nowrap`}
                      onClick={() => toggle(key)}
                    >
                      +{more} more
                    </button>
                  )}
                </span>
              )}
              <span>
                {line.is_new ? (
                  <span className={PILL.sky}>new</span>
                ) : line.is_second ? (
                  <span className={PILL.muted}>2nd</span>
                ) : null}
              </span>
              <span className={`${CS_SMALL} text-right whitespace-nowrap tabular-nums`}>
                {line.day === data.today ? 'today' : formatShortDate(line.day)}
              </span>
            </li>
          )
        })}
      </ul>
      <div
        data-app-chrome
        className="border-border flex items-baseline gap-2 border-t px-3.5 py-1.5"
      >
        <button
          type="button"
          className={`${CS_LINK_SM} ml-auto cursor-pointer whitespace-nowrap`}
          onClick={onViewAll}
        >
          View all {formatCount(data.enrollments)}{' '}
          {data.enrollments === 1 ? 'enrollment' : 'enrollments'} ›
        </button>
      </div>
    </section>
  )
}
