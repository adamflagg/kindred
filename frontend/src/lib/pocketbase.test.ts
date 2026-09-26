import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import type { SendOptions } from 'pocketbase'
import { pb } from './pocketbase'
import { readViewAs, writeViewAs, VIEW_AS_HEADER } from '../auth/viewAs'

// pb.authStore is a LocalAuthStore, which reads/writes through window.localStorage
// (see pocketbase/dist -- LocalAuthStore.token re-reads storage on every access
// rather than trusting the saved value). The global test setup mocks localStorage
// with non-functional no-op stubs, so authStore.token would always read back as ""
// regardless of what was saved. Same fix as src/tours/tourStorage.test.ts: stub in
// a real in-memory implementation for the duration of this file.
const realLocalStorage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    length: 0,
    key: vi.fn(),
  }
})()

beforeAll(() => {
  vi.stubGlobal('localStorage', realLocalStorage)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const registrar = { label: 'Registrar', source: 'role' as const, permissions: ['metrics.geo'] }

// pb.beforeSend's declared return type (BeforeSendResult) has `options` as an
// optional index-signature bag, looser than what our own implementation
// actually returns (pocketbase.ts always sets `options`, typed as SendOptions).
// Cast to that narrower, accurate shape so callers don't need index-signature
// bracket access for a property (`headers`) we know is always there.
async function send(options: SendOptions): Promise<{ url: string; options: SendOptions }> {
  if (!pb.beforeSend) throw new Error('pb.beforeSend is not set')
  return pb.beforeSend('http://localhost/api/collections/probe/records', options) as {
    url: string
    options: SendOptions
  }
}

describe('pb.beforeSend view-as header', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('adds the persona header and keeps existing headers', async () => {
    writeViewAs(registrar)
    const result = await send({ headers: { Authorization: 'token-1' } })
    expect(result).toBeDefined()
    expect(result.options.headers).toEqual({
      Authorization: 'token-1',
      [VIEW_AS_HEADER]: 'metrics.geo',
    })
  })

  it('adds nothing when not previewing', async () => {
    const result = await send({ headers: { Authorization: 'token-1' } })
    expect(result.options.headers).toEqual({ Authorization: 'token-1' })
  })
})

describe('sign-out clears the persona', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('clears when the auth store is cleared', () => {
    writeViewAs(registrar)
    pb.authStore.clear()
    expect(readViewAs()).toBeNull()
  })

  it('keeps the persona when a token is saved', () => {
    writeViewAs(registrar)
    pb.authStore.save('token-2', null)
    expect(readViewAs()).toEqual(registrar)
    pb.authStore.clear()
  })
})
