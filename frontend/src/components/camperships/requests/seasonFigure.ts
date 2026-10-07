/**
 * Season's figure filter: `?posted=<1|2|3|all>` / `?accepted=<1|2|3|all>` on the Requests grid, so a
 * Rounds & budget Posted or Accepted figure opens exactly the requests it counts. Hidden: no chip and
 * no control; the grid says what it is on a line of its own, with Show All.
 *
 * INTERIM, per the owner 10-06 ("a but c eventually"): slice 4 J replaces it with the server sending
 * each figure's request ids (a today=-style key), so this module is meant to be swapped out whole.
 * Everything it knows lives here; GridFilters, useGridParams, filterRows, AidRequestsPage and the
 * queue walk only carry it.
 *
 * Its meaning is the budget's count (bunking/financial_aid/decisions/budget.py), not the grid's
 * `round=`: a round whose NUMBER is n (any round for `all`) is posted and not clawed back, and for
 * accepted also accepted; with `counted=1` that same round counts toward the budget. A request
 * posted in Round 1 that has moved on to Round 2 is still Round 1's figure, so a link never sends
 * `round=` (the round a request is in now) beside it.
 */
import type { ApiAidGridRow } from '../../../types/api-types'

export type FigureMeasure = 'posted' | 'accepted'
export type FigureRound = 1 | 2 | 3 | 'all'

export interface SeasonFigure {
  readonly measure: FigureMeasure
  readonly round: FigureRound
}

/** The two params, in the order read: a URL carrying both (hand-made) is read as posted. */
const MEASURES: readonly FigureMeasure[] = ['posted', 'accepted']

function parseFigureRound(raw: string | null): FigureRound | null {
  return raw === '1' ? 1 : raw === '2' ? 2 : raw === '3' ? 3 : raw === 'all' ? 'all' : null
}

export function parseSeasonFigure(params: URLSearchParams): SeasonFigure | null {
  for (const measure of MEASURES) {
    const round = parseFigureRound(params.get(measure))
    if (round !== null) return { measure, round }
  }
  return null
}

/** The param as a link carries it on (the household link, a view link). */
export function figureParam(figure: SeasonFigure): Record<string, string> {
  return { [figure.measure]: String(figure.round) }
}

/** A Rounds & budget figure's param: its round, or `all` on a pool or total line (no round). */
export function figureLink(measure: FigureMeasure, round: number | null): Record<string, string> {
  return { [measure]: round === null ? 'all' : String(round) }
}

/** The names a clearing write deletes: both, so Show All leaves no figure behind. */
export const FIGURE_PARAMS: readonly FigureMeasure[] = MEASURES

export function matchesFigure(
  row: ApiAidGridRow,
  figure: SeasonFigure | null,
  counted: boolean
): boolean {
  if (figure === null) return true
  return row.rounds.some(
    (r) =>
      (figure.round === 'all' || r.round === figure.round) &&
      r.status === 'posted' &&
      r.clawed_back !== true &&
      (figure.measure === 'posted' || r.accepted) &&
      (!counted || r.counts_toward_budget)
  )
}

function roundWords(round: FigureRound): string {
  return round === 'all' ? 'any round' : `Round ${String(round)}`
}

/** "Posted in Round 1 · counting toward the budget": the grid's line over a figure's rows. */
export function figureWords(figure: SeasonFigure, counted: boolean): string {
  const measure = figure.measure === 'posted' ? 'Posted' : 'Accepted'
  const words = `${measure} in ${roundWords(figure.round)}`
  return counted ? `${words} · counting toward the budget` : words
}

/** The CSV file name's words for a figure: "posted round 1", "accepted any round". */
export function figureCsvWords(figure: SeasonFigure): string {
  return `${figure.measure} ${roundWords(figure.round).toLowerCase()}`
}
