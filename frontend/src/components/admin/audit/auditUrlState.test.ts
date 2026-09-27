import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AUDIT_QUERY,
  parseAuditQuery,
  selectType,
  serializeAuditQuery,
  updateAuditQuery,
} from './auditUrlState'

describe('audit log URL state', () => {
  it('an empty URL is the default view: page 1, 10 rows, no sign-ins', () => {
    expect(parseAuditQuery(new URLSearchParams())).toEqual(DEFAULT_AUDIT_QUERY)
    expect(serializeAuditQuery(DEFAULT_AUDIT_QUERY).toString()).toBe('')
  })

  it('round-trips every filter', () => {
    const query = {
      q: 'Cabin 14',
      types: ['settings' as const],
      actor: 'alex.rivera@example.com',
      signIns: true,
      page: 3,
      perPage: 25 as const,
    }
    const url = serializeAuditQuery(query)
    expect(url.toString()).toBe(
      'q=Cabin+14&type=settings&actor=alex.rivera%40example.com&signins=1&page=3&per=25'
    )
    expect(parseAuditQuery(url)).toEqual(query)
  })

  it('drops what it does not recognise instead of trusting it', () => {
    const got = parseAuditQuery(
      new URLSearchParams('type=bunking&type=roles&type=roles&page=-2&per=20')
    )
    expect(got.types).toEqual(['roles'])
    expect(got.page).toBe(1)
    expect(got.perPage).toBe(10)
  })

  it('any filter change goes back to page 1; a page move does not', () => {
    const onPage3 = { ...DEFAULT_AUDIT_QUERY, page: 3 }
    expect(updateAuditQuery(onPage3, { signIns: true }).page).toBe(1)
    expect(updateAuditQuery(onPage3, { perPage: 15 }).page).toBe(1)
    expect(updateAuditQuery(onPage3, { page: 4 }).page).toBe(4)
  })

  it('the type buttons pick one type, or All', () => {
    expect(selectType('roles')).toEqual(['roles'])
    expect(selectType('all')).toEqual([])
  })
})
