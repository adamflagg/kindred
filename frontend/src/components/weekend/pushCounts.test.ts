/**
 * The three numbers a push report is summarised by (kindred#2477 follow-up).
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { PushBuildingReport, PushRowPayload } from '../../services/lodgingApi'
import { actionableRows, decisionsNeeded, pushableRows } from './pushCounts'

function row(unitCode: string, occupantName: string): PushRowPayload {
  return {
    unit_id: `u-${unitCode}`,
    unit_code: unitCode,
    unit_name: unitCode,
    occupant_name: occupantName,
    note: '',
    party_size: null,
    sleeps: null,
  }
}

function building(
  key: string,
  cls: PushBuildingReport['cls'],
  live: PushRowPayload[],
  draft: PushRowPayload[]
): PushBuildingReport {
  return { key, label: key, cls, live, draft }
}

/** One of each class, with a two-row `add` so row-grain and building-grain
 * counts cannot be confused for each other. */
const REPORT: PushBuildingReport[] = [
  building('yurt-5', 'add', [], [row('yurt-5', 'Kitchen crew'), row('yurt-5', 'Second write-in')]),
  building('fern-1', 'match', [row('fern-1', 'E. Sandoval')], [row('fern-1', 'E. Sandoval')]),
  building('cedar-9', 'conflict', [row('cedar-9', 'G. Whitfield')], [row('cedar-9', 'H. Osei')]),
  building('aspen-5', 'remove', [row('aspen-5', 'F. Moreau')], []),
]

describe('pushableRows — what a decision-free push writes', () => {
  it('counts add-class draft rows only', () => {
    expect(pushableRows(REPORT)).toBe(2)
  })

  it('counts nothing when every building already matches', () => {
    expect(pushableRows(REPORT.filter((b) => b.cls === 'match'))).toBe(0)
  })
})

describe('decisionsNeeded — buildings staff must rule on', () => {
  it('counts conflict and remove buildings, never add or match', () => {
    expect(decisionsNeeded(REPORT)).toBe(2)
  })
})

describe('actionableRows — the badge on the board', () => {
  // The whole point of the badge: a board whose write-ins ALL match reads 0,
  // not the board-wide write-in total it used to read.
  it('is zero when every building already matches', () => {
    expect(actionableRows(REPORT.filter((b) => b.cls === 'match'))).toBe(0)
  })

  it('is zero on an empty report', () => {
    expect(actionableRows([])).toBe(0)
  })

  // Row grain, not building grain: 2 add rows + 1 conflict draft row + 1
  // live row the scenario no longer carries.
  it('counts the rows a push would write or delete, per row', () => {
    expect(actionableRows(REPORT)).toBe(4)
  })

  it('takes the DRAFT side of a conflict — what the push would write', () => {
    // Live holds two occupants, the scenario proposes one. The push writes
    // one row; that is the number staff are being asked about.
    const conflict = [
      building(
        'cedar-9',
        'conflict',
        [row('cedar-9', 'G. Whitfield'), row('cedar-9', 'I. Nakamura')],
        [row('cedar-9', 'H. Osei')]
      ),
    ]
    expect(actionableRows(conflict)).toBe(1)
  })

  it('takes the LIVE side of a building the scenario no longer carries', () => {
    const removes = [
      building('aspen-5', 'remove', [row('aspen-5', 'F. Moreau'), row('aspen-5', 'J. Okafor')], []),
    ]
    expect(actionableRows(removes)).toBe(2)
  })

  it('agrees with the push CTA when there is nothing to decide', () => {
    const addsOnly = REPORT.filter((b) => b.cls === 'add' || b.cls === 'match')
    expect(actionableRows(addsOnly)).toBe(pushableRows(addsOnly))
  })
})
