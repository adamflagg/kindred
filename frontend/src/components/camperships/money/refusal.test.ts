/** A refused Money or Grants write in staff's words (slice 2 plan review M4: the UI's sentence leads). */
import { describe, expect, it } from 'vitest'

import { AidWriteError } from '../../../services/camperships/aidApi'
import { inStaffWords, previewRefusalWords, refusalWords } from './refusal'

describe('refusalWords', () => {
  it('says a race wrote nothing and the page reloaded', () => {
    expect(
      refusalWords(new AidWriteError('Someone else changed this; reload and try again', 409))
    ).toBe(
      'Someone else changed this while you looked; nothing was written. The page has reloaded: check it and try again. (Someone else changed this; reload and try again)'
    )
  })

  it('reads the race sentence as a race on any 4xx', () => {
    expect(
      refusalWords(new AidWriteError('Someone else changed this; reload and try again', 422))
    ).toMatch(/^Someone else changed this while you looked; nothing was written\./)
  })

  it("shows a state refusal (a key taken, a grantor in use) in the server's words", () => {
    expect(
      refusalWords(new AidWriteError("a grantor with key 'grantor_a' already exists", 409))
    ).toBe("Nothing was written: a grantor with key 'grantor_a' already exists")
  })

  it("rethrows a refusal in staff's words for ReasonForm, and passes a success through (plan review m9)", async () => {
    await expect(
      inStaffWords(Promise.reject(new AidWriteError('line 3000006 is already left', 409)))
    ).rejects.toThrow('Nothing was written: line 3000006 is already left')
    await expect(inStaffWords(Promise.resolve(7))).resolves.toBe(7)
  })

  it('narrows on .status, not instanceof (services/apiError.ts: a duplicate module instance)', () => {
    const elsewhere = Object.assign(new Error("'grantor_b' is retired; unretire it first"), {
      status: 422,
    })
    expect(refusalWords(elsewhere)).toBe(
      "Nothing was written: 'grantor_b' is retired; unretire it first"
    )
  })

  it("says what a moved lock means, and that a fault can't say whether it saved", () => {
    expect(
      refusalWords(new AidWriteError('this now locks $1,400, not the $1,500 you confirmed', 422))
    ).toMatch(/^What this would lock changed since the page loaded/)
    expect(refusalWords(new AidWriteError('Server error', 500))).toMatch(
      /^We can't tell whether this was saved/
    )
  })
})

describe('previewRefusalWords (P-4)', () => {
  const refused = (status: number, message: string) => Object.assign(new Error(message), { status })

  it('words a 4xx as Confirm being unable to place it, and passes anything else through', () => {
    expect(previewRefusalWords(refused(422, 'line 3000003 is already on a request'))).toBe(
      "Confirm can't place this as suggested now: line 3000003 is already on a request"
    )
    expect(previewRefusalWords(refused(500, 'Server error'))).toBeNull()
    expect(previewRefusalWords(null)).toBeNull()
  })

  it("leads with what can't be done: Confirm's words, or the typed placement's", () => {
    const refused = new AidWriteError('request reqsamuel000002 is cancelled', 422)
    expect(previewRefusalWords(refused)).toBe(
      "Confirm can't place this as suggested now: request reqsamuel000002 is cancelled"
    )
    expect(previewRefusalWords(refused, "This can't be placed as typed")).toBe(
      "This can't be placed as typed: request reqsamuel000002 is cancelled"
    )
    // A fault is not a refusal: nothing to say, the caller keeps what it has.
    expect(previewRefusalWords(new AidWriteError('Server error', 500))).toBeNull()
    expect(previewRefusalWords(null)).toBeNull()
  })
})
