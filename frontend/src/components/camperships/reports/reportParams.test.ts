/** What Reports keep in the URL and send (§3.6; §9.2; D129, D130, D138). */
import { describe, expect, it } from 'vitest'

import {
  committeeQuery,
  parseRoundChip,
  programsQuery,
  readStatisticsChoice,
  statisticsChoiceQuery,
  statisticsQuery,
} from './reportParams'

const LIVE = { kind: 'live' } as const
const PAST = { kind: 'past', date: '2027-03-08', axis: 'campminder' } as const

describe('Statistics in the URL', () => {
  it('opens on All award tables, Round 1, the Posted basis and every request (S4-3; D129)', () => {
    expect(readStatisticsChoice(new URLSearchParams(''))).toEqual({
      table: null,
      round: '1',
      decided: false,
      rows: 'tier',
      requestSet: { kind: 'all' },
    })
  })

  it('reads Rows: session, and anything else as the income tier', () => {
    expect(readStatisticsChoice(new URLSearchParams('rows=session')).rows).toBe('session')
    expect(readStatisticsChoice(new URLSearchParams('rows=tier')).rows).toBe('tier')
    expect(readStatisticsChoice(new URLSearchParams('rows=nonsense')).rows).toBe('tier')
  })

  it('never sends Rows to the read', () => {
    const choice = readStatisticsChoice(new URLSearchParams('rows=session'))
    expect(statisticsChoiceQuery(choice)).toEqual({ round: '1' })
  })

  it('reads the chips, the switch and one request-set control', () => {
    const choice = readStatisticsChoice(
      new URLSearchParams('table=camp&round=all&decided=1&through=2027-02-01')
    )
    expect(choice).toEqual({
      table: 'camp',
      round: 'all',
      decided: true,
      rows: 'tier',
      requestSet: { kind: 'date', date: '2027-02-01' },
    })
  })

  it('reads an unknown round as Round 1', () => {
    expect(parseRoundChip('4')).toBe('1')
    expect(parseRoundChip(null)).toBe('1')
  })
})

describe('what each read sends', () => {
  it('sends the chips, the decided basis, the deadline switch and a past date', () => {
    const choice = readStatisticsChoice(
      new URLSearchParams('table=camp&round=2&decided=1&through=deadline')
    )
    expect(statisticsQuery(choice, PAST)).toEqual({
      table: 'camp',
      round: '2',
      basis: 'posted_and_decided',
      through_round1_deadline: 'true',
      as_of: '2027-03-08',
    })
  })

  it("leaves the as-of out of a count's address: the grid adds its own (slice 4 J)", () => {
    const choice = readStatisticsChoice(new URLSearchParams('round=2&through=deadline'))
    expect(statisticsChoiceQuery(choice)).toEqual({ round: '2', through_round1_deadline: 'true' })
  })

  it('sends no table for All award tables and no basis for Posted (the server defaults)', () => {
    expect(statisticsQuery(readStatisticsChoice(new URLSearchParams('')), LIVE)).toEqual({
      round: '1',
    })
  })

  it('never sends both reporting controls: one parameter holds them', () => {
    const query = statisticsQuery(
      readStatisticsChoice(new URLSearchParams('through=2027-02-01')),
      LIVE
    )
    expect(query).toEqual({ round: '1', received_through: '2027-02-01' })
    expect(query).not.toHaveProperty('through_round1_deadline')
  })

  it('sends Programs the request set and the as-of', () => {
    expect(programsQuery({ kind: 'deadline' }, PAST)).toEqual({
      through_round1_deadline: 'true',
      as_of: '2027-03-08',
    })
  })

  it('sends the committee only a date: the deadline is its default cutoff', () => {
    expect(committeeQuery({ kind: 'deadline' })).toEqual({})
    expect(committeeQuery({ kind: 'date', date: '2027-02-15' })).toEqual({
      received_through: '2027-02-15',
    })
  })
})
