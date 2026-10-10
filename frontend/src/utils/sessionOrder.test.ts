import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { orderSessions, sessionOrderIds, type SessionOrderInput } from './sessionOrder'

const S = (
  cm_id: number,
  name: string,
  session_type: string,
  start_date = '',
  end_date = '',
  parent_cm_id = 0
): SessionOrderInput => ({ cm_id, name, session_type, start_date, end_date, parent_cm_id })

// The shared contract: tests/unit/bunking/test_session_order.py holds bunking/session_order.py to the same fixture.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tests/fixtures/session_order_cases.json'), 'utf-8')
) as { sessions: SessionOrderInput[]; order: number[] }

describe('sessionOrderIds', () => {
  it('matches the fixture the Python helper (bunking/session_order.py) also runs', () => {
    expect(sessionOrderIds(fixture.sessions)).toEqual(fixture.order)
  })

  it('lists by start date, a longer session before a shorter one on the same day', () => {
    const sessions = [
      S(3, 'Session 3', 'main', '2027-07-05', '2027-07-24'),
      S(1, 'Taste One', 'main', '2027-06-07', '2027-06-12'),
      S(2, 'Session 2a', 'embedded', '2027-06-14', '2027-06-26'),
      S(4, 'Session 2', 'main', '2027-06-14', '2027-07-03'),
    ]
    expect(sessionOrderIds(sessions)).toEqual([1, 4, 2, 3])
  })

  it('puts an AG session right under its parent, and by its own dates when the parent is not in the list', () => {
    const sessions = [
      S(1, 'Session 2', 'main', '2027-06-14', '2027-07-03'),
      S(2, 'Session 2a', 'embedded', '2027-06-14', '2027-06-26', 1),
      S(3, 'AG Cabin 2', 'ag', '2027-06-14', '2027-07-03', 1),
      S(4, 'Lone AG', 'ag', '2027-06-01', '2027-06-02', 99),
    ]
    expect(sessionOrderIds(sessions)).toEqual([4, 1, 3, 2])
  })

  it('runs quest, TLI, SCIT, the teen retreat, then Family Camp by number after the summer sessions', () => {
    const sessions = [
      S(1, 'Family Camp 10', 'family', '2027-11-01'),
      S(2, 'Winter Retreat', 'teen', '2027-12-20'),
      S(3, 'Counselor Training', 'scit', '2027-06-07'),
      S(4, 'Leadership Institute', 'tli', '2027-07-10'),
      S(5, 'Surf Quest', 'quest', '2027-06-14'),
      S(6, 'Session 4', 'main', '2027-07-26'),
      S(7, 'Family Camp 2', 'family', '2027-08-20'),
    ]
    expect(sessionOrderIds(sessions)).toEqual([6, 5, 4, 3, 2, 7, 1])
  })
})

describe('sessionOrderIds — numbered programs (coordinator 10-10)', () => {
  it('lists a B*Mitzvah or Hebrew program by the number in its name, then start date', () => {
    const sessions = [
      S(1, 'B*Mitzvah Program Year 2 - San Francisco', 'bmitzvah', '2027-08-27', '2028-05-26'),
      S(2, 'B*Mitzvah Program Year 2 - East Bay', 'bmitzvah', '2027-08-27', '2028-05-26'),
      S(3, 'B*Mitzvah Program Year 1 - San Francisco', 'bmitzvah', '2027-08-29', '2028-05-28'),
      S(4, 'B*Mitzvah Program Year 1 - East Bay', 'bmitzvah', '2027-08-29', '2028-05-28'),
      S(5, 'Hebrew 2 - Wednesdays', 'hebrew', '2027-01-09', '2027-03-27'),
      S(6, 'Hebrew 1 - Wednesdays', 'hebrew', '2027-10-09', '2027-12-04'),
    ]
    expect(sessionOrderIds(sessions)).toEqual([4, 3, 2, 1, 6, 5])
  })

  it('reads no order number in a quest name', () => {
    const sessions = [
      S(1, 'Quest H20', 'quest', '2027-07-05', '2027-07-24'),
      S(2, 'Rock Quest', 'quest', '2027-06-14'),
    ]
    expect(sessionOrderIds(sessions)).toEqual([2, 1])
  })
})

describe('orderSessions', () => {
  it('orders any list through a reader that names each item as a session', () => {
    const rows = [
      { id: 'b', session_cm_id: 2, label: 'Surf Quest', kind: 'quest', start: '2027-06-14' },
      { id: 'a', session_cm_id: 1, label: 'Session 2', kind: 'main', start: '2027-06-14' },
    ]
    const ordered = orderSessions(rows, (r) => S(r.session_cm_id, r.label, r.kind, r.start))
    expect(ordered.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
