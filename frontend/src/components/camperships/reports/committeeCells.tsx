/**
 * The committee tables' drawn cells (approved final mock reports-yoy.html): a season's year with its
 * basis pill, the one-line band mark beside a phase's %, a pool's name, the "now" pill. Each carries
 * the words Copy and the CSV keep; only the screen draws these.
 */
import type { ReactNode } from 'react'

import { CS_CUT } from '../kit/csType'
import { StatusPill } from '../kit/Pills'
import { Money } from '../kit/MoneyText'
import { formatPct, moneyValue, pctValue, textValue, type ReportValue } from '../kit/report'

const BASIS_TITLE = {
  P: "P = the dashboard's Posted amounts",
  r: "r = as reported: finance's own figures, typed once from the committee decks",
} as const
const TO_DATE_TITLE = 'To date: still moving until the last session open to aid has ended'

/** "2026 · r", "2027 · P · to date": the words Copy and the CSV keep (N2). */
export function seasonWords(year: number, basis: 'P' | 'r', toDate = false): string {
  return `${String(year)} · ${basis}${toDate ? ' · to date' : ''}`
}

/** A season: the year and a small outlined pill for its basis ("P · to date", "r"), one line. */
export function seasonCell(year: number, basis: 'P' | 'r', toDate: boolean): ReportValue {
  const pillTitle = `${BASIS_TITLE[basis]}${toDate ? `. ${TO_DATE_TITLE}` : ''}`
  return {
    ...textValue(seasonWords(year, basis, toDate)),
    title: `${String(year)} · ${basis === 'P' ? "the dashboard's Posted" : 'as reported'}${toDate ? ' · to date' : ''}`,
    display: (
      <span className="whitespace-nowrap">
        <span className="mr-1.5">{year}</span>
        <StatusPill tone="line" title={pillTitle}>
          {basis}
          {toDate ? ' · to date' : ''}
        </StatusPill>
      </span>
    ),
  }
}

type Position = 'within' | 'below' | 'above'
const MARK: Record<Position, { glyph: string; ink: string }> = {
  within: { glyph: '✓', ink: 'text-forest-700 dark:text-forest-300' },
  below: { glyph: '↓', ink: 'text-amber-700 dark:text-amber-300' },
  above: { glyph: '↑', ink: 'text-amber-700 dark:text-amber-300' },
}

/**
 * A phase's % of budget with the band as a one-line mark (✓ in the band, ↓ below, ↑ above); the band
 * and where As offered sits are in the cell's title, never under the figure.
 */
export function bandedPct(
  end: number | null | undefined,
  offered: number | null | undefined,
  band: { low_pct: number; high_pct: number; position: Position | null } | null | undefined
): ReportValue {
  const cell = pctValue(end)
  if (band === null || band === undefined || end === null || end === undefined) return cell
  const range = `${String(band.low_pct)}–${String(band.high_pct)}%`
  const title = `End of season: ${formatPct(end)} of the budget. Target band ${range}${
    band.position === null
      ? ''
      : ` compares As offered (${formatPct(offered ?? null)}): ${band.position}`
  }`
  if (band.position === null) return { ...cell, title }
  const mark = MARK[band.position]
  return {
    ...cell,
    title,
    display: (
      <>
        {formatPct(end)}
        <span className={`${mark.ink} ml-[3px] cursor-help font-bold`}>{mark.glyph}</span>
      </>
    ),
  }
}

/** A pool's name; a pool row indents under its season, the all-pools row stands as the band total. */
export function poolCell(
  label: string,
  kind: string,
  indent: boolean,
  title?: string
): ReportValue {
  const words =
    title ??
    (kind === 'headline'
      ? 'Every pool together'
      : kind === 'no_pool'
        ? 'Requests whose program prices from no pool yet'
        : `${label} pool`)
  return {
    ...textValue(label),
    title: words,
    display: (
      <span className={indent ? 'pl-4 whitespace-nowrap' : 'whitespace-nowrap'}>{label}</span>
    ),
  }
}

/** An ask that fell back to today's: the figure and a small amber "now" pill, the reason in its title. */
export function askWithNow(asked: number | null, title: string): ReportValue {
  return {
    ...moneyValue(asked),
    title,
    display: (
      <>
        <Money value={asked} />
        <span className="ml-1.5">
          <StatusPill tone="amber" title={title}>
            now
          </StatusPill>
        </span>
      </>
    ),
  }
}

/** A Note column's words, cut to the column with the full text in the title. */
export function noteCell(note: string): ReportValue {
  if (note === '') return textValue('')
  return { ...textValue(note), title: note, display: cut(note) }
}

function cut(words: string): ReactNode {
  return <span className={CS_CUT}>{words}</span>
}
