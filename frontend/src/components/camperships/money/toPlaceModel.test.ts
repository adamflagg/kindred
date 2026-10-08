/** To place's words and Confirm's body (§8.1; §4.10): every figure the server's, every id a name. */
import { describe, expect, it } from 'vitest'

import {
  CHEN_EXACT,
  EMMA_REQ,
  GARCIA_WITHHELD,
  JOHNSON_SPLIT,
  SAM_NO_REQUEST,
  SAMUEL_MISMATCH,
  TO_PLACE,
} from './toPlaceFixtures'
import { CAMP_QUEST, GRANTOR_C_FULL_RIDE, SOURCES, UNCLASSIFIED } from './sourcesFixtures'
import { groupWords } from './toPlaceColumns'
import {
  allLines,
  candidateDetail,
  candidateLabel,
  CONFIRM_DOES,
  confirmBody,
  confirmLines,
  confirmSummary,
  exactAmount,
  grantLinesFor,
  isMarkLine,
  isOpen,
  lineWords,
  NOTHING_MARKED,
  openLineWords,
  placeChoices,
  placedWords,
  reclassifyTargets,
  requestLabels,
  stillNotPlacedWords,
  suggestionWords,
  suggestsSplit,
  targetWords,
  toPlaceCount,
  toPlaceCsvName,
  wouldLines,
} from './toPlaceModel'

// A withheld round's sentence in the server's frame (financial_aid_to_place.py `withheld_why`, owner
// 10-03). The reason fragment ("income corrected Apr 20") is the fixture's own; the server words it
// from `_TEXT` (e.g. "a correction was entered (Apr 20)"), so only the frame is the server's (R1-15).
const GARCIA_WHY =
  "Round 2 wasn't marked posted automatically: after it was posted in CampMinder on Apr 3, income corrected Apr 20. Check it against what the family was offered, then click Mark Posted. That saves the higher of its amount on Apr 3 and today's."

describe('the line and its candidates in words', () => {
  it('says what CampMinder holds, and who it was posted to', () => {
    expect(lineWords(JOHNSON_SPLIT)).toBe(
      '$3,620 · Camp aid · Summer · posted to the household · May 14'
    )
    expect(lineWords(GARCIA_WITHHELD)).toBe(
      '$600 · Camp aid · Summer · posted to Liam Garcia · Apr 3'
    )
  })

  it('says "still not placed" only where part of the line is already on a request (ruling B)', () => {
    expect(stillNotPlacedWords(JOHNSON_SPLIT)).toBeNull()
    // To the cent: float noise is not a difference.
    expect(stillNotPlacedWords({ ...JOHNSON_SPLIT, unplaced: 3619.999999 })).toBeNull()
    expect(stillNotPlacedWords({ ...JOHNSON_SPLIT, unplaced: 1000 })).toBe(
      '· $1,000 still not placed'
    )
  })

  it('names each candidate, and what it still lacks as "not yet in CampMinder" (Group 3a Q1)', () => {
    const [emma] = JOHNSON_SPLIT.candidates
    expect(emma && candidateLabel(emma)).toBe('Emma Johnson · Session 2')
    expect(emma && candidateDetail(emma)).toBe('$2,200 not yet in CampMinder')
    expect(emma && candidateDetail({ ...emma, cancelled: true })).toBe(
      '$2,200 not yet in CampMinder · cancelled'
    )
    expect(
      emma && candidateLabel({ ...emma, person_cm_id: 0, camper: '', session: 'Family Camp' })
    ).toBe('Johnson household · Family Camp')
  })
})

describe('the suggestion and what Confirm does (§4.10; D146, D152)', () => {
  it('words a single placement and a split from the server’s parts', () => {
    expect(suggestionWords(CHEN_EXACT)).toBe('Place on Olivia Chen · Quest')
    expect(suggestionWords(JOHNSON_SPLIT)).toBe(
      'Split: $2,200 on Emma Johnson · Session 2 · $1,420 on Samuel Johnson · Session 2'
    )
    expect(suggestionWords(SAM_NO_REQUEST)).toBe('Nothing to suggest: no request.')
  })

  it('lists the rounds it marks posted, and those D152 withholds, before the click', () => {
    expect(confirmLines(JOHNSON_SPLIT)).toEqual([
      'Marks Posted: Emma Johnson · Session 2 · Round 2 · $780 locked',
    ])
    expect(confirmLines(GARCIA_WITHHELD)).toEqual([
      `Places the money; doesn't mark Liam Garcia · Session 2 posted: ${GARCIA_WHY}`,
    ])
    expect(confirmSummary(JOHNSON_SPLIT)).toBe('Marks 1 round posted · $780 locked')
    expect(confirmSummary(GARCIA_WITHHELD)).toBe('1 to mark posted by hand')
    expect(confirmSummary(SAM_NO_REQUEST)).toBe('Nothing to confirm')
  })

  it('says it marks nothing posted when no round is covered in full (D146)', () => {
    const none = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        would_tick: [],
        would_lock: 0,
      },
    }
    expect(confirmLines(none)).toEqual([NOTHING_MARKED])
    expect(NOTHING_MARKED).toBe('Marks nothing posted.')
    expect(confirmSummary(none)).toBe('Marks nothing posted')
  })

  it('tells a line that marks a round posted from one that marks nothing', () => {
    expect(isMarkLine('Marks Posted: Emma Johnson · Session 2 · Round 2 · $780 locked')).toBe(true)
    expect(isMarkLine(NOTHING_MARKED)).toBe(false)
    expect(isMarkLine(`Places the money; doesn't mark Liam Garcia · Session 2 posted: x`)).toBe(
      false
    )
  })

  it('reads a fresh preview in place of the read’s when one is given (P-4)', () => {
    const fresh = {
      would_tick: [{ request_id: 'reqolivia000003', round: 2, amount: 1400 }],
      would_lock: 1400,
      would_leave: [],
      would_not_tick: [],
    }
    expect(confirmLines(CHEN_EXACT, fresh)).toEqual([
      'Marks Posted: Olivia Chen · Quest · Round 2 · $1,400 locked',
    ])
    expect(confirmBody(CHEN_EXACT, fresh)).toMatchObject({ expected_locked: '1400.00' })
    // No suggestion: nothing to confirm, whatever a preview says.
    expect(confirmLines(SAM_NO_REQUEST, fresh)).toEqual([])
  })

  it("sends the suggestion's parts and what it showed it would lock, exact to the cent", () => {
    expect(confirmBody(JOHNSON_SPLIT)).toEqual({
      parts: [
        { request_id: EMMA_REQ, amount: '2200.00' },
        { request_id: 'reqsamuel000002', amount: '1420.00' },
      ],
      note: '',
      expected_locked: '780.00',
    })
    expect(confirmBody(SAM_NO_REQUEST)).toBeNull()
    expect(exactAmount(1420.1)).toBe('1420.10')
    expect(exactAmount(0.1 + 0.2)).toBe('0.30')
  })
})

describe('what a placement did (§4.10: the result lists exactly what was marked posted)', () => {
  const labels = requestLabels(allLines(TO_PLACE))

  it('names the rounds marked posted, and those to mark posted by hand', () => {
    expect(
      placedWords(
        {
          year: 2027,
          operation_id: 'op0000000000001',
          placed: [3000001],
          ticked: [{ request_id: EMMA_REQ, round: 2, amount: 780 }],
          left_to_tick: [],
          not_ticked: [],
        },
        [JOHNSON_SPLIT],
        labels
      )
    ).toBe('Johnson: $3,620 placed. Marked Posted: Emma Johnson · Session 2 Round 2 · $780 locked.')
    expect(
      placedWords(
        {
          year: 2027,
          operation_id: 'op0000000000002',
          placed: [3000002, 3000005],
          ticked: [],
          left_to_tick: [],
          not_ticked: GARCIA_WITHHELD.suggestion?.would_not_tick ?? [],
          sections_not_locked: ['award_tables'],
        },
        [GARCIA_WITHHELD, SAMUEL_MISMATCH],
        labels
      )
    ).toBe(
      `2 lines placed. Nothing marked posted. Not marked posted: Liam Garcia · Session 2 (${GARCIA_WHY}). Rules not locked yet: award tables.`
    )
  })

  it('names the family the way the caller asks (the household label, ruling D)', () => {
    expect(
      placedWords(
        {
          year: 2027,
          operation_id: 'op0000000000004',
          placed: [3000003],
          ticked: [],
          left_to_tick: [],
        },
        [CHEN_EXACT],
        labels,
        () => 'Mei & David Chen'
      )
    ).toBe('Mei & David Chen: $1,500 placed. Nothing marked posted.')
  })
})

describe('open lines and the CSV name', () => {
  it('tells an open line from one left or reclassified', () => {
    expect(isOpen(JOHNSON_SPLIT)).toBe(true)
    expect(isOpen({ ...JOHNSON_SPLIT, left_note: 'A deposit credit' })).toBe(false)
    expect(isOpen({ ...JOHNSON_SPLIT, reclassified_to: 'Grantor A grant' })).toBe(false)
  })

  it("names the file as D70 does, with a household's scope when there is one", () => {
    expect(toPlaceCsvName(2027, null)).toBe('camperships-money-to-place-2027.csv')
    expect(toPlaceCsvName(2027, 1000001)).toBe(
      'camperships-money-to-place-household-1000001-2027.csv'
    )
  })
})

describe('the leave and left lines say "by hand" once (review m3)', () => {
  const labels = requestLabels(allLines(TO_PLACE))
  // The server's words for a round a placement leaves (financial_aid_to_place_service.py).
  const WHY =
    'CampMinder holds $1,000 on this request; Round 2 needs $1,500: mark it posted by hand if that is right'

  it('words a round Confirm leaves with the round and the server’s own reason', () => {
    const line = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        would_tick: [],
        would_lock: 0,
        would_leave: [{ request_id: 'reqolivia000003', round: 2, why: WHY }],
      },
    }
    expect(confirmLines(line)).toEqual([`Leaves Olivia Chen · Quest · Round 2: ${WHY}`])
  })

  it('words a round left unchecked without repeating "by hand"', () => {
    expect(
      placedWords(
        {
          year: 2027,
          operation_id: 'op0000000000003',
          placed: [3000003],
          ticked: [],
          left_to_tick: [{ request_id: 'reqolivia000003', round: 2, why: WHY }],
        },
        [CHEN_EXACT],
        labels
      )
    ).toBe(
      `Chen: $1,500 placed. Nothing marked posted. Left unchecked: Olivia Chen · Quest Round 2 (${WHY}).`
    )
  })
})

describe('the other ways to place a line (§8.1; D12; part 1b)', () => {
  it('offers Split… with two candidates, and another request when one is left unsuggested', () => {
    expect(placeChoices(JOHNSON_SPLIT)).toEqual({ split: true, another: false })
    expect(placeChoices(GARCIA_WITHHELD)).toEqual({ split: true, another: true })
    expect(placeChoices(CHEN_EXACT)).toEqual({ split: false, another: false })
    // money-v2.html draws "Place on another request…" on the program-mismatch line (R1-8a).
    expect(placeChoices(SAMUEL_MISMATCH)).toEqual({ split: false, another: true })
    expect(placeChoices(SAM_NO_REQUEST)).toEqual({ split: false, another: false })
    // No suggestion at all: every candidate is "another request".
    expect(placeChoices({ ...GARCIA_WITHHELD, suggestion: null })).toEqual({
      split: true,
      another: true,
    })
  })

  it('tells a split suggestion from a single one (Confirm Split, review item 6)', () => {
    expect(suggestsSplit(JOHNSON_SPLIT)).toBe(true)
    expect(suggestsSplit(CHEN_EXACT)).toBe(false)
    expect(suggestsSplit(SAM_NO_REQUEST)).toBe(false)
  })

  it('words what typed parts would do even on a line with no suggestion (P-4 for Split…)', () => {
    const would = {
      would_tick: [{ request_id: 'reqliamquest005', round: 1, amount: 600 }],
      would_lock: 600,
      would_leave: [],
      would_not_tick: [],
    }
    expect(wouldLines({ ...GARCIA_WITHHELD, suggestion: null }, would)).toEqual([
      'Marks Posted: Liam Garcia · Quest · Round 1 · $600 locked',
    ])
    expect(confirmLines({ ...GARCIA_WITHHELD, suggestion: null }, would)).toEqual([])
    expect(
      wouldLines(JOHNSON_SPLIT, {
        would_tick: [],
        would_lock: 0,
        would_leave: [],
        would_not_tick: [],
      })
    ).toEqual([NOTHING_MARKED])
  })
})

describe('Reclassify targets (D104; P-7)', () => {
  it('offers classified aid sources only, never the line’s own description, A to Z', () => {
    expect(reclassifyTargets(SOURCES.sources, SAM_NO_REQUEST).map((t) => t.description)).toEqual([
      'Camp aid · Quest',
      'Grantor A grant',
      'Grantor C full-ride program',
      'Grantor E grant 2027',
    ])
    // The mismatch line is "Camp aid · Quest": Summer is a target there, Quest is not.
    expect(reclassifyTargets(SOURCES.sources, SAMUEL_MISMATCH).map((t) => t.description)).toContain(
      'Camp aid · Summer'
    )
    expect(
      reclassifyTargets(SOURCES.sources, SAMUEL_MISMATCH).map((t) => t.description)
    ).not.toContain('Camp aid · Quest')
  })

  it('says who paid beside each target (D88)', () => {
    expect(targetWords(GRANTOR_C_FULL_RIDE)).toBe('Grantor C full-ride program (outside)')
    expect(targetWords(CAMP_QUEST)).toBe('Camp aid · Quest (camp aid)')
    expect(targetWords(UNCLASSIFIED)).toBe('Returning-family bonus 2027')
  })
})

describe('what each group says Confirm does (M5)', () => {
  it('names the camp-aid sentence by reason, and says a no-request line has nothing to mark', () => {
    expect(CONFIRM_DOES.several).toBe('Camp aid: Confirm marks the round Posted.')
    expect(CONFIRM_DOES.program_mismatch).toBe('Camp aid: Confirm marks the round Posted.')
    expect(CONFIRM_DOES.no_request).toBe(
      'Camp aid: this line has no request to mark, so it is reclassified or left with a note.'
    )
  })

  it('draws counts, then the sentence, in each group heading', () => {
    expect(groupWords([JOHNSON_SPLIT, GARCIA_WITHHELD, CHEN_EXACT])).toBe(
      '3 households · 3 lines · Camp aid: Confirm marks the round Posted.'
    )
    expect(groupWords([SAM_NO_REQUEST])).toBe(
      '1 household · 1 line · Camp aid: this line has no request to mark, so it is reclassified or left with a note.'
    )
  })
})

describe('the open line and the tab count (M5)', () => {
  it('reads "N lines open · $X camp aid", the grant part only when there are grant lines', () => {
    expect(openLineWords(5, 6920, [])).toBe('5 lines open · $6,920 camp aid')
    expect(openLineWords(1, 900, [])).toBe('1 line open · $900 camp aid')
  })

  it('counts both kinds of line in N and adds the outside grants', () => {
    const grants = [{ amount: 1500 }, { amount: 500.5 }]
    expect(openLineWords(5, 6920, grants)).toBe(
      '7 lines open · $6,920 camp aid · $2,000.50 outside grants'
    )
  })

  it('the tab count is the camp-aid open_count plus the grant lines that need a camper', () => {
    expect(toPlaceCount(30, 10)).toBe(40)
    expect(toPlaceCount(0, 3)).toBe(3)
  })

  it('has no count until both reads have loaded, and draws none for zero', () => {
    expect(toPlaceCount(undefined, 10)).toBeNull()
    expect(toPlaceCount(30, undefined)).toBeNull()
    expect(toPlaceCount(0, 0)).toBeNull()
  })

  it('keeps only one household’s grant lines under a scope', () => {
    const a = { grant: { household_cm_id: 1000001 } }
    const b = { grant: { household_cm_id: 1000002 } }
    expect(grantLinesFor([a, b], null)).toEqual([a, b])
    expect(grantLinesFor([a, b], 1000002)).toEqual([b])
  })
})
