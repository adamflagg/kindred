import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import { useGridParams } from './useGridParams'

function Probe() {
  const { setParam } = useGridParams()
  const { search } = useLocation()
  return (
    <>
      <output aria-label="search">{search}</output>
      <button type="button" onClick={() => setParam('round', '2')}>
        Round 2
      </button>
    </>
  )
}

describe('useGridParams', () => {
  // The Checklist chips' `?tick=` is retired (#3000): nothing reads it, so an old link's stays out
  // of the address bar from the first filter change rather than riding along as clutter.
  it('drops a retired ?tick= with the next write, and keeps the rest', async () => {
    render(
      <MemoryRouter initialEntries={['/aid/requests?tick=accepted&program=Summer']}>
        <Probe />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Round 2' }))
    const search = new URLSearchParams(screen.getByLabelText('search').textContent)
    expect(search.get('tick')).toBeNull()
    expect(search.get('program')).toBe('Summer')
    expect(search.get('round')).toBe('2')
  })

  // The counting filter's `?counted=` is retired too (R10, owner 10-07): an old Season link's goes
  // with the first filter change, as `tick=` does.
  it('drops a retired ?counted= with the next write, and keeps the rest', async () => {
    render(
      <MemoryRouter initialEntries={['/aid/requests?posted=1&counted=1&program=Summer']}>
        <Probe />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Round 2' }))
    const search = new URLSearchParams(screen.getByLabelText('search').textContent)
    expect(search.get('counted')).toBeNull()
    expect(search.get('posted')).toBe('1')
    expect(search.get('program')).toBe('Summer')
  })
})
