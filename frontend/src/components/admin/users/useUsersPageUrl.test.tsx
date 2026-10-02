import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useUsersPageUrl } from './useUsersPageUrl'

function setup(initial = '/users') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  )
  return renderHook(() => ({ url: useUsersPageUrl(), loc: useLocation() }), { wrapper })
}

describe('useUsersPageUrl', () => {
  it('defaults to the users tab, page 1, no filters', () => {
    const { result } = setup()
    expect(result.current.url).toMatchObject({
      tab: 'users',
      bucket: null,
      roleId: null,
      page: 1,
      focus: null,
    })
  })
  it('reads and writes the tab, omitting the default', () => {
    const { result } = setup('/users?tab=roles')
    expect(result.current.url.tab).toBe('roles')
    act(() => result.current.url.setTab('users'))
    expect(result.current.loc.search).toBe('')
  })
  it('ignores an unknown tab or bucket', () => {
    const { result } = setup('/users?tab=bogus&bucket=bogus&page=-3')
    expect(result.current.url).toMatchObject({ tab: 'users', bucket: null, page: 1 })
  })
  it('setRole lands on users, clearing bucket and page', () => {
    const { result } = setup('/users?tab=roles&bucket=exec&page=2')
    act(() => result.current.url.setRole('r-fin'))
    expect(result.current.url).toMatchObject({
      tab: 'users',
      roleId: 'r-fin',
      bucket: null,
      page: 1,
    })
  })
  it('setBucket lands on users, so it works from the Roles tab', () => {
    const { result } = setup('/users?tab=roles&focus=r-fin')
    act(() => result.current.url.setBucket('admin'))
    expect(result.current.url).toMatchObject({ tab: 'users', bucket: 'admin', focus: null })
  })
  it('setTab with focus carries a permission to highlight', () => {
    const { result } = setup()
    act(() => result.current.url.setTab('permissions', 'metrics.geo'))
    expect(result.current.url).toMatchObject({ tab: 'permissions', focus: 'metrics.geo' })
  })
})
