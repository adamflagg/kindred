import { describe, expect, it } from 'vitest'
import { partialResolveToastMessages } from './partialResolveToast'

describe('partialResolveToastMessages', () => {
  it('returns [] when summary is undefined (non-partial solve)', () => {
    expect(partialResolveToastMessages(undefined)).toEqual([])
  })
  it('returns [] when both counts are 0', () => {
    expect(
      partialResolveToastMessages({ unassigned_count: 0, cross_boundary_request_count: 0 })
    ).toEqual([])
  })
  it('reports unassigned campers (pluralized)', () => {
    const [line] = partialResolveToastMessages({
      unassigned_count: 3,
      cross_boundary_request_count: 0,
    })
    expect(line).toMatch(/3 campers left unassigned/)
  })
  it('uses singular for one unassigned camper', () => {
    const [line] = partialResolveToastMessages({
      unassigned_count: 1,
      cross_boundary_request_count: 0,
    })
    expect(line).toMatch(/1 camper left unassigned/)
    expect(line).not.toMatch(/campers/)
  })
  it('reports cross-boundary requests', () => {
    const [line] = partialResolveToastMessages({
      unassigned_count: 0,
      cross_boundary_request_count: 2,
    })
    expect(line).toMatch(/2 requests couldn't be met/)
  })
  it('uses singular for one cross-boundary request', () => {
    const [line] = partialResolveToastMessages({
      unassigned_count: 0,
      cross_boundary_request_count: 1,
    })
    expect(line).toMatch(/1 request couldn't be met/)
    expect(line).not.toMatch(/requests/)
  })
  it('returns both lines when both counts > 0', () => {
    expect(
      partialResolveToastMessages({ unassigned_count: 2, cross_boundary_request_count: 1 })
    ).toHaveLength(2)
  })
})
