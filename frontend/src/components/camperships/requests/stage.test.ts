import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { gridRow, roundOut } from './gridFixtures'
import { latestRound, requestStage, ROUND_STATUS_WORDS, roundTone } from './stage'

// The shared contract: test_camperships_frontend_mirrors.py holds the server's ROUND_STATUS_LABELS to it.
const MIRRORS = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../tests/fixtures/camperships_frontend_mirrors.json'),
    'utf-8'
  )
) as { round_status_labels: Record<string, string> }

describe('stage words (§6.1; slice 1 Decision 6)', () => {
  it("are the server's ROUND_STATUS_LABELS, word for word, through the shared fixture", () => {
    expect(Object.keys(MIRRORS.round_status_labels)).toHaveLength(7)
    expect(ROUND_STATUS_WORDS).toEqual(MIRRORS.round_status_labels)
  })

  it('name the latest round and its state', () => {
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', { posted: 1420, accepted: true }),
        roundOut(2, 'needs_offer', { decided: 780 }),
      ],
    })
    expect(latestRound(row)?.round).toBe(2)
    expect(requestStage(row)).toEqual({ text: 'R2 · Needs an offer', tone: 'sky' })
  })

  it('read Accepted once a posted round is ticked, and On hold in red', () => {
    expect(requestStage(gridRow({ rounds: [roundOut(1, 'posted', { accepted: true })] }))).toEqual({
      text: 'R1 · Accepted',
      tone: 'emerald',
    })
    expect(requestStage(gridRow({ rounds: [roundOut(1, 'held')] }))).toEqual({
      text: 'R1 · On hold',
      tone: 'red',
    })
    expect(requestStage(gridRow({ rounds: [roundOut(3, 'pending_approval')] }))).toEqual({
      text: 'R3 · Pending approval',
      tone: 'purple',
    })
  })

  it('read Cancelled for a cancelled request, and nothing with no round', () => {
    expect(
      requestStage(
        gridRow({ cancellation: { by: 'kindred', on: null, reason: 'medical', note: '' } })
      )
    ).toEqual({ text: 'Cancelled', tone: 'stone' })
    expect(requestStage(gridRow({ rounds: [] }))).toBeNull()
  })

  it('give each round its colour (§4.5)', () => {
    expect(roundTone(roundOut(1, 'needs_offer'))).toBe('muted')
    expect(roundTone(roundOut(2, 'posted'))).toBe('sky')
    expect(roundTone(roundOut(3, 'needs_offer'))).toBe('purple')
  })
})
