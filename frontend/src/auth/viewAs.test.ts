import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  clearViewAs,
  isViewAsPersonaUser,
  readViewAs,
  viewAsHeaders,
  writeViewAs,
  VIEW_AS_HEADER,
} from './viewAs'

const registrar = {
  label: 'Registrar',
  source: 'role' as const,
  permissions: ['metrics.geo', 'registration.manage'],
}

describe('viewAs persona storage', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('round-trips a persona', () => {
    writeViewAs(registrar)
    expect(readViewAs()).toEqual(registrar)
  })

  it('reads null when nothing is stored', () => {
    expect(readViewAs()).toBeNull()
  })

  it('clears the persona', () => {
    writeViewAs(registrar)
    clearViewAs()
    expect(readViewAs()).toBeNull()
  })

  it('reads null for corrupt JSON or the wrong shape', () => {
    window.sessionStorage.setItem('kindred.viewAs', '{not json')
    expect(readViewAs()).toBeNull()
    window.sessionStorage.setItem(
      'kindred.viewAs',
      JSON.stringify({ label: 'X', source: 'admin', permissions: [] })
    )
    expect(readViewAs()).toBeNull()
    window.sessionStorage.setItem(
      'kindred.viewAs',
      JSON.stringify({ label: 'X', source: 'role', permissions: [1] })
    )
    expect(readViewAs()).toBeNull()
    window.sessionStorage.setItem(
      'kindred.viewAs',
      JSON.stringify({ label: 'X', source: 'role', roleId: 7, permissions: [] })
    )
    expect(readViewAs()).toBeNull()
  })

  it('treats blocked storage as not previewing, and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readViewAs()).toBeNull()
    expect(() => writeViewAs(registrar)).not.toThrow()
    expect(() => clearViewAs()).not.toThrow()
    expect(viewAsHeaders()).toEqual({})
  })
})

describe('viewAsHeaders', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('sends nothing when not previewing', () => {
    expect(viewAsHeaders()).toEqual({})
  })

  it('joins the persona permissions', () => {
    writeViewAs(registrar)
    expect(viewAsHeaders()).toEqual({ [VIEW_AS_HEADER]: 'metrics.geo,registration.manage' })
  })

  it('sends the none sentinel for an empty persona', () => {
    writeViewAs({ label: 'Custom', source: 'custom', permissions: [] })
    expect(viewAsHeaders()).toEqual({ 'X-Kindred-View-As': 'none' })
  })
})

describe('isViewAsPersonaUser', () => {
  it('recognises a stand-in by its email domain', () => {
    expect(isViewAsPersonaUser({ email: 'va0123456789abc@view-as.invalid' })).toBe(true)
  })

  it('does not match real people or missing emails', () => {
    expect(isViewAsPersonaUser({ email: 'emma@example.com' })).toBe(false)
    expect(isViewAsPersonaUser({ email: 'someone@view-as.invalid.example.com' })).toBe(false)
    expect(isViewAsPersonaUser({})).toBe(false)
  })

  it('matches case-insensitively, like the Go check', () => {
    expect(isViewAsPersonaUser({ email: 'VA0123456789ABC@VIEW-AS.INVALID' })).toBe(true)
  })
})
