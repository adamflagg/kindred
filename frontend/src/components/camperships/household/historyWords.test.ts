import { describe, expect, it } from 'vitest'

import type { ApiAidHistoryEntry } from '../../../types/api-types'
import { householdPage, householdRequest, receiptOut } from './householdFixtures'
import { historyCsv } from './householdModel'
import { historyLines, historyMeta, lineText, staffNames, whoWords } from './historyWords'
import { HISTORY, HISTORY_PAGE, TWO_HOUSEHOLD_PAGE } from './sectionsFixtures'
import { ROW_SAMUEL } from '../requests/gridFixtures'

const texts = (page = HISTORY_PAGE) => historyLines(page).map(lineText)

function one(over: Partial<ApiAidHistoryEntry>, page = HISTORY_PAGE): string {
  const lines = historyLines({ ...page, history: [{ ...HISTORY[0]!, ...over }] })
  return lineText(lines[0]!)
}

describe('historyLines: the family log in words (O4; history.html B)', () => {
  it('words each entry as who did what, oldest first, with no record ids or emails', () => {
    expect(texts()).toEqual([
      "Intake added the family's form",
      "Intake added Emma's request",
      'Test corrected expected gross income, $90,000 → $84,200',
      "Test marked Samuel's Round 1 posted at $1,800",
      "Matched in CampMinder · Emma's Round 1 posted at $1,420",
      "Test checked Accepted on Samuel's Round 1",
    ])
    const all = texts().join('\n')
    expect(all).not.toMatch(/@|req[a-z]+\d|op\d|cor\d|app\d/)
  })

  it('dates each line and keeps the reason apart, for the right of the line', () => {
    const lines = historyLines(HISTORY_PAGE)
    expect(lines[0]!.date).toBe('Feb 2')
    expect(lines[2]!.reason).toBe('Pay stub shows the new salary')
    expect(lines[0]!.reason).toBeNull()
  })

  it('bolds the amounts, as the Season history does', () => {
    const posted = historyLines(HISTORY_PAGE)[3]!
    expect(posted.parts.filter((p) => p.strong).map((p) => p.text)).toEqual(['$1,800'])
  })

  it('leaves the download as it was: ids and emails stay in the CSV', () => {
    const csv = historyCsv(HISTORY_PAGE)
    expect(csv.headers).toEqual(['When', 'Who', 'Action', 'Record', 'Reason', 'Operation'])
    expect(csv.rows[3]).toEqual([
      '2027-03-09T18:00:00Z',
      'test@example.com',
      'post',
      'aid_decisions reqsamuel000005:1',
      '',
      'op0000000000003',
    ])
  })

  it("names a household's form on a two-household page", () => {
    expect(
      one({ entity: 'aid_applications', after: { household_cm_id: 1000003 } }, TWO_HOUSEHOLD_PAGE)
    ).toBe('Intake added The Garcia Family form')
  })

  it('words the casework actions', () => {
    const at = {
      entity: 'aid_decisions',
      entity_id: 'reqsamuel000005:2',
      request_id: 'reqsamuel000005',
      actor: 'system:intake',
    }
    expect(one({ ...at, action: 'ask', after: { amount: '900.00', round: 2 } })).toBe(
      "Intake entered Samuel's Round 2 ask, $900"
    )
    expect(
      one({
        ...at,
        entity_id: 'reqsamuel000005:3',
        action: 'award',
        after: { amount: '1000.00', round: 3 },
      })
    ).toBe("Intake entered Samuel's Round 3 amount, $1,000")
    expect(one({ ...at, action: 'unpost', after: { round: 2 } })).toBe(
      "Intake unchecked Posted on Samuel's Round 2"
    )
    expect(one({ ...at, action: 'unaccept', after: { round: 2 } })).toBe(
      "Intake unchecked Accepted on Samuel's Round 2"
    )
    expect(one({ ...at, action: 'approve' })).toBe("Intake approved Samuel's Round 2")
    expect(
      one({
        entity: 'aid_hold_events',
        entity_id: 'reqsamuel000005',
        request_id: 'reqsamuel000005',
        action: 'place',
        after: { code: 'manual_hold' },
      })
    ).toBe("Intake put Samuel's request on hold")
    expect(
      one({
        entity: 'aid_hold_events',
        entity_id: 'reqsamuel000005',
        request_id: 'reqsamuel000005',
        action: 'place',
        after: { code: 'household_income_conflict' },
      })
    ).toBe("Intake put Samuel's request on hold: Income conflict")
    expect(
      one({
        entity: 'aid_cancellations',
        entity_id: 'reqsamuel000005',
        request_id: 'reqsamuel000005',
        action: 'cancel',
      })
    ).toBe("Intake cancelled Samuel's request")
    expect(
      one({
        entity: 'aid_grants',
        entity_id: 'grant0000000001',
        request_id: null,
        action: 'create',
        after: { amount: 500 },
      })
    ).toBe('Intake recorded a $500 grant')
  })

  it("merges one operation's payer-share rows into one line", () => {
    const share = (household: number, pct: string): ApiAidHistoryEntry => ({
      ...HISTORY[0]!,
      action: 'set_payer_shares',
      entity: 'aid_payer_shares',
      entity_id: `reqsamuel000005:${String(household)}`,
      request_id: 'reqsamuel000005',
      actor: 'system:intake',
      reason: 'Parents in two households split the cost',
      operation_id: 'op0000000000009',
      after: { household_cm_id: household, share_pct: pct },
    })
    const lines = historyLines({
      ...TWO_HOUSEHOLD_PAGE,
      history: [share(1000001, '60'), share(1000003, '40')],
    })
    expect(lines.map(lineText)).toEqual([
      "Intake set Samuel's payer shares to The Johnson Family 60% · The Garcia Family 40%",
    ])
    expect(lines[0]!.reason).toBe('Parents in two households split the cost')
  })

  describe("Use X's Form: one operation's corrections read as one line (round 3, section 3)", () => {
    const used = (
      field: string,
      over: Partial<ApiAidHistoryEntry> = {},
      person: number | null = 1000002
    ): ApiAidHistoryEntry => ({
      ...HISTORY[0]!,
      at: '2027-10-05T17:00:00Z',
      action: 'correct',
      entity: 'aid_application_corrections',
      entity_id: `cor-${field}`,
      request_id: null,
      actor: 'test@example.com',
      reason: "Emma's form is the newer one",
      operation_id: 'op0000000000020',
      after: {
        field,
        value: '1',
        previous_value: '2',
        ...(person === null ? {} : { form_person_cm_id: person }),
      },
      ...over,
    })

    it('collapses the rows sharing an operation and a form into one line, with the reason once', () => {
      const lines = historyLines({
        ...HISTORY_PAGE,
        history: [
          used('total_gross_income'),
          used('expected_gross_income'),
          used('total_housing_expenses'),
        ],
      })
      expect(lines.map(lineText)).toEqual([
        "Test used Emma's form for 3 answers: gross income, expected gross income, housing expenses",
      ])
      expect(lines[0]!.reason).toBe("Emma's form is the newer one")
      expect(lines[0]!.date).toBe('Oct 5')
    })

    it('says one answer in the singular, with no reason when none was given', () => {
      const lines = historyLines({
        ...HISTORY_PAGE,
        history: [used('num_children', { reason: '' })],
      })
      expect(lines.map(lineText)).toEqual(["Test used Emma's form for 1 answer: children"])
      expect(lines[0]!.reason).toBeNull()
    })

    it('names a form whose person is not a camper on the page by the person id', () => {
      expect(
        historyLines({ ...HISTORY_PAGE, history: [used('num_children', {}, 1000099)] }).map(
          lineText
        )
      ).toEqual(["Test used person 1000099's form for 1 answer: children"])
    })

    it('names a form owner from form_people when the person is not a camper (item 9)', () => {
      const page = {
        ...HISTORY_PAGE,
        incomes: HISTORY_PAGE.incomes.map((i) => ({
          ...i,
          form_people: [{ person_cm_id: 1000099, first_name: 'Noah', last_name: 'Johnson' }],
        })),
        history: [used('num_children', {}, 1000099)],
      }
      expect(historyLines(page).map(lineText)).toEqual([
        "Test used Noah's form for 1 answer: children",
      ])
    })

    it('leaves a plain correction, and another operation, on lines of their own', () => {
      const lines = historyLines({
        ...HISTORY_PAGE,
        history: [
          HISTORY[2]!,
          used('total_gross_income'),
          used('num_children'),
          used('total_rent', { operation_id: 'op0000000000021' }, 1000010),
        ],
      })
      expect(lines.map(lineText)).toEqual([
        'Test corrected expected gross income, $90,000 → $84,200',
        "Test used Emma's form for 2 answers: gross income, children",
        "Test used Samuel's form for 1 answer: rent",
      ])
    })
  })

  it('reads an action it has no words for in plain words, still with no ids', () => {
    expect(
      one({
        entity: 'aid_flag_dispositions',
        entity_id: 'flag00000000001',
        request_id: null,
        action: 'leave_at_family_level',
      })
    ).toBe('Intake: Leave at family level · flag')
  })
})

describe("the ledger's overnight tick reads Matched in CampMinder, then what happened (ruled 2026-10-05)", () => {
  const ledger = (over: Partial<ApiAidHistoryEntry>) =>
    one({
      actor: 'system:ledger',
      entity: 'aid_decisions',
      request_id: 'reqemma00000001',
      ...over,
    })

  it('words a post, without a verb the ledger is not doing', () => {
    expect(
      ledger({
        action: 'post',
        entity_id: 'reqemma00000001:1',
        after: { amount: '1420', round: 1 },
      })
    ).toBe("Matched in CampMinder · Emma's Round 1 posted at $1,420")
  })

  it('words an un-post and an accept the same way', () => {
    expect(ledger({ action: 'unpost', entity_id: 'reqemma00000001:1' })).toBe(
      "Matched in CampMinder · Emma's Round 1 Posted unchecked"
    )
    expect(ledger({ action: 'accept', entity_id: 'reqemma00000001:1' })).toBe(
      "Matched in CampMinder · Emma's Round 1 accepted"
    )
  })

  it('keeps the same shape for an entry with no words of its own', () => {
    expect(ledger({ action: 'lock', entity: 'aid_requests' })).toBe(
      'Matched in CampMinder · Lock · request'
    )
  })
})

describe('who: staff by a readable name, the system by its job', () => {
  it('names the system runs', () => {
    const names = new Map<string, string>()
    expect(whoWords('system:intake', names)).toBe('Intake')
    expect(whoWords('system:ledger', names)).toBe('Matched in CampMinder')
    expect(whoWords('system:grant-placement', names)).toBe('Grant placement')
  })

  it("learns a sign-in's name from the receipt of the round it ticked, first name only", () => {
    expect(staffNames(HISTORY_PAGE).get('test@example.com')).toBe('Test')
  })

  it('learns it from a Round 3 amount the receipt says it decided', () => {
    const page = householdPage({
      requests: [
        householdRequest(ROW_SAMUEL, {
          receipts: [receiptOut(3, { decided_by_name: 'Jordan Rivera' })],
        }),
      ],
      history: [
        {
          ...HISTORY[0]!,
          action: 'award',
          entity: 'aid_decisions',
          entity_id: 'reqsamuel000005:3',
          request_id: 'reqsamuel000005',
          actor: 'staff.one@example.com',
          after: { amount: '1000', round: 3 },
        },
      ],
    })
    expect(staffNames(page).get('staff.one@example.com')).toBe('Jordan')
  })

  it("falls back to the sign-in's first word, capitalised, never the whole email", () => {
    expect(whoWords('riley.sam@example.org', new Map())).toBe('Riley')
    expect(whoWords('sam_riley@example.org', new Map())).toBe('Sam')
    expect(whoWords('', new Map())).toBe('Someone')
  })
})

describe('historyMeta: the History tab', () => {
  it('counts the lines and dates the latest', () => {
    expect(historyMeta(historyLines(HISTORY_PAGE))).toBe('6 · latest Mar 14')
    expect(historyMeta([])).toBe('none recorded')
  })
})
