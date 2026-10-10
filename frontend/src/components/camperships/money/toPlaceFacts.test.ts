/**
 * ux3 to-place-10: the opened row's display-only facts (each candidate's rounds, the line's history and
 * posting note, why a no-request line found nothing). They say what the server sent; no figure moves.
 */
import { describe, expect, it } from 'vitest'

import type { ApiAidToPlaceCandidate, ApiAidToPlaceLine } from '../../../types/api-types'
import {
  candidateStatusWords,
  evidenceLines,
  historyWords,
  lineCell,
  lineWords,
  noSuggestionEffects,
} from './toPlaceModel'
import { JOHNSON_SPLIT, SAM_NO_REQUEST } from './toPlaceFixtures'

const emma = JOHNSON_SPLIT.candidates[0] as ApiAidToPlaceCandidate
const household = (over: Partial<ApiAidToPlaceCandidate> = {}): ApiAidToPlaceCandidate => ({
  ...emma,
  person_cm_id: 0,
  camper: '',
  ...over,
})

describe('candidateStatusWords', () => {
  it('reads each round: Posted at what it locked, decided at what is decided', () => {
    const c = {
      ...emma,
      rounds: [
        { round: 1, status: 'posted', amount: 1420 },
        { round: 2, status: 'needs_offer', amount: 780 },
      ],
    }
    expect(candidateStatusWords(c)).toBe('R1 Posted $1,420 · R2 decided $780')
  })

  it('names a round that is not decided in plain words', () => {
    const c = {
      ...emma,
      rounds: [
        { round: 1, status: 'held', amount: null },
        { round: 2, status: 'pending_approval', amount: 300 },
        { round: 3, status: 'not_decided' },
      ],
    }
    expect(candidateStatusWords(c)).toBe('R1 held · R2 pending approval $300 · R3 not decided')
  })

  it('leads a household request with "household request"', () => {
    expect(
      candidateStatusWords(
        household({ rounds: [{ round: 1, status: 'needs_offer', amount: 900 }] })
      )
    ).toBe('household request · R1 decided $900')
  })

  it('is empty when the server sent no rounds', () => {
    expect(candidateStatusWords(emma)).toBe('')
  })
})

describe('historyWords', () => {
  it('says what CampMinder reversed just before the posting, by day', () => {
    const line: ApiAidToPlaceLine = {
      ...JOHNSON_SPLIT,
      reposted_after: [
        { amount: 1420, reversed_on: '2027-03-09' },
        { amount: 780, reversed_on: '2027-03-10' },
      ],
    }
    expect(historyWords(line)).toBe('Reposted after reversing $1,420 (Mar 9) and $780 (Mar 10)')
  })

  it('is null when nothing was reversed', () => {
    expect(historyWords(JOHNSON_SPLIT)).toBeNull()
    expect(historyWords({ ...JOHNSON_SPLIT, reposted_after: [] })).toBeNull()
  })
})

describe('the posting note', () => {
  const noted = { ...JOHNSON_SPLIT, posting_note: 'full-ride program' }
  it('ends the line cell and the line words', () => {
    expect(lineCell(noted)).toBe(
      'May 14 · to the household · Camp aid · Summer · note "full-ride program"'
    )
    expect(lineWords(noted)).toMatch(/ · note "full-ride program"$/)
  })

  it('adds nothing when there is none', () => {
    expect(lineCell(JOHNSON_SPLIT)).not.toContain('note')
    expect(lineWords({ ...JOHNSON_SPLIT, posting_note: '' })).not.toContain('note')
  })
})

describe('a no-request line says why', () => {
  const line = (
    no_request: Exclude<ApiAidToPlaceLine['no_request'], undefined> | 'absent',
    note = ''
  ): ApiAidToPlaceLine => ({
    ...SAM_NO_REQUEST,
    person: 'Riley Sam',
    posting_note: note,
    ...(no_request === 'absent' ? {} : { no_request }),
  })

  it('names the camper without an application, by first name', () => {
    expect(evidenceLines(line({ kind: 'person_no_application', person: 'Riley Sam' }))).toEqual([
      '○ Riley has no application this season',
    ])
  })

  it("says no one applied when the line is the household's", () => {
    expect(evidenceLines(line({ kind: 'household_no_application', person: '' }))).toEqual([
      '○ no one in the household applied this season',
    ])
  })

  it('says a request was withdrawn, and says so in what Confirm does too', () => {
    const withdrawn = line({ kind: 'withdrawn', person: 'Riley Sam' })
    expect(evidenceLines(withdrawn)).toEqual(["○ Riley's request was withdrawn"])
    expect(noSuggestionEffects(withdrawn)[0]?.text).toBe(": Riley's request was withdrawn")
  })

  it('keeps the old words for a read that carries no reason', () => {
    expect(evidenceLines(line('absent'))).toEqual([])
    expect(noSuggestionEffects(line('absent'))[0]?.text).toBe(': no application this season')
  })

  it("offers 'if it's outside money' only when the posting's note is there to suggest it", () => {
    expect(noSuggestionEffects(line(null, 'full-ride program'))[0]?.then).toBe(
      "→ Reclassify… if it's outside money, or Leave With a Note…"
    )
    expect(noSuggestionEffects(line(null))[0]?.then).toBe('→ Reclassify… or Leave With a Note…')
  })
})
