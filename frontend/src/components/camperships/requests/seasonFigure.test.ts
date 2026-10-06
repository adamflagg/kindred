import { describe, expect, it } from 'vitest'

import { gridRow, roundOut } from './gridFixtures'
import {
  figureCsvWords,
  figureLink,
  figureParam,
  figureWords,
  matchesFigure,
  parseSeasonFigure,
  type SeasonFigure,
} from './seasonFigure'

const parse = (query: string) => parseSeasonFigure(new URLSearchParams(query))

describe('parseSeasonFigure (owner 10-06, option a)', () => {
  it('reads posted= and accepted= as a round or all', () => {
    expect(parse('posted=1')).toEqual({ measure: 'posted', round: 1 })
    expect(parse('posted=3')).toEqual({ measure: 'posted', round: 3 })
    expect(parse('accepted=2')).toEqual({ measure: 'accepted', round: 2 })
    expect(parse('accepted=all')).toEqual({ measure: 'accepted', round: 'all' })
  })

  it('reads nothing from no param or a value that is no round', () => {
    expect(parse('')).toBeNull()
    expect(parse('posted=4')).toBeNull()
    expect(parse('posted=')).toBeNull()
    expect(parse('accepted=yes')).toBeNull()
  })

  it('writes the param back as it read it, and a producer as a round or all', () => {
    expect(figureParam({ measure: 'posted', round: 1 })).toEqual({ posted: '1' })
    expect(figureParam({ measure: 'accepted', round: 'all' })).toEqual({ accepted: 'all' })
    expect(figureLink('posted', 2)).toEqual({ posted: '2' })
    expect(figureLink('accepted', null)).toEqual({ accepted: 'all' })
  })
})

describe('matchesFigure: the budget strip counts these rows (budget.py)', () => {
  // Posted in Round 1 (counted, accepted), and now in Round 2: still Round 1's posted figure.
  const moved = gridRow({
    request_id: 'reqmovedon00001',
    rounds: [
      roundOut(1, 'posted', { posted: 900, accepted: true }),
      roundOut(2, 'needs_offer', { ask: 400 }),
    ],
    stage: { round: 2, code: 'needs_offer', label: 'R2 · Needs an offer' },
  })
  // Posted in Round 1, then reversed in CampMinder: counts nowhere (D54).
  const clawed = gridRow({
    request_id: 'reqclawed000001',
    rounds: [roundOut(1, 'posted', { posted: 900, accepted: true, clawed_back: true })],
  })
  // Posted in Round 1, not accepted.
  const unaccepted = gridRow({
    request_id: 'requnaccept0001',
    rounds: [roundOut(1, 'posted', { posted: 700 })],
  })
  // Posted in Round 1 and accepted, but its type does not count toward the budget.
  const outside = gridRow({
    request_id: 'reqoutside00001',
    rounds: [roundOut(1, 'posted', { posted: 500, accepted: true, counts_toward_budget: false })],
  })
  // Posted in Round 2 only (Round 1 needed no money).
  const round2 = gridRow({
    request_id: 'reqroundtwo0001',
    rounds: [roundOut(2, 'posted', { posted: 300, accepted: true })],
  })
  // Needs an offer, nothing posted.
  const needs = gridRow({ request_id: 'reqneedsoffer01' })
  const rows = [moved, clawed, unaccepted, outside, round2, needs]
  const ids = (figure: SeasonFigure, counted: boolean) =>
    rows.filter((r) => matchesFigure(r, figure, counted)).map((r) => r.request_id)

  it('opens a round posted in Round 1 though the request has moved on to Round 2', () => {
    expect(ids({ measure: 'posted', round: 1 }, true)).toEqual([
      'reqmovedon00001',
      'requnaccept0001',
    ])
  })

  it('leaves out a clawed-back posted round', () => {
    expect(ids({ measure: 'posted', round: 1 }, false)).not.toContain('reqclawed000001')
    expect(ids({ measure: 'accepted', round: 'all' }, false)).not.toContain('reqclawed000001')
  })

  it('opens accepted only where the posted round is accepted', () => {
    expect(ids({ measure: 'accepted', round: 1 }, true)).toEqual(['reqmovedon00001'])
  })

  it('keeps a posted round outside the budget only without counted', () => {
    expect(ids({ measure: 'posted', round: 1 }, false)).toEqual([
      'reqmovedon00001',
      'requnaccept0001',
      'reqoutside00001',
    ])
    expect(ids({ measure: 'accepted', round: 1 }, false)).toEqual([
      'reqmovedon00001',
      'reqoutside00001',
    ])
    expect(ids({ measure: 'posted', round: 1 }, true)).not.toContain('reqoutside00001')
  })

  it('reads all as any round', () => {
    expect(ids({ measure: 'posted', round: 'all' }, true)).toEqual([
      'reqmovedon00001',
      'requnaccept0001',
      'reqroundtwo0001',
    ])
    expect(ids({ measure: 'accepted', round: 'all' }, true)).toEqual([
      'reqmovedon00001',
      'reqroundtwo0001',
    ])
    expect(ids({ measure: 'posted', round: 2 }, true)).toEqual(['reqroundtwo0001'])
    expect(ids({ measure: 'posted', round: 3 }, true)).toEqual([])
  })

  it('lets every row through with no figure', () => {
    expect(rows.filter((r) => matchesFigure(r, null, true))).toHaveLength(rows.length)
  })
})

describe('figureWords: the grid line that says what the list is', () => {
  it('names the measure, the round and the budget', () => {
    expect(figureWords({ measure: 'posted', round: 1 }, true)).toBe(
      'Posted in Round 1 · counting toward the budget'
    )
    expect(figureWords({ measure: 'accepted', round: 2 }, true)).toBe(
      'Accepted in Round 2 · counting toward the budget'
    )
    expect(figureWords({ measure: 'posted', round: 'all' }, true)).toBe(
      'Posted in any round · counting toward the budget'
    )
  })

  it('drops the budget part when counted is off', () => {
    expect(figureWords({ measure: 'posted', round: 3 }, false)).toBe('Posted in Round 3')
    expect(figureWords({ measure: 'accepted', round: 'all' }, false)).toBe('Accepted in any round')
  })

  it('names the CSV after the figure', () => {
    expect(figureCsvWords({ measure: 'posted', round: 1 })).toBe('posted round 1')
    expect(figureCsvWords({ measure: 'accepted', round: 'all' })).toBe('accepted any round')
  })
})
