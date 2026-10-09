/**
 * The toolbar's status slot for Requests (design-language §5–6; answers 1a R8–R11): a failed save, the
 * checked rows, a bulk result and the March File result all say their words in the one slot, so the
 * grid never moves. Fictional names.
 */
import { describe, expect, it } from 'vitest'

import { requestsStatus } from './requestsStatus'

const NONE = { failures: [], selected: 0, hidden: 0, result: null, march: null } as const

describe('requestsStatus', () => {
  it('says nothing when nothing happened', () => {
    expect(requestsStatus(NONE)).toBeNull()
  })

  it('counts the checked rows, and the hidden ones with the long words in the title', () => {
    expect(requestsStatus({ ...NONE, selected: 3 })).toMatchObject({
      text: '3 checked',
      title: '3 checked',
      tone: 'muted',
    })
    expect(requestsStatus({ ...NONE, selected: 3, hidden: 1 })).toMatchObject({
      text: '3 checked · 1 hidden',
      title:
        '3 checked · 1 hidden by the search or filters, still checked and still in Check Accepted…',
    })
  })

  it('says a failed save in warn, naming the row to go back to', () => {
    const s = requestsStatus({
      ...NONE,
      selected: 2,
      failures: [{ key: 'reqemma00000001', name: 'Emma Johnson', message: 'The request changed.' }],
    })
    expect(s).toMatchObject({
      text: "⚠ Couldn't save Emma Johnson's Round 2 ask",
      title:
        "Couldn't save Emma Johnson's Round 2 ask: The request changed. Go Back to the row to try again.",
      tone: 'warn',
      goBack: 'reqemma00000001',
    })
  })

  it('counts further failures', () => {
    const f = (key: string, name: string) => ({ key, name, message: 'No.' })
    const s = requestsStatus({
      ...NONE,
      failures: [f('a', 'Emma Johnson'), f('b', 'Liam Garcia'), f('c', 'Mia Chen')],
    })
    expect(s?.text).toBe("⚠ Couldn't save Emma Johnson's Round 2 ask (+2 more)")
  })

  it('says a bulk result in ok, with the ticked lines in the title, dismissible', () => {
    const lines = Array.from({ length: 14 }, (_, i) => `Camper ${String(i + 1)} R1`)
    const s = requestsStatus({
      ...NONE,
      result: { words: 'Checked Accepted on 14 requests', lines, someAlreadyTicked: false },
    })
    expect(s).toMatchObject({ tone: 'ok', dismiss: 'result' })
    expect(s?.text).toBe(
      `✓ Checked Accepted on 14 requests: ${lines.slice(0, 12).join(', ')} and 2 more`
    )
    expect(s?.title).toBe(s?.text.slice(2))
  })

  it('heads a result that included already-ticked rows "Sent"', () => {
    const s = requestsStatus({
      ...NONE,
      result: {
        words: 'Checked Accepted on 1 request',
        lines: ['Emma Johnson R1'],
        someAlreadyTicked: true,
      },
    })
    expect(s?.text).toBe('✓ Checked Accepted on 1 request. Sent: Emma Johnson R1')
  })

  it('says the March File result, ok or an error in warn', () => {
    expect(
      requestsStatus({
        ...NONE,
        march: { said: '✓ March File downloaded: 4 rows · 4 requests.', error: null },
      })
    ).toMatchObject({
      text: '✓ March File downloaded: 4 rows · 4 requests.',
      tone: 'ok',
      dismiss: 'march',
    })
    expect(
      requestsStatus({ ...NONE, march: { said: null, error: "Couldn't make the March file" } })
    ).toMatchObject({ tone: 'warn', dismiss: 'march' })
  })

  it('keeps a fresh result over the checked count, and says how many rows are still checked', () => {
    const result = { words: 'Checked Accepted on 1 request', lines: [], someAlreadyTicked: false }
    expect(requestsStatus({ ...NONE, selected: 2, result })?.text).toBe(
      '✓ Checked Accepted on 1 request · 2 still checked'
    )
    expect(requestsStatus({ ...NONE, result })?.tone).toBe('ok')
  })

  // #2951 M1, the mock's "nothing" result: a tick the server wrote nothing for is not a success, so no
  // ✓ and no green; it still lists what was sent and can be dismissed.
  it('says a tick that changed nothing without a check mark, in warn', () => {
    const s = requestsStatus({
      ...NONE,
      result: {
        words: 'Nothing changed: 1 was already checked',
        lines: ['Emma Johnson R1'],
        someAlreadyTicked: true,
        nothingChanged: true,
      },
    })
    expect(s).toMatchObject({
      text: 'Nothing changed: 1 was already checked. Sent: Emma Johnson R1',
      tone: 'warn',
      dismiss: 'result',
    })
  })
})
