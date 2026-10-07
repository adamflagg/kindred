import { describe, expect, it, vi } from 'vitest'

import {
  AidWriteError,
  fitAidScenario,
  hasStatus,
  keyAidAsk,
  retryUnlessRefused,
  saveAidScenarioDraft,
  writeMessage,
} from './aidApi'

describe('writeMessage', () => {
  it("reads FastAPI's detail as one sentence: a string, a 409's message, a 422's first msg", () => {
    expect(writeMessage("Round 2 is posted; its ask can't change")).toBe(
      "Round 2 is posted; its ask can't change"
    )
    expect(writeMessage({ message: 'Decided amounts moved', rows: [] })).toBe(
      'Decided amounts moved'
    )
    // Pydantic's own "Value error, " prefix is not staff's words (M15).
    expect(
      writeMessage([
        { msg: 'Value error, a Round 3 ask needs its statement of need', loc: ['body'] },
      ])
    ).toBe('a Round 3 ask needs its statement of need')
    expect(writeMessage('')).toBeNull()
    expect(writeMessage(undefined)).toBeNull()
  })

  it('returns nothing for a message with no words, so the caller falls back to its own', () => {
    expect(writeMessage([{ msg: 'Value error, ' }])).toBeNull()
    expect(writeMessage([{ msg: '' }])).toBeNull()
    expect(writeMessage({ message: '' })).toBeNull()
  })
})

describe('retryUnlessRefused (Decision 30)', () => {
  const refused = (status: number) => Object.assign(new Error('refused'), { status })

  it('answers a refusal in the server words at once, and a lapsed sign-in too', () => {
    const retry = retryUnlessRefused([404, 422])
    expect(retry(0, refused(404))).toBe(false)
    expect(retry(0, refused(422))).toBe(false)
    expect(retry(0, refused(401))).toBe(false)
  })

  it("keeps the app's three retries for everything else", () => {
    const retry = retryUnlessRefused([404])
    expect(retry(0, refused(422))).toBe(true)
    expect(retry(2, new Error('network'))).toBe(true)
    expect(retry(3, new Error('network'))).toBe(false)
  })
})

describe('a refused write', () => {
  const ASK = { round: 2 as const, amount: 500, asked_on: '2027-04-09' }

  it("throws the server's sentence, its status and a 409's moved rows", async () => {
    const detail = {
      message: 'Decided amounts moved',
      rows: [{ request_id: 'reqemma00000001', round: 1, confirmed: 1420, decided_now: 1500 }],
    }
    const fetchWithAuth = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ detail }), { status: 409 }))
    )
    const error: unknown = await keyAidAsk(fetchWithAuth, 'reqemma00000001', ASK).catch(
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(AidWriteError)
    expect(error).toMatchObject({
      message: 'Decided amounts moved',
      status: 409,
      rows: detail.rows,
    })
    expect(hasStatus(error, 409)).toBe(true)
    expect(hasStatus(error, 404)).toBe(false)
  })

  it('falls back to its own words and the status when the server says nothing readable', async () => {
    const fetchWithAuth = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    await expect(keyAidAsk(fetchWithAuth, 'reqemma00000001', ASK)).rejects.toThrow(
      "Couldn't save the ask (HTTP 500)"
    )
  })
})

describe('scenario request bodies (A11b)', () => {
  it('lets only the draft save carry the version staff opened', () => {
    const document = {} as Parameters<typeof fitAidScenario>[2]['document']
    const save: Parameters<typeof saveAidScenarioDraft>[2] = { document, opened_version: 2 }
    // @ts-expect-error fit-to-budget's body forbids extra fields: the server answers 422 to an opened_version.
    const fit: Parameters<typeof fitAidScenario>[2] = { document, opened_version: 2 }
    expect([save.opened_version, fit.document]).toEqual([2, document])
  })
})
