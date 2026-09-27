/**
 * The switcher's view-as events (spec §4.4): sent with the JWT but WITHOUT the
 * view-as header, so PocketBase sees the real admin; a persona change is a stop
 * then a start; failures never throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ViewAsPersona } from './viewAs'
import { VIEW_AS_START_URL, VIEW_AS_STOP_URL, recordViewAsSwitch } from './viewAsAudit'

vi.mock('../lib/pocketbase', () => ({ pb: { authStore: { token: 'test-jwt' } } }))

const registrar: ViewAsPersona = {
  label: 'Registrar',
  source: 'role',
  roleId: 'r2',
  permissions: ['metrics.geo', 'registration.manage'],
}
const finance: ViewAsPersona = {
  label: 'Finance',
  source: 'role',
  roleId: 'r3',
  permissions: ['financial_aid.view'],
}

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  window.sessionStorage.clear()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
})

afterEach(() => {
  fetchSpy.mockRestore()
})

function sent(i: number): {
  url: string
  body: Record<string, unknown>
  headers: Headers
  keepalive: boolean
} {
  const [url, init] = fetchSpy.mock.calls[i] as [string, RequestInit]
  return {
    url,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    headers: new Headers(init.headers),
    keepalive: init.keepalive === true,
  }
}

describe('recordViewAsSwitch', () => {
  it('starting a preview posts a start as the real admin', () => {
    recordViewAsSwitch(null, registrar)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const start = sent(0)
    expect(start.url).toBe(VIEW_AS_START_URL)
    expect(start.headers.get('Authorization')).toBe('Bearer test-jwt')
    expect(start.headers.get('X-Kindred-View-As')).toBeNull()
    expect(start.keepalive).toBe(true)
    expect(start.body).toMatchObject({
      persona: 'Registrar',
      permissions: ['metrics.geo', 'registration.manage'],
    })
    expect(String(start.body['session_id'])).toMatch(/^[A-Za-z0-9-]{8,64}$/)
  })

  it('changing persona stops the old session and starts a new one', () => {
    recordViewAsSwitch(null, registrar)
    const first = String(sent(0).body['session_id'])
    recordViewAsSwitch(registrar, finance)
    expect(sent(1)).toMatchObject({ url: VIEW_AS_STOP_URL, body: { session_id: first } })
    expect(sent(2).url).toBe(VIEW_AS_START_URL)
    expect(sent(2).body['session_id']).not.toBe(first)
  })

  it('exiting posts only the stop', () => {
    recordViewAsSwitch(null, finance)
    recordViewAsSwitch(finance, null)
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([VIEW_AS_START_URL, VIEW_AS_STOP_URL])
  })

  it('never throws when the network fails', () => {
    fetchSpy.mockRejectedValue(new TypeError('offline'))
    expect(() => recordViewAsSwitch(null, registrar)).not.toThrow()
  })

  it('falls back to crypto.getRandomValues, never Math.random, when randomUUID is unavailable', () => {
    // A non-secure-context browser leaves crypto.randomUUID missing entirely;
    // simulate that by making the call throw, same as calling an undefined method.
    const randomUUIDSpy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('randomUUID is not available in this context')
    })
    const mathRandomSpy = vi.spyOn(Math, 'random')
    recordViewAsSwitch(null, registrar)
    const start = sent(0)
    expect(String(start.body['session_id'])).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(mathRandomSpy).not.toHaveBeenCalled()
    randomUUIDSpy.mockRestore()
    mathRandomSpy.mockRestore()
  })
})
