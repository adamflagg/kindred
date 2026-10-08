/**
 * The old /aid/grants/* links (owner 10-08: Grants folded into Money). Each lands on its Money
 * tab, keeping the whole query string (the year, the as-of, `?row=`, `?grantor=`).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import AidGrantsRedirect from './AidGrantsRedirect'

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/grants/*" element={<AidGrantsRedirect />} />
        <Route path="/aid/money/*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AidGrantsRedirect', () => {
  it.each([
    ['/aid/grants', '/aid/money/grants'],
    ['/aid/grants/register', '/aid/money/grants'],
    ['/aid/grants/grantors', '/aid/money/funders'],
    ['/aid/grants/needs-attention', '/aid/money/to-place'],
    ['/aid/grants/expected', '/aid/money/grants'],
    ['/aid/grants/bogus', '/aid/money'],
    ['/aid/grants/register/deeper', '/aid/money'],
  ])('sends %s to %s', (from, to) => {
    renderAt(`${from}?year=2027`)
    expect(screen.getByTestId('where')).toHaveTextContent(`${to}?year=2027`)
  })

  it('keeps the query string whole: the Grantors link carries ?grantor=, the Register ?row=', () => {
    renderAt('/aid/grants/grantors?grantor=grantor_a&year=2027&as_of=2027-05-01')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/money/funders?grantor=grantor_a&year=2027&as_of=2027-05-01'
    )
  })

  it('keeps ?row= on the Register', () => {
    renderAt('/aid/grants/register?row=ccmtriley0000001&year=2027')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/money/grants?row=ccmtriley0000001&year=2027'
    )
  })

  it('tolerates a trailing slash', () => {
    renderAt('/aid/grants/grantors/?year=2027')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/money/funders?year=2027')
  })
})
