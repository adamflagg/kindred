import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { AMBER_PILL } from '../../admin/lodging/lodgingStyles'
import type { AidAsOf } from '../kit/asOf'
import { campToday, formatLongDate, formatShortDate } from '../kit/dates'

interface AidPageBandProps {
  icon: LucideIcon
  title: string
  subtitle?: ReactNode | undefined
  /** Money pages pass it (D20: the as-of shows once, here). Pages of counts (Today) leave it out. */
  asOf?: AidAsOf | undefined
  /** The pill's native title: what this page says about the date (which tabs show today), not a sentence row. */
  asOfTitle?: string | undefined
  stats?: ReactNode | undefined
}

function AsOfPill({ asOf, title }: { asOf: AidAsOf; title?: string | undefined }) {
  if (asOf.kind === 'live') return null
  const text =
    asOf.kind === 'past'
      ? `As of ${formatLongDate(asOf.date)}${asOf.axis === 'recorded' ? ' · as recorded' : ''}`
      : `Not a past date: ${asOf.raw} · showing live`
  return (
    <span className={`${AMBER_PILL} font-sans`} title={title}>
      {text}
    </span>
  )
}

/**
 * Kindred's compact band (spec §4.1; D30), as on Users and SessionList: an icon tile, a Fraunces
 * title, a subtitle, optional stats on the right. The as-of sits here once: plain when live, an
 * amber pill for a past day (D20; the pill covers the Remaining line too, D48). No full-width
 * banner, no hero.
 */
export function AidPageBand({
  icon: Icon,
  title,
  subtitle,
  asOf,
  asOfTitle,
  stats,
}: AidPageBandProps) {
  const live = asOf?.kind === 'live' ? `as of ${formatShortDate(campToday())} (live)` : null
  return (
    <div className="from-forest-700 to-forest-800 rounded-xl bg-gradient-to-r px-4 py-4 sm:px-6 sm:py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="flex items-center justify-center rounded-lg bg-white/10 p-1.5 sm:size-[38px] sm:p-0">
            <Icon className="h-5 w-5 text-amber-400 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h1 className="font-display flex flex-wrap items-center gap-2 text-lg font-bold text-white sm:text-xl">
              {title}
              {asOf !== undefined && <AsOfPill asOf={asOf} title={asOfTitle} />}
            </h1>
            {(subtitle !== undefined || live !== null) && (
              <p className="text-forest-200 text-xs sm:text-sm">
                {subtitle}
                {subtitle !== undefined && live !== null ? ' · ' : null}
                {live}
              </p>
            )}
          </div>
        </div>
        {stats !== undefined && <div className="flex items-center gap-4 sm:gap-6">{stats}</div>}
      </div>
    </div>
  )
}
