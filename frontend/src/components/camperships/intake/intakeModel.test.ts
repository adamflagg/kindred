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
  askedTitle,
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
  defaultSegment,
  removeBlock,
  segmentCounts,
  sessionIndex,
  sessionOptions,
  startDraft,
  targetFromLine,
  targetFromRow,
  whyWords,
  linesInPool,
  formEvidence,
  noAidFormWords,
  SEGMENTS,
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

  // CLOSED-SEASONS-DONE (owner ruling CSD-6): a closed season opens on All forms; Needs a look at 0 reads as broken.
  it('reads All forms when absent on a closed season, Needs a look only when asked for', () => {
    expect(readSegment(null, true)).toBe('all')
    expect(readSegment('bogus', true)).toBe('all')
    expect(readSegment('look', true)).toBe('look')
    expect(readSegment('reg', true)).toBe('reg')
    expect(defaultSegment(true)).toBe('all')
    expect(defaultSegment(false)).toBe('look')
  })

  it('words a closed request Closed, in stone', () => {
    expect(becameStatus('closed')).toEqual({ words: 'Closed', tone: 'stone' })
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

  it('says why the registration-ask rule made no request (PR 4b)', () => {
    const ambiguous = whyWords({ ...EMMA, why_not: 'registration_ask_ambiguous' }, names)
    expect(ambiguous?.short).toBe('None for TWR: one ask, two or more sessions that day')
    expect(ambiguous?.long).toBe(
      "No request for Teen Winter Retreat. They asked $290 for financial assistance when registering, but registered for more than one session that day, so the dashboard can't tell which one the ask was for. Add a Request… if it was for this one."
    )
    const predates = whyWords(
      {
        ...EMMA,
        why_not: 'registration_ask_unattributed',
        why_not_detail: 'ask_predates_registration',
      },
      names
    )
    expect(predates?.short).toBe('None for TWR: the ask predates this registration')
    expect(predates?.long).toBe(
      'No request for Teen Winter Retreat. Their registration ask of $290 was typed before they registered for it, so it belongs to an earlier registration. Add a Request… if they asked for this one too.'
    )
    const elsewhere = whyWords({ ...EMMA, why_not: 'registration_ask_unattributed' }, names)
    expect(elsewhere?.short).toBe('None for TWR: the ask was typed at no registration of it')
    expect(elsewhere?.long).toBe(
      "No request for Teen Winter Retreat. Their registration ask of $290 was not typed within a day of registering for it, so the dashboard can't tell it was for this session. Add a Request… if it was."
    )
    // A camper with no aid-form row of their own: the ask has no amount on the row.
    expect(
      whyWords({ ...EMMA, registration_ask: null, why_not: 'registration_ask_ambiguous' }, names)
        ?.long
    ).toContain('They asked for financial assistance when registering, but')
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

  it('makes no blank application for a registration-ask-only row whose household filed for another bucket', () => {
    // IN-BUCKETS: an adult's adult-weekend ask is registration-ask only even when the household filed the summer
    // form for a child. That household already has its application and income, so Add a Request… makes none.
    const adult = targetFromRow({ ...RILEY, filed: true })
    expect(adult.noForm).toBe(false)
    const draft = { session: S3, ask: '400', reason: '', recordRound1: false }
    expect(addEffects(adult, draft, names, null).some((e) => e.sym === 'hand')).toBe(false)
    expect(targetFromRow(RILEY).noForm).toBe(true)
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

  it('refuses up front on a request cancelled in Kindred: reopen it first, or the cancellation stays', () => {
    const refusal =
      'The request is cancelled: Reopen… it first (the cancellation would stay), then remove it'
    expect(removeBlock({ posted_rounds: [], cancelled: true })).toBe(refusal)
    expect(removeBlock({ posted_rounds: [], cancelled: false })).toBeNull()
    // A posted round is named first: Undo Posted is the first step either way.
    expect(removeBlock({ posted_rounds: [1], cancelled: true })).toBe(
      'Round 1 is posted: undo Posted first'
    )
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

// IN-BUCKETS (owner 2026-10-28), 2027 on: a registration ask is judged per kind of program. A household that filed the
// aid form for another kind is not a family that "never filed"; the words name the kind it has no aid form for.
describe('registration ask only, per kind of program (IN-BUCKETS)', () => {
  const words = { ...programs, adult_weekend: 'Adult weekends', bmitzvah: 'B*Mitzvah' }
  const filedElsewhere = {
    ...RILEY,
    filed: true,
    registration_only_programs: ['adult_weekend'],
  }

  it('says which kind has no aid form when the household filed for another', () => {
    const why = whyWords(filedElsewhere, names, words)
    expect(why?.short).toBe('No aid form for Adult weekends: asked $2,500 when registering')
    expect(why?.long).toBe(
      "No aid form for Adult weekends. They asked $2,500 for financial assistance when registering (Nov 12), but the household's aid form doesn't cover Adult weekends, so the dashboard made no request."
    )
    expect(askedTitle(filedElsewhere, names, words)).toBe(
      'No aid form for Adult weekends. The registration form\'s "financial assistance" ask: $2,500, answered Nov 12.'
    )
    expect(noAidFormWords(filedElsewhere, words)).toBe('No aid form for Adult weekends')
  })

  it('names two or more kinds together', () => {
    const two = { ...filedElsewhere, registration_only_programs: ['summer', 'bmitzvah'] }
    expect(noAidFormWords(two, words)).toBe('No aid form for At Camp and B*Mitzvah')
    expect(whyWords(two, names, words)?.short).toBe(
      'No aid form for At Camp and B*Mitzvah: asked $2,500 when registering'
    )
  })

  it("keeps today's words when the household filed nothing", () => {
    expect(whyWords(RILEY, names, words)?.long).toBe(
      'No aid form. They asked $2,500 for financial assistance when registering (Nov 12) and never filed the aid form, so the dashboard made no request.'
    )
    expect(askedTitle(RILEY, names, words)).toBe(
      'No aid form. The registration form\'s "financial assistance" ask: $2,500, answered Nov 12.'
    )
    expect(noAidFormWords(RILEY, words)).toBe('No aid form, this season or any earlier one')
    // A 2026 row carries no programs (the server leaves the field out): today's words too, filed or not.
    expect(noAidFormWords({ ...RILEY, filed: true }, words)).toBe(
      'No aid form, this season or any earlier one'
    )
  })

  it("titles the list by kind of program, not 'never filed'", () => {
    const reg = SEGMENTS.find((s) => s.value === 'reg')
    expect(reg?.title).toBe(
      'People who asked for aid when registering, with no aid form for that kind of program (At Camp, B*Mitzvah, Family Camp or Adult Weekends): a follow-up list'
    )
  })

  it('keeps a filed answer in Form asked beside a registration ask only for another kind', () => {
    // Emma answered the form for one kind; her ask is registration ask only for another. The cell still shows her answer.
    const both = { ...EMMA, registration_only: true, registration_only_programs: ['bmitzvah'] }
    expect(askedWords(both, names, words)).toBe(askedWords(EMMA, names, words))
    expect(askedTitle(both, names, words)).toBe(askedTitle(EMMA, names, words))
  })

  it('lists the filed form and the kind with no aid form, both, in the detail', () => {
    const both = {
      ...EMMA,
      filed: true,
      registration_only: true,
      registration_only_programs: ['bmitzvah'],
    }
    expect(formEvidence(both, words)).toEqual({ noForm: 'No aid form for B*Mitzvah', filed: true })
    // Today's single lines where only one is true.
    expect(formEvidence(RILEY, words)).toEqual({
      noForm: 'No aid form, this season or any earlier one',
      filed: false,
    })
    expect(formEvidence({ ...RILEY, registration_only: false }, words)).toEqual({
      noForm: 'No aid form and no registration ask, this season or any earlier one',
      filed: false,
    })
    expect(formEvidence({ ...EMMA, filed: true, registration_only: false }, words)).toEqual({
      noForm: null,
      filed: true,
    })
  })

  it('says why an ask from someone not registered or not enrolled made no request (2027 on)', () => {
    const notRegistered = whyWords(
      {
        ...RILEY,
        filed: true,
        registration_only: false,
        why_not: 'registration_ask_not_registered',
      },
      names,
      words
    )
    expect(notRegistered?.short).toBe('No request: registered for nothing the ask could be for')
    expect(notRegistered?.long).toBe(
      "No request. They asked $2,500 for financial assistance when registering (Nov 12), but aren't registered for any session the ask could be for. An ask counts only for the kind of program someone is registered for."
    )
    const notEnrolled = whyWords(
      { ...RILEY, filed: true, registration_only: false, why_not: 'registration_ask_not_enrolled' },
      names,
      words
    )
    expect(notEnrolled?.short).toBe('No request: registered, not enrolled')
    expect(notEnrolled?.long).toBe(
      "No request. They asked $2,500 for financial assistance when registering (Nov 12), but are not enrolled (status 2) in any session the ask could be for. Only an enrolled camper's aid is processed."
    )
    expect(
      whyWords(
        { ...RILEY, registration_ask: null, why_not: 'registration_ask_not_enrolled' },
        names,
        words
      )?.long
    ).toContain('They asked for financial assistance when registering, but')
  })
})
