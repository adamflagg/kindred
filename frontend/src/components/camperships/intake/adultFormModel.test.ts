/**
 * The adult aid form on Form intake (adult aid form design §10; approved mock v2, every knob at its ★): the words of
 * every cell, panel and editor, from the mock. Fictional data (adultFormFixtures).
 */
import { describe, expect, it } from 'vitest'

import {
  ADULT_SESSIONS,
  ANA,
  CASEY,
  DANA,
  DANA_LINK,
  EMMA_GF,
  FC4A,
  GRACE,
  HANNAH,
  JORDAN,
  LAST_READ,
  LIN,
  NOAH,
  REFUSED,
  response,
} from './adultFormFixtures'
import {
  alsoLine,
  figureRows,
  gridCounts,
  gridRows,
  ignoreBody,
  ignoredWords,
  ignoreEffects,
  ignoreProblem,
  IGNORE_KINDS,
  inGridSegment,
  lastReadWords,
  linkEffects,
  matchEvidence,
  noteParts,
  pulledWords,
  refusedBand,
  responseBecame,
  responseCamper,
  responseLines,
  responseNoRequestLine,
  signedLine,
  typedLine,
  type IntakeGridRow,
} from './adultFormModel'
import { sessionIndex } from './intakeModel'
import { became, ROWS_2027, SESSIONS } from './intakeFixtures'
import type { FormIntakeRowOut } from './intakeTypes'

const names = sessionIndex([...SESSIONS, ...ADULT_SESSIONS])
const text = (segs: ReadonlyArray<{ text: string }>) => segs.map((s) => s.text).join('')
const bold = (segs: ReadonlyArray<{ text: string; bold?: boolean }>) =>
  segs.filter((s) => s.bold === true).map((s) => s.text)

describe('figureRows (the opened row: five priced figures, the parse note beside its figure, K2 a)', () => {
  it('lists the priced figures with the season-relative years, money in whole dollars', () => {
    expect(figureRows(response(), 2027).map((f) => [f.label, f.value])).toEqual([
      ['Ask', '$400'],
      ['2026 gross income', '$80,000'],
      ['2027 expected income', '$72,000'],
      ['Savings and investments', '$30,000'],
      ['Medical out of pocket', '$2,000'],
    ])
  })

  it('reads an unread figure as unknown, never $0, its note beside it', () => {
    const expected = figureRows(HANNAH, 2027)[2]
    expect(expected).toEqual({
      label: '2027 expected income',
      value: null,
      note: '“between 70 and 80k”: a range, not read',
    })
  })

  it("puts each hedged figure's own note beside it, and a rule's note after a parse note", () => {
    expect(figureRows(GRACE, 2027).map((f) => f.note)).toEqual([
      '',
      'read “approx 85k” as $85,000',
      'read “85K” as $85,000',
      'read “none” as $0, reported',
      '',
    ])
    expect(figureRows(DANA, 2027)[4]?.note).toBe('above $5,000: $1,400 is subtracted')
  })
})

describe('noteParts (the typed words in a note stand out in plain ink)', () => {
  it('splits a note on its quoted typed text, curly or straight', () => {
    expect(noteParts('read “approx 85k” as $85,000')).toEqual([
      { text: 'read ', quoted: false },
      { text: '“approx 85k”', quoted: true },
      { text: ' as $85,000', quoted: false },
    ])
    expect(noteParts("read 'about 400' as $400")[1]).toEqual({ text: "'about 400'", quoted: true })
    expect(noteParts('a range: not read')).toEqual([{ text: 'a range: not read', quoted: false }])
  })
})

describe('alsoLine (the answers that price nothing, on one muted line)', () => {
  it('reads blank mortgage or rent as none, other figures as money, dependents and unemployment in words', () => {
    expect(alsoLine(response())).toBe(
      'Also: mortgage none · rent $2,200 · student loans $250 · 0 dependents · unemployment no'
    )
  })

  it('shows a monthly figure as typed with how it was read', () => {
    expect(alsoLine(GRACE)).toBe(
      'Also: mortgage none · rent $1,500/mo, read as $18,000 a year · student loans $0 · 0 dependents · unemployment no'
    )
  })

  it('says one dependent, and unknown for an answer not read', () => {
    const one = response({
      figures: response().figures.map((f) => (f.field === 'num_children' ? { ...f, value: 1 } : f)),
      unemployment: null,
    })
    expect(alsoLine(one)).toContain('1 dependent · unemployment unknown')
  })
})

describe('signedLine', () => {
  it('quotes the typed signature with the agreement day', () => {
    expect(signedLine(response())).toBe('Signed “Rachel Garcia”, Nov 5')
  })
})

describe('matchEvidence (the Match panel)', () => {
  it('a confirmed response: the clues it matched on, and the registration', () => {
    const m = matchEvidence(response(), names)
    expect(text(m.segs)).toBe('Matched on name, birthdate and email')
    expect(bold(m.segs)).toEqual(['name, birthdate and email'])
    expect(m.muted).toBe("· enrolled, Women's Weekend")
  })

  it('names the typed name when the name was not a clue', () => {
    expect(text(matchEvidence(GRACE, names).segs)).toBe(
      'Matched on birthdate and email; the name was typed “Grace Whitfield”'
    )
    expect(matchEvidence(GRACE, names).muted).toBe(
      '· enrolled, Adult Reg: Family Camp 4 (Labor Day Weekend)'
    )
  })

  it('a staff link says who linked it and when', () => {
    const m = matchEvidence(
      response({
        match_status: 'staff',
        linked_by: 'pat.garcia@example.com',
        linked_at: '2026-11-07T18:00:00Z',
      }),
      names
    )
    expect(text(m.segs)).toBe('Linked by Pat, Nov 7')
  })

  it('suggested with two people: how many, the weekend, and the one clue', () => {
    const m = matchEvidence(DANA, names)
    expect(text(m.segs)).toBe(
      'Suggested: two people registered for Family Camp 4 match on name only'
    )
    expect(bold(m.segs)).toEqual(['two people', 'name'])
  })

  it('suggested with one person: who, their session, the clue, and the near miss', () => {
    const m = matchEvidence(NOAH, names)
    expect(text(m.segs)).toBe('Suggested: Noah Johnson (FC6 Adults) matches on name')
    expect(m.muted).toBe('· birthdate: day and month swapped')
  })

  it('registered elsewhere: the weekend chosen, and the one registered for', () => {
    const m = matchEvidence(EMMA_GF, names)
    expect(text(m.segs)).toBe('Chose Family Camp 2, registered for Family Camp 4 Adults')
    expect(m.muted).toBe('· Emma Johnson matches on name, birthdate and email, in another weekend')
  })

  it('not registered: no registration found, and when the hourly read last checked', () => {
    const m = matchEvidence(CASEY, names)
    expect(text(m.segs)).toBe('No 2027 registration found')
    expect(m.muted).toBe('· checked every hour, last at 14:20')
  })

  it('ignored: no match was tried after the ignore', () => {
    const m = matchEvidence(LIN, names)
    expect(text(m.segs)).toBe('Ignored')
    expect(m.muted).toBe('· no match was tried after Pat ignored it. Link… shows who it matches')
  })
})

describe('responseLines (the Responses panel)', () => {
  it('one response, filed', () => {
    expect(responseLines(response())).toEqual([{ text: 'This response, Nov 5', current: true }])
  })

  it('an earlier response replaced before any decision, with what it said', () => {
    expect(responseLines(HANNAH)).toEqual([
      { text: 'This response, Nov 9', current: true },
      {
        text: 'Earlier response, Nov 5, replaced Nov 9, before any decision (ask $450, 2026 gross $67,000)',
        current: false,
      },
    ])
  })

  it('a second response after a decision: flagged, not applied; this one prices the request', () => {
    expect(responseLines(JORDAN)).toEqual([
      { text: 'This response, Nov 4 · prices the request', current: true },
      {
        text: 'Second response, Nov 10, after a decision (2026 gross $58,000): flagged, not applied',
        current: false,
      },
    ])
  })

  it('a response deleted in Google is kept here', () => {
    expect(responseLines(ANA)).toEqual([
      { text: 'This response, Nov 4 · deleted in Google Nov 11, kept here', current: true },
    ])
  })
})

describe('responseCamper (a response no person holds: the typed name and a dashed "not linked" chip)', () => {
  it('quotes the typed name, its title saying where it came from', () => {
    expect(responseCamper(DANA)).toEqual({
      name: '“Dana Okafor”',
      title: 'Typed on the form: “Dana Okafor”',
      chip: 'not linked',
      chipTitle: 'No person yet: Link… picks one from the 2027 registrations',
    })
  })
})

describe('responseBecame (the Became cell of a response with no person)', () => {
  it('suggested: amber, the candidates and the clue', () => {
    expect(responseBecame(DANA, names)).toMatchObject({
      tone: 'amber',
      words: 'Suggested',
      why: 'Dana Okafor or Dana Okafor-Reyes · name only',
    })
    expect(responseBecame(NOAH, names).why).toBe(
      'Noah Johnson · name; birthdate: day and month swapped'
    )
  })

  it('registered elsewhere: amber, the weekend chosen and the one registered for, tiny', () => {
    expect(responseBecame(EMMA_GF, names)).toMatchObject({
      tone: 'amber',
      words: 'Registered elsewhere',
      why: 'Chose FC2, registered for FC4 Adults',
    })
  })

  it('not registered: sky, checked hourly', () => {
    expect(responseBecame(CASEY, names)).toMatchObject({
      tone: 'sky',
      words: 'Not registered',
      why: 'No 2027 registration found · checked hourly',
    })
  })

  it('ignored: stone, who, when and the reason', () => {
    const b = responseBecame(LIN, names)
    expect(b).toMatchObject({
      tone: 'stone',
      words: 'Ignored',
      why: "Pat, Nov 7: “Called: says she doesn't need aid this year”",
    })
    expect(b.title).toContain('Never matched again. Link… undoes it.')
  })
})

describe("responseNoRequestLine (the opened row's second line, for a response no person holds)", () => {
  it('says no request until it is linked, and what was typed', () => {
    expect(responseNoRequestLine(DANA)).toBe(
      'No request until the response is linked · typed “Dana Okafor”'
    )
  })

  it('an ignored one says who, when, why and that it is never matched again', () => {
    expect(responseNoRequestLine(LIN)).toBe(
      "Ignored by Pat, Nov 7 · not asking for 2027 aid: “Called: says she doesn't need aid this year” · never matched again"
    )
  })
})

describe('the K4 status slot: Last read from Google, beside Pull Now', () => {
  it('reads the last read in camp time, the title saying it reads hourly', () => {
    expect(lastReadWords(LAST_READ)).toEqual({
      text: 'Last read from Google: 14:20',
      title:
        'Adult aid form last read from Google Nov 12, 14:20. The dashboard reads it every hour.',
      tone: 'muted',
    })
  })

  it('turns amber when the read was refused', () => {
    expect(lastReadWords(REFUSED)).toEqual({
      text: '⚠ Read refused 14:20',
      title:
        'The 14:20 read from Google was refused: it returned 0 of 12 responses, so nothing was removed. Last good read 13:20.',
      tone: 'warn',
    })
  })

  it('says nothing in a season with no adult aid form', () => {
    expect(lastReadWords(null)).toBeNull()
  })

  it("Pull Now's result: the counts when the read ran, else that it started", () => {
    expect(pulledWords({ status: 'done', responses: 12, new: 1, at: '2026-11-12T22:26:00Z' })).toBe(
      '✓ Read from Google: 12 responses, 1 new (14:26)'
    )
    expect(pulledWords({ status: 'started' })).toBe(
      '✓ Reading the adult aid form from Google: the list refreshes when it lands'
    )
  })
})

describe('refusedBand (the warn row on the grid, in every segment)', () => {
  it('says what was refused and why nothing was removed, then what happens next', () => {
    expect(refusedBand(REFUSED)).toEqual({
      lead: '⚠ The 14:20 read was refused: Google returned 0 of 12 responses, so nothing was removed.',
      meta: 'Every response here is as of 13:20. The hourly read tries again; Pull Now tries now.',
    })
  })

  it('falls back to the status words when the counts are not sent, and draws nothing for a good read', () => {
    expect(
      refusedBand({
        last_pulled_at: REFUSED.last_pulled_at,
        refused: true,
        last_pull_status: 'refused: 4 of 6 responses missing',
      })?.lead
    ).toBe('⚠ The 14:20 read was refused (4 of 6 responses missing), so nothing was removed.')
    expect(refusedBand(LAST_READ)).toBeNull()
    expect(refusedBand(null)).toBeNull()
  })
})

describe('Ignore…', () => {
  it("offers the mock's four reasons", () => {
    expect(IGNORE_KINDS(2027).map((k) => k.label)).toEqual([
      'A test or junk response',
      'A duplicate of another response',
      'Not asking for 2027 aid',
      'Other',
    ])
  })

  it('needs a reason picked, and words for Other', () => {
    expect(ignoreProblem({ kind: null, reason: '' })).toBe('A reason is required')
    expect(ignoreProblem({ kind: 'other', reason: '  ' })).toBe('Say why in Reason')
    expect(ignoreProblem({ kind: 'test', reason: '' })).toBeNull()
  })

  it('sends the kind and the trimmed reason', () => {
    expect(ignoreBody({ kind: 'test', reason: " Ben's test " })).toEqual({
      kind: 'test',
      reason: "Ben's test",
    })
  })

  it('says what ignoring does, one effect per line', () => {
    expect(ignoreEffects(CASEY)).toEqual([
      {
        sym: 'ok',
        lead: 'Leaves Responses to link',
        then: '→ All forms shows it as Ignored, with your reason',
      },
      { sym: 'ok', lead: '', rest: 'Never matched again, even if Casey Sam registers later' },
      { sym: 'info', lead: '', rest: 'Logged with your name' },
    ])
  })

  it("an ignored response's words: who, when, its kind and its reason", () => {
    expect(ignoredWords(LIN)).toEqual({
      who: 'Pat',
      day: 'Nov 7',
      kind: 'not asking for 2027 aid',
      reason: "Called: says she doesn't need aid this year",
    })
  })
})

describe('Link…', () => {
  it('the typed line: what the response says, the respondent email only here', () => {
    expect(typedLine(DANA_LINK)).toEqual([
      { label: 'Typed: ', value: '“Dana Okafor”' },
      { label: ' · born ', value: '1986-03-12' },
      { label: ' · ', value: 'sam.lee@example.com' },
      { label: ' · chose ', value: 'Family Camp 4: Labor Day (Sep 3-6)' },
    ])
  })

  it('with a pick: links, makes the request priced from this form, never re-matched, logged', () => {
    expect(linkEffects(DANA, DANA.candidates[0] ?? null, names)).toEqual([
      {
        sym: 'ok',
        lead: 'Links the response to Dana Okafor',
        then: "→ makes the FC4 Adults request, asking $600, priced from this form's own figures",
      },
      {
        sym: 'ok',
        lead: '',
        rest: 'The hourly read never re-matches it',
        then: '→ a wrong link is fixed with Link… again',
      },
      { sym: 'info', lead: '', rest: 'Logged with your name' },
    ])
  })

  it('registered elsewhere: the request follows the registration, noted', () => {
    const fx = linkEffects(EMMA_GF, EMMA_GF.candidates[0] ?? null, names)
    expect(fx[1]).toEqual({
      sym: 'hand',
      lead: '',
      rest: 'The request follows the registration, Family Camp 4 Adults, not the Family Camp 2 the form chose',
      then: '→ noted "session differs from the answer"',
    })
  })

  it('on an ignored response: undoes the ignore first', () => {
    const fx = linkEffects(
      LIN,
      { ...EMMA_GF.candidates[0]!, camper_name: 'Lin Chen', session_cm_ids: [FC4A] },
      names
    )
    expect(fx[0]).toEqual({
      sym: 'ok',
      lead: 'Undoes the ignore',
      then: "→ it leaves Ignored; the log keeps Pat's ignore and your link",
    })
  })

  it('with no one to pick: leave it, or Ignore…', () => {
    expect(linkEffects(CASEY, null, names)).toEqual([
      {
        sym: 'hand',
        lead: '',
        rest: 'Nothing to link yet: leave it',
        then: '→ the hourly read links it once Casey Sam registers',
      },
      { sym: 'hand', lead: '', rest: 'A test or junk response: Ignore… instead' },
      { sym: 'info', lead: '', rest: 'Logged with your name' },
    ])
  })
})

describe('gridRows (Form intake with the responses no person holds)', () => {
  const rows: FormIntakeRowOut[] = ROWS_2027
  const grid = gridRows(rows, [
    DANA,
    CASEY,
    LIN,
    response(),
    { ...HANNAH, match_status: 'superseded', row_key: '' },
  ])
  const keys = (list: readonly IntakeGridRow[]) => list.map((r) => r.key)

  it("keeps every Form intake row, then adds a row for each live response no person holds; a superseded one shows in its successor's Responses only", () => {
    expect(grid.length).toBe(rows.length + 3)
    expect(keys(grid.slice(rows.length))).toEqual([
      'response:resp-dana',
      'response:resp-casey',
      'response:resp-lin',
    ])
  })

  it('attaches a linked response to its row by row key', () => {
    const linked = gridRows([{ ...rows[0]!, key: '1000009:1000091' }], [response()])
    expect(linked[0]).toMatchObject({ kind: 'row', response: { response_id: 'resp-rachel' } })
  })

  it('puts responses to link in their own segment, ignored ones under All forms only', () => {
    const link = grid.filter((r) => inGridSegment(r, 'link'))
    expect(keys(link)).toEqual(['response:resp-dana', 'response:resp-casey'])
    expect(grid.filter((r) => inGridSegment(r, 'all')).length).toBe(grid.length)
    expect(inGridSegment(grid[grid.length - 1]!, 'look')).toBe(false)
  })

  it('counts each segment, the chip still narrowing only Form intake rows', () => {
    const counts = gridCounts(grid, false)
    expect(counts.link).toBe(2)
    expect(counts.all).toBe(grid.length)
    expect(gridCounts(grid, true).link).toBe(0)
  })
})

describe('became helpers stay compatible with 2026 rows (no source, no flags)', () => {
  it('a 2026 became has no adult-form flag', async () => {
    const { becameFlag } = await import('./adultFormModel')
    expect(becameFlag(became({}))).toBeNull()
  })
})
