import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ApiAidRowStage } from '../../../types/api-types'
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

  it('name the latest round', () => {
    const row = gridRow({
      rounds: [
        roundOut(1, 'posted', { posted: 1420, accepted: true }),
        roundOut(2, 'needs_offer', { decided: 780 }),
      ],
    })
    expect(latestRound(row)?.round).toBe(2)
  })

  // #2996: the Stage is the server's (`GridRowOut.stage`: one source with the household page), its
  // label drawn as sent and its code choosing the tone. Was: worked out here from the rounds.
  it("read the server's stage label, toned by its code", () => {
    const stage = (round: number | null, code: ApiAidRowStage['code'], label: string) =>
      requestStage(gridRow({ stage: { round, code, label } }))
    expect(stage(2, 'needs_offer', 'R2 · Needs an offer')).toEqual({
      text: 'R2 · Needs an offer',
      tone: 'sky',
    })
    expect(stage(1, 'accepted', 'R1 · Accepted')).toEqual({
      text: 'R1 · Accepted',
      tone: 'emerald',
    })
    expect(stage(1, 'held', 'R1 · On hold')).toEqual({ text: 'R1 · On hold', tone: 'red' })
    expect(stage(3, 'pending_approval', 'R3 · Pending approval')).toEqual({
      text: 'R3 · Pending approval',
      tone: 'purple',
    })
    expect(stage(null, 'cancelled', 'Cancelled')).toEqual({ text: 'Cancelled', tone: 'stone' })
    expect(stage(1, 'posted', 'R1 · Posted')).toEqual({ text: 'R1 · Posted', tone: 'muted' })
  })

  it('follow the server, not the rounds: a C1 round reads Posted though no tick is in', () => {
    const c1 = gridRow({
      rounds: [roundOut(1, 'needs_offer', { decided: 900 })],
      stage: { round: 1, code: 'posted', label: 'R1 · Posted' },
    })
    expect(requestStage(c1)).toEqual({ text: 'R1 · Posted', tone: 'muted' })
  })

  it('read nothing when the server sends no stage', () => {
    expect(requestStage(gridRow({ stage: null }))).toBeNull()
  })

  it('give each round its colour (§4.5)', () => {
    expect(roundTone(roundOut(1, 'needs_offer'))).toBe('muted')
    expect(roundTone(roundOut(2, 'posted'))).toBe('sky')
    expect(roundTone(roundOut(3, 'needs_offer'))).toBe('purple')
  })
})
