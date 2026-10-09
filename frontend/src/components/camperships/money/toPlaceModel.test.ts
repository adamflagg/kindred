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
import { grantRow } from '../grants/grantsFixtures'
import { moneyCsv } from '../kit/money'
import { groupWords } from './toPlaceColumns'
import {
  allLines,
  candidateDetail,
  candidateLabel,
  candidateShort,
  confirmBody,
  confirmCell,
  confirmEffects,
  confirmSummary,
  evidenceLines,
  exactAmount,
  GRANT_CONFIRM_DOES,
  GRANT_DOES,
  grantCsvRows,
  grantLinesFor,
  GROUP_DOES,
  isOpen,
  leadWords,
  lineCell,
  lineWordsBare,
  noSuggestionEffects,
  lineWords,
  NOTHING_MARKED,
  openLineWords,
  placeChoices,
  placedTitle,
  placedWords,
  reclassifyTargets,
  requestLabels,
  stillNotPlacedWords,
  suggestionShort,
  suggestionWords,
  suggestsSplit,
  targetWords,
  toPlaceCount,
  toPlaceCsvName,
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

describe('the line and its cells (design-language §13, §14, §15)', () => {
  it('leads the line cell with what differs line to line: the date, who, then the description', () => {
    expect(lineCell(JOHNSON_SPLIT)).toBe('May 14 · to the household · Camp aid · Summer')
    expect(lineCell(GARCIA_WITHHELD)).toBe('Apr 3 · to Liam Garcia · Camp aid · Summer')
    expect(lineCell({ ...JOHNSON_SPLIT, posted_on: null })).toBe(
      'to the household · Camp aid · Summer'
    )
  })

  it('short-names a candidate by its session, and a household request with ⌂ and the household label', () => {
    const [emma] = JOHNSON_SPLIT.candidates
    expect(emma && candidateShort(emma, JOHNSON_SPLIT)).toBe('Emma Johnson · Session 2')
    const household = {
      ...(emma as NonNullable<typeof emma>),
      person_cm_id: 0,
      camper: '',
      session: 'Family Camp 2: Fall Harvest Weekend',
      session_type: 'family',
    }
    expect(
      candidateShort(household, { ...JOHNSON_SPLIT, household_label: 'Mia & Noah Johnson' })
    ).toBe('⌂ Mia & Noah Johnson · FC2')
    // A household that shares the line's requests is named by its family, as the long form does.
    expect(
      candidateShort({ ...household, household_cm_id: 1000009, family: 'Johnson' }, JOHNSON_SPLIT)
    ).toBe('⌂ Johnson household · FC2')
  })
})

describe('what Confirm says for a line with no suggestion (mock `fx`)', () => {
  it('says a no-request line has nothing to mark Posted, and what to do instead', () => {
    expect(noSuggestionEffects(SAM_NO_REQUEST)).toEqual([
      {
        sym: 'hand',
        lead: 'Nothing to mark Posted',
        text: ': no application this season',
        then: '→ Reclassify… or Leave With a Note…',
      },
    ])
  })

  it('says the dashboard does not choose between equal matches', () => {
    const [emma, samuel] = JOHNSON_SPLIT.candidates
    const tied = {
      ...JOHNSON_SPLIT,
      amount: 900,
      unplaced: 900,
      suggestion: null,
      candidates: [
        { ...(emma as NonNullable<typeof emma>), not_yet_in_campminder: 900 },
        { ...(samuel as NonNullable<typeof samuel>), not_yet_in_campminder: 900 },
      ],
    }
    expect(noSuggestionEffects(tied)).toEqual([
      {
        sym: 'hand',
        lead: "The dashboard doesn't choose",
        text: ': Emma Johnson · Session 2 and Samuel Johnson · Session 2 each need $900',
        then: '→ Place on Another Request… and pick one',
      },
    ])
  })

  it('has nothing to add for a line that has a suggestion', () => {
    expect(noSuggestionEffects(CHEN_EXACT)).toEqual([])
  })

  it('draws the opened row’s line without its amount, which is drawn bold before it', () => {
    expect(lineWordsBare(JOHNSON_SPLIT)).toBe(
      'Camp aid · Summer · posted to the household · May 14'
    )
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

  it('has a short bold form for the cell: a place, a split by its amounts, or why there is none', () => {
    expect(suggestionShort(CHEN_EXACT)).toBe('Place on Olivia Chen · Quest')
    expect(suggestionShort(JOHNSON_SPLIT)).toBe('Split $2,200 / $1,420')
    expect(suggestionShort(SAM_NO_REQUEST)).toBe('Nothing to suggest: no request')
    expect(suggestionShort({ ...GARCIA_WITHHELD, suggestion: null })).toBe('No suggestion')
  })

  it('says two equal matches when the dashboard will not choose between them (D12)', () => {
    const [emma, samuel] = JOHNSON_SPLIT.candidates
    const tied = {
      ...JOHNSON_SPLIT,
      amount: 900,
      unplaced: 900,
      suggestion: null,
      candidates: [
        { ...(emma as NonNullable<typeof emma>), not_yet_in_campminder: 900 },
        { ...(samuel as NonNullable<typeof samuel>), not_yet_in_campminder: 900 },
      ],
    }
    expect(suggestionShort(tied)).toBe('No suggestion: two equal matches')
    expect(evidenceLines(tied)).toEqual([
      '○ Emma Johnson · Session 2 and Samuel Johnson · Session 2 each need exactly $900',
      '○ the dashboard never chooses between equal matches',
    ])
    expect(confirmCell(tied)).toMatchObject({ sym: 'hand', words: 'Pick one of 2' })
  })

  it('shows the evidence one fact per line, each with a check', () => {
    expect(evidenceLines(CHEN_EXACT)).toEqual([
      '✓ exact amount ($1,500)',
      "✓ the family's only request",
    ])
    expect(evidenceLines(SAM_NO_REQUEST)).toEqual([])
  })

  it('draws the rounds it marks Posted as ✓ lines, and a part nothing is marked on as a plain place', () => {
    expect(confirmEffects(JOHNSON_SPLIT)).toEqual([
      { sym: 'ok', lead: 'Marks Posted', text: ' · Emma Johnson · Session 2 · R2 · $780' },
      { sym: 'info', text: 'Places $1,420 on Samuel Johnson · Session 2' },
    ])
    expect(confirmEffects(CHEN_EXACT)).toEqual([
      { sym: 'ok', lead: 'Marks Posted', text: ' · Olivia Chen · Quest · R2 · $1,500' },
    ])
    expect(confirmEffects(SAM_NO_REQUEST)).toEqual([])
  })

  it('lays the owner’s 10-03 “not marked Posted” sentence out in short lines from its parts (★6)', () => {
    expect(confirmEffects(GARCIA_WITHHELD)).toEqual([
      { sym: 'info', text: 'Places $600 on Liam Garcia · Session 2' },
      {
        sym: 'warn',
        lead: 'R2 not marked Posted',
        text: ': income corrected Apr 20, after the Apr 3 posting',
        then: "→ Check the offer, then Mark Posted · it keeps the higher of Apr 3's amount and today's",
      },
    ])
  })

  it('lays a round Confirm leaves out as ○ with what CampMinder holds and what it needs', () => {
    const line = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        would_tick: [],
        would_lock: 0,
        would_leave: [
          {
            request_id: 'reqolivia000003',
            round: 2,
            why: 'CampMinder holds $1,000 on this request; Round 2 needs $1,500: mark it posted by hand if that is right',
            kind: 'short' as const,
            holds: 1000,
            needs: 1500,
          },
        ],
      },
    }
    expect(confirmEffects(line)).toEqual([
      { sym: 'info', text: 'Places $1,500 on Olivia Chen · Quest' },
      {
        sym: 'hand',
        lead: 'R2 stays unchecked',
        text: ': CampMinder holds $1,000 · R2 needs $1,500',
        then: "→ Mark Posted by hand if that's right",
      },
    ])
  })

  it('says a round a person unchecked was unchecked, with no amounts', () => {
    const line = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        would_tick: [],
        would_lock: 0,
        would_leave: [
          {
            request_id: 'reqolivia000003',
            round: 1,
            why: 'You unchecked Posted on this round: mark it posted again by hand if that is right',
            kind: 'unchecked' as const,
          },
        ],
      },
    }
    expect(confirmEffects(line).at(-1)).toEqual({
      sym: 'hand',
      lead: 'R1 stays unchecked',
      text: ': you unchecked Posted',
      then: "→ Mark Posted again if that's right",
    })
  })

  it('falls back to the server’s own sentence when a read carries no parts for a left round', () => {
    const line = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        would_tick: [],
        would_lock: 0,
        would_leave: [{ request_id: 'reqolivia000003', round: 2, why: 'The server’s words' }],
      },
    }
    expect(confirmEffects(line).at(-1)).toMatchObject({ sym: 'hand', text: ': The server’s words' })
  })

  it('has one short cell for the table, symbol first: ✓ posted, ○ by hand, ⚠ withheld', () => {
    expect(confirmCell(JOHNSON_SPLIT)).toMatchObject({ sym: 'ok', words: 'R2 Posted · $780' })
    expect(confirmCell(GARCIA_WITHHELD)).toMatchObject({ sym: 'warn', words: 'R2 by hand' })
    expect(confirmCell(SAM_NO_REQUEST)).toMatchObject({ sym: null, words: 'Nothing to confirm' })
    expect(confirmSummary(JOHNSON_SPLIT)).toBe('✓ R2 Posted · $780')
    expect(confirmSummary(GARCIA_WITHHELD)).toBe('⚠ R2 by hand')
    expect(confirmSummary(SAM_NO_REQUEST)).toBe('Nothing to confirm')
  })

  it('carries the full words of the cell in its title', () => {
    expect(confirmCell(GARCIA_WITHHELD).title).toContain('R2 not marked Posted')
    expect(confirmCell(JOHNSON_SPLIT).title).toContain('Marks Posted')
    expect(confirmCell(SAM_NO_REQUEST).title).toBe('Nothing to confirm: no request to mark Posted')
  })

  it('says it marks nothing Posted when no round is covered in full (D146)', () => {
    const none = {
      ...CHEN_EXACT,
      suggestion: CHEN_EXACT.suggestion && {
        ...CHEN_EXACT.suggestion,
        would_tick: [],
        would_lock: 0,
      },
    }
    expect(confirmEffects(none).at(-1)).toEqual({ sym: 'info', text: NOTHING_MARKED })
    expect(NOTHING_MARKED).toBe('Marks nothing Posted.')
    expect(confirmCell(none)).toMatchObject({ sym: null, words: 'Nothing marked' })
  })

  it('reads a fresh preview in place of the read’s when one is given (P-4)', () => {
    const fresh = {
      would_tick: [{ request_id: 'reqolivia000003', round: 2, amount: 1400 }],
      would_lock: 1400,
      would_leave: [],
      would_not_tick: [],
    }
    expect(confirmEffects(CHEN_EXACT, fresh)).toEqual([
      { sym: 'ok', lead: 'Marks Posted', text: ' · Olivia Chen · Quest · R2 · $1,400' },
    ])
    expect(confirmBody(CHEN_EXACT, fresh)).toMatchObject({ expected_locked: '1400.00' })
    // No suggestion: nothing to confirm, whatever a preview says.
    expect(confirmEffects(SAM_NO_REQUEST, fresh)).toEqual([])
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

describe('what a placement did (§4.10: the result lists exactly what was marked Posted)', () => {
  const labels = requestLabels(allLines(TO_PLACE))
  const marked = {
    year: 2027,
    operation_id: 'op0000000000001',
    placed: [3000001],
    ticked: [{ request_id: EMMA_REQ, round: 2, amount: 780 }],
    left_to_tick: [],
    not_ticked: [],
  }

  it('says it short in the status slot: how much, then ✓ the round Posted, ⚠ or ○ by hand', () => {
    expect(placedWords(marked, [JOHNSON_SPLIT])).toBe('Johnson: $3,620 placed · ✓ R2 Posted · $780')
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
        [GARCIA_WITHHELD, SAMUEL_MISMATCH]
      )
    ).toBe('2 lines placed · nothing marked Posted · ⚠ R2 by hand · rules not locked yet')
    expect(
      placedWords(
        {
          year: 2027,
          operation_id: 'op0000000000003',
          placed: [3000003],
          ticked: [],
          left_to_tick: [{ request_id: 'reqolivia000003', round: 2, why: 'x' }],
        },
        [CHEN_EXACT]
      )
    ).toBe('Chen: $1,500 placed · nothing marked Posted · ○ R2 by hand')
  })

  it('counts several rounds marked Posted together, to the cent', () => {
    expect(
      placedWords(
        {
          ...marked,
          placed: [3000001, 3000003],
          ticked: [
            { request_id: EMMA_REQ, round: 2, amount: 780.1 },
            { request_id: 'reqolivia000003', round: 2, amount: 1500 },
          ],
        },
        [JOHNSON_SPLIT, CHEN_EXACT]
      )
    ).toBe('2 lines placed · ✓ 2 rounds Posted · $2,280.10')
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
        () => 'Mei & David Chen'
      )
    ).toBe('Mei & David Chen: $1,500 placed · nothing marked Posted')
  })

  it('keeps every request named in the title, as the result always listed them', () => {
    expect(placedTitle(marked, [JOHNSON_SPLIT], labels)).toBe(
      'Johnson: $3,620 placed. Marked Posted: Emma Johnson · Session 2 Round 2 · $780.'
    )
    expect(
      placedTitle(
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
      `2 lines placed. Nothing marked Posted. Not marked Posted: Liam Garcia · Session 2 (${GARCIA_WHY}). Rules not locked yet: award tables.`
    )
    expect(
      placedTitle(
        {
          year: 2027,
          operation_id: 'op0000000000003',
          placed: [3000003],
          ticked: [],
          left_to_tick: [
            {
              request_id: 'reqolivia000003',
              round: 2,
              why: 'CampMinder holds $1,000 on this request; Round 2 needs $1,500: mark it posted by hand if that is right',
            },
          ],
        },
        [CHEN_EXACT],
        labels
      )
    ).toBe(
      'Chen: $1,500 placed. Nothing marked Posted. Left unchecked: Olivia Chen · Quest Round 2 (CampMinder holds $1,000 on this request; Round 2 needs $1,500: mark it posted by hand if that is right).'
    )
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
      parts: [{ request_id: 'reqliamquest005', amount: 600 }],
    }
    expect(confirmEffects({ ...GARCIA_WITHHELD, suggestion: null }, would)).toEqual([
      { sym: 'ok', lead: 'Marks Posted', text: ' · Liam Garcia · Quest · R1 · $600' },
    ])
    expect(
      confirmEffects(JOHNSON_SPLIT, {
        would_tick: [],
        would_lock: 0,
        would_leave: [],
        would_not_tick: [],
      }).at(-1)
    ).toEqual({ sym: 'info', text: NOTHING_MARKED })
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

describe('what each group says Confirm does (M5; design-language §16, answers §3)', () => {
  it('gives a bold lead then → and the result, one callout per group', () => {
    expect(GROUP_DOES.several).toEqual({
      tone: 'default',
      lines: [{ lead: 'Confirm', text: ' → marks the round Posted', posted: true, ok: true }],
    })
    expect(GROUP_DOES.program_mismatch.lines).toEqual([
      { lead: 'Confirm', text: ' → marks the round Posted', ok: true },
      { pre: 'Or ', lead: 'Reclassify', text: ' if the money belongs to that other program' },
    ])
  })

  it('says a no-request line has nothing to mark Posted, under an amber rule', () => {
    expect(GROUP_DOES.no_request).toEqual({
      tone: 'warn',
      lines: [{ lead: 'Nothing to mark Posted', text: ' → Reclassify it, or Leave With a Note' }],
    })
  })

  it('words the outside grant’s callout in two short lines, sky-ruled (owner: "friendly-ization")', () => {
    expect(GRANT_DOES).toEqual({
      tone: 'grant',
      lines: [
        { lead: 'Confirm', text: " → lowers the camper's share in that round" },
        { text: "Posted and the camp's budget don't move" },
      ],
    })
    expect(GRANT_CONFIRM_DOES).toBe(
      "Confirm → lowers the camper's share in that round; Posted and the camp's budget don't move"
    )
  })

  it('draws counts in each group heading, never money', () => {
    expect(groupWords([JOHNSON_SPLIT, GARCIA_WITHHELD, CHEN_EXACT])).toBe('3 lines · 3 households')
    expect(groupWords([SAM_NO_REQUEST])).toBe('1 line · 1 household')
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

  it('splits the same words for the toolbar: the count bold, the figures muted', () => {
    expect(leadWords(5, 6920, [{ amount: 1500 }])).toEqual({
      head: '6 lines open',
      rest: '$6,920 camp aid · $1,500 outside grants',
    })
    expect(leadWords(1, 900, [])).toEqual({ head: '1 line open', rest: '$900 camp aid' })
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

describe('grantCsvRows (final audit O8)', () => {
  it('names a family with its tie-break when two households share a label, as every table does', () => {
    const need = {
      grant: grantRow({
        transaction_cm_id: 4000050,
        household_cm_id: 1000050,
        label: 'Pat Garcia',
        label_tiebreak: '#1000050',
      }),
      household_applied: true,
      suggestion: null,
      candidates: [],
    }
    const [row] = grantCsvRows([need], undefined)
    expect(row?.[0]).toBe('Pat Garcia · #1000050')
    // The camp-aid table gained an Amount column (final UX), so the grant rows carry it in the same slot.
    expect(row?.[5]).toBe(moneyCsv(need.grant.amount))
    expect(row?.[9]).toBe('Outside grant posted to the family')
  })
})
