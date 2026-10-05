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
      "The ledger match marked Emma's Round 1 posted at $1,420",
      "Test ticked Accepted on Samuel's Round 1",
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
      "Intake undid the Posted tick on Samuel's Round 2"
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

describe('who: staff by a readable name, the system by its job', () => {
  it('names the system runs', () => {
    const names = new Map<string, string>()
    expect(whoWords('system:intake', names)).toBe('Intake')
    expect(whoWords('system:ledger', names)).toBe('The ledger match')
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
