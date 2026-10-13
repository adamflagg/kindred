import { describe, expect, it } from 'vitest'

import { aidRetry } from './aidRetry'

const withStatus = (status: number) => Object.assign(new Error('x'), { status })

describe('aidRetry (Camperships never retries a server answer)', () => {
  it('never retries a server answer, 5xx included', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500, 502, 503, 504]) {
      expect(aidRetry(0, withStatus(status))).toBe(false)
    }
  })

  it('retries a dropped connection once: fetch rejects with a TypeError that has no status', () => {
    expect(aidRetry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(aidRetry(1, new TypeError('Failed to fetch'))).toBe(false)
  })

  it("retries a dropped connection once: PocketBase's ClientResponseError carries status 0", () => {
    // The SDK's shape for a request that never got an answer (network down, aborted).
    const dropped = Object.assign(new Error('Something went wrong.'), {
      status: 0,
      url: '',
      response: {},
      isAbort: false,
      originalError: new TypeError('Failed to fetch'),
    })
    expect(aidRetry(0, dropped)).toBe(true)
    expect(aidRetry(1, dropped)).toBe(false)
  })
})
