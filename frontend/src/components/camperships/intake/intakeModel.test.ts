import { describe, expect, it } from 'vitest'

import {
  AVA,
  CHEN_HH,
  EMMA,
  LIAM,
  LUCAS,
  MATEO,
  OKAFOR_HH,
  OLIVIA,
  RILEY,
  ROWS_2027,
  S2,
  S3,
  SESSIONS,
  THEO,
  TLI,
  TWR,
  WFC,
  FC2,
  aidOnNoRequestRead,
  became,
} from './intakeFixtures'
import {
  addBody,
  addEffects,
  addProblem,
  addedStatus,
  amberAid,
  askedWords,
  becameAside,
  becameSession,
  becameStatus,
  becameTitle,
  INTAKE_WORDS,
  enrolledWords,
  footerWords,
  inSegment,
  originOf,
  originTitle,
  readSegment,
  removeBlock,
  segmentCounts,
  sessionIndex,
  sessionOptions,
  startDraft,
  targetFromLine,
  targetFromRow,
  whyWords,
  linesInPool,
} from './intakeModel'

const names = sessionIndex(SESSIONS)
const programs = { summer: 'At Camp', twr: 'Teen Programs', tbm: 'TBM', family_camp: 'Family Camp' }

describe('segments (owner Q3-A: the server decides Needs a look)', () => {
  it('reads ?show=, Needs a look when absent or unknown', () => {
    expect(readSegment(null)).toBe('look')
    expect(readSegment('reg')).toBe('reg')
    expect(readSegment('all')).toBe('all')
    expect(readSegment('bogus')).toBe('look')
  })

  it('puts a row in Needs a look only when the server says so', () => {
    expect(inSegment(RILEY, 'look')).toBe(true)
    // Registration only, no CampMinder aid: not a look row (Q3-A), but in Registration ask only.
    expect(inSegment(MATEO, 'look')).toBe(false)
    expect(inSegment(MATEO, 'reg')).toBe(true)
    expect(inSegment(LIAM, 'all')).toBe(true)
    expect(inSegment(LIAM, 'reg')).toBe(false)
  })

  it('counts each filter over the rows, narrowed by the CampMinder-aid chip', () => {
    expect(segmentCounts(ROWS_2027, false)).toEqual({ look: 5, reg: 2, all: 8 })
    // The chip from Season's line keeps only rows with CampMinder aid on no request (Riley).
    expect(segmentCounts(ROWS_2027, true)).toEqual({ look: 1, reg: 1, all: 1 })
  })
})

describe('cells', () => {
  it('says what the form asked, in program words and the short session form', () => {
    expect(askedWords(EMMA, names, programs)).toBe(
      'At Camp: Teen Leadership Institute · $4,000 · reg. ask $290'
    )
    expect(askedWords(OLIVIA, names, programs)).toBe('At Camp: Session 2 or Taste 2 · $3,500')
    expect(askedWords(RILEY, names, programs)).toBe('Registration ask only · $2,500 (Nov 12)')
    expect(askedWords(MATEO, names, programs)).toBe('Registration ask only · $300')
  })

  it('lists the enrolled sessions in the tiny form, and says none', () => {
    expect(enrolledWords(EMMA, names).text).toBe('TLI · TWR')
    expect(enrolledWords(EMMA, names).title).toBe('Teen Leadership Institute · Teen Winter Retreat')
    expect(enrolledWords({ ...EMMA, enrolled_session_cm_ids: [] }, names).text).toBe('none')
  })

  it('maps each status to its pill words and tone', () => {
    expect(becameStatus('active')).toEqual({ words: 'Active', tone: 'ok' })
    expect(becameStatus('session_unclear')).toEqual({ words: 'Session unclear', tone: 'amber' })
    expect(becameStatus('duplicate_pending')).toEqual({ words: 'Duplicate pending', tone: 'red' })
    expect(becameStatus('withdrawn')).toEqual({ words: 'Withdrawn', tone: 'stone' })
    expect(becameStatus('cancelled')).toEqual({ words: 'Cancelled', tone: 'stone' })
  })

  it('says why a row made no request, short in the cell and whole in the title', () => {
    expect(whyWords(RILEY, names)?.short).toBe('No aid form: asked $2,500 when registering')
    expect(whyWords(THEO, names)?.short).toBe('No request: no household in CampMinder')
    expect(whyWords(EMMA, names)?.short).toBe('None for TWR: asked $290 at registration')
    expect(whyWords(LIAM, names)).toBeNull()
  })

  it('totals the amber CampMinder aid: on no request only', () => {
    expect(amberAid(RILEY)).toBe(2258)
    expect(amberAid(LIAM)).toBe(0)
  })

  it('counts rows and families in the footer', () => {
    expect(footerWords([EMMA, OLIVIA, RILEY])).toBe('3 rows · 3 families')
    expect(footerWords([OLIVIA, CHEN_HH])).toBe('2 rows · 1 family')
    expect(footerWords([EMMA])).toBe('1 row · 1 family')
  })
})

describe('origin marks (owner Q2-A)', () => {
  it('maps a request to its mark, or none for a form request', () => {
    expect(originOf(became({}))).toBeNull()
    expect(originOf(CHEN_HH.became![0]!)).toBe('added')
    expect(originOf(AVA.became![1]!)).toBe('reg_ask_review')
    expect(originOf({ ...AVA.became![1]!, reviewed: true })).toBe('reg_ask')
  })

  it('titles an added request with who, when and why', () => {
    expect(originTitle(CHEN_HH.became![0]!)).toBe(
      'Added by Jordan Chen, Jan 22: “Called in before the form opened”'
    )
    expect(
      originTitle({
        ...AVA.became![1]!,
        reviewed: true,
        reviewed_by: 'Pat Garcia',
        reviewed_at: '2027-03-03',
      })
    ).toContain('Reviewed by Pat Garcia, Mar 3')
    expect(originTitle(AVA.became![1]!)).toContain('Mark Reviewed if it is right')
  })
})

describe('Add a Request… (the editor)', () => {
  it('limits the picker to the gap sessions, and shows held sessions switched off under Already held', () => {
    const target = targetFromRow(EMMA)
    expect(sessionOptions(target, names)).toEqual([
      {
        value: String(TWR),
        label: 'Teen Winter Retreat',
        group: 'Enrolled, no request',
        title: 'Teen Winter Retreat',
      },
      {
        value: `held:${String(TLI)}`,
        label: 'Teen Leadership Institute · holds a request',
        group: 'Already held',
        disabled: true,
        title: 'Teen Leadership Institute holds an Active request',
      },
    ])
  })

  it('names a session CampMinder already paid, and a household row lists its Family Camp weekends', () => {
    expect(sessionOptions(targetFromRow(RILEY), names)[0]?.label).toBe(
      'Session 3 · CampMinder aid here'
    )
    const hh = sessionOptions(targetFromRow(OKAFOR_HH), names)
    expect(hh.map((o) => o.group)).toEqual([
      'Family Camp weekends, no request',
      'Family Camp weekends, no request',
    ])
  })

  it('pre-fills a registration-ask row with its session and its ask', () => {
    expect(startDraft(targetFromRow(EMMA))).toEqual({
      session: TWR,
      ask: '290',
      reason: '',
      recordRound1: true,
    })
    expect(startDraft(targetFromRow(MATEO)).ask).toBe('300')
  })

  it('pre-fills a D170 line: the posting suggests the session, the registration ask leads, Round 1 ticked', () => {
    const read = aidOnNoRequestRead()
    const target = targetFromLine(read.lines[0]!, LUCAS)
    expect(startDraft(target)).toEqual({ session: S3, ask: '2500', reason: '', recordRound1: true })
    expect(target.campminder.get(S3)).toBe(2258)
    // No Form intake row (not loaded): the line's own pre-fill, the posted amount.
    expect(startDraft(targetFromLine(read.lines[0]!, undefined)).ask).toBe('2258')
    expect(startDraft(targetFromLine(read.lines[1]!, OKAFOR_HH)).session).toBe(FC2)
  })

  it('refuses as the kit does: one problem at a time', () => {
    const draft = {
      session: TWR,
      ask: '290',
      reason: 'Asked at TWR registration',
      recordRound1: true,
    }
    expect(addProblem(draft)).toBeNull()
    expect(addProblem({ ...draft, session: null })).toBe('Pick a session')
    expect(addProblem({ ...draft, ask: '' })).toBe('Enter the Ask')
    expect(addProblem({ ...draft, ask: 'lots' })).toBe('Not an amount')
    expect(addProblem({ ...draft, ask: '0' })).toBe('The ask must be above $0')
    expect(addProblem({ ...draft, reason: '  ' })).toBe('Reason is required')
    expect(addProblem({ ...draft, ask: '$1,250.50' })).toBeNull()
  })

  it('sends round1_campminder only when the box is ticked on a session CampMinder paid (Q5-A)', () => {
    const target = targetFromRow(RILEY)
    const draft = { session: S3, ask: '2,500', reason: 'Assessed by phone', recordRound1: true }
    expect(addBody(target, draft)).toEqual({
      household_cm_id: 1000004,
      person_cm_id: 1000041,
      session_cm_id: S3,
      ask: 2500,
      reason: 'Assessed by phone',
      round1_campminder: 2258,
    })
    expect(addBody(target, { ...draft, recordRound1: false }).round1_campminder).toBeNull()
    expect(addBody(targetFromRow(EMMA), { ...draft, session: TWR }).round1_campminder).toBeNull()
  })

  it('states what each choice does to the money', () => {
    const target = targetFromRow(RILEY)
    const draft = { session: S3, ask: '2500', reason: '', recordRound1: true }
    const ticked = addEffects(target, draft, names, 'Camp & Quest')
    expect(ticked[0]?.then).toBe('→ Round 1 $2,258, posted: the money counts in Camp & Quest')
    expect(ticked.some((e) => e.sym === 'hand')).toBe(true)
    const unticked = addEffects(target, { ...draft, recordRound1: false }, names, 'Camp & Quest')
    expect(unticked[0]?.then).toBe(
      "→ Needs an offer, Round 1; CampMinder's $2,258 counts once Round 1 is decided"
    )
    const plain = addEffects(targetFromRow(EMMA), { ...draft, session: TWR }, names, null)
    expect(plain[0]?.then).toBe('→ Needs an offer, Round 1')
    expect(plain.some((e) => e.sym === 'hand')).toBe(false)
  })

  it('words the toolbar status after a save', () => {
    expect(addedStatus(targetFromRow(EMMA), TWR, 290, null, names, null)).toBe(
      '✓ Added a TWR request for Emma Johnson · ask $290'
    )
    expect(addedStatus(targetFromRow(RILEY), S3, 2500, 2258, names, 'Camp & Quest')).toBe(
      '✓ Riley Sam · S3 added · $2,258 now counts as Posted in Camp & Quest'
    )
    expect(addedStatus(targetFromRow(OKAFOR_HH), WFC, 900, null, names, null)).toBe(
      '✓ Added a household WFC request for Daniel & Priya Chen-Okafor · ask $900'
    )
  })
})

describe('Remove… (the household card)', () => {
  it('refuses up front while a round is posted, naming it', () => {
    expect(removeBlock({ ...CHEN_HH.became![0]!, posted_rounds: [1] })).toBe(
      'Round 1 is posted: undo Posted first'
    )
    expect(removeBlock(CHEN_HH.became![0]!)).toBeNull()
  })

  it('reads S2 as the tiny form', () => {
    // A guard on the fixture's session table, which the cells read.
    expect(names.get(S2)?.name).toBe('Session 2')
  })
})

describe('the visual audit (2026-10-15)', () => {
  it("names an answer by its session's program family, as the Requests grid does (Teen Programs, Quests)", () => {
    const withFamily = sessionIndex(
      SESSIONS.map((s) => ({ ...s, program_family: s.session_cm_id === TLI ? 'teen' : 'summer' }))
    )
    const words = { summer: 'At Camp', teen: 'Teen Programs', quest: 'Quests' }
    expect(askedWords(EMMA, withFamily, words)).toMatch(
      /^Teen Programs: Teen Leadership Institute · \$4,000/
    )
    // An answer that names no session keeps its program's word.
    expect(askedWords(OLIVIA, withFamily, words)).toBe('At Camp: Session 2 or Taste 2 · $3,500')
  })

  it('words a form request whose camper is enrolled in nothing it could be: no empty session, no broken title', () => {
    const notEnrolled = became({
      session_cm_id: 0,
      status: 'session_unclear',
      candidate_session_cm_ids: [],
      why: 'not_enrolled',
    })
    expect(becameSession(notEnrolled, names)).toBe('')
    expect(becameAside(notEnrolled)).toBe('not enrolled')
    expect(becameTitle(notEnrolled, names)).toBe(
      'Session unclear: the camper is enrolled in no session the answer could be (status 2). It settles once they enroll.'
    )
    // A request that lost its enrollment still reads "no longer enrolled".
    expect(becameAside(became({ status: 'active', why: 'not_enrolled' }))).toBe(
      'no longer enrolled'
    )
  })

  it('names who added a request from their email and the day at camp', () => {
    const added = became({
      origin: 'added',
      added_by: 'pat.garcia@example.com',
      added_at: '2027-03-04 02:00:00.000Z',
      added_reason: 'Assessed by phone',
    })
    expect(originTitle(added, INTAKE_WORDS)).toBe('Added by Pat, Mar 3: “Assessed by phone”')
  })

  it('draws "No aid form: a blank application is made" as a plain line, not a bold lead', () => {
    const draft = { session: S3, ask: '2500', reason: '', recordRound1: true }
    const effects = addEffects(targetFromRow(RILEY), draft, names, 'Camp & Quest')
    const blank = effects.find((e) => `${e.lead}${e.rest}`.startsWith('No aid form'))
    expect(blank).toMatchObject({ lead: '', rest: 'No aid form: a blank application is made' })
  })
})

describe("linesInPool: Season's ?pool= scopes the D170 lines it opens onto", () => {
  const base = aidOnNoRequestRead().lines[0]!
  const line = (row: string, pool: string | null, session = 1000103) => ({
    ...base,
    row_key: row,
    pool,
    session_cm_id: session,
  })
  const lines = [
    line('a', 'camp_pool'),
    line('b', 'weekend_pool'),
    line('c', null), // a session no program claims: Season's No pool
    line('d', null, 0), // no session can be told: Season's TOTAL only
  ]
  const keys = (pool: string | null) => linesInPool(lines, pool).map((l) => l.row_key)

  it('keeps every line with no pool selected', () => {
    expect(keys(null)).toEqual(['a', 'b', 'c', 'd'])
  })
  it("keeps only the selected pool's lines", () => {
    expect(keys('camp_pool')).toEqual(['a'])
    expect(keys('weekend_pool')).toEqual(['b'])
  })
  it('keeps the No pool line its sessions-no-program-claims money, never the money with no session', () => {
    expect(keys('')).toEqual(['c'])
  })
})
